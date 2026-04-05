/**
 * Heartbeat Process Manager
 *
 * 职责：进程生命周期管理
 * - 检查进程存活状态
 * - 清理孤儿进程
 * - 记录进程元数据
 *
 * 提取自 heartbeat.ts（原 3877 行）的进程管理逻辑
 */

import { eq, and, lt, inArray, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { heartbeatRuns, heartbeatRunEvents } from "@paperclipai/db";
import type { Logger } from "pino";

export interface ProcessMetadata {
  pid: number;
  startTime?: number;
  command?: string;
}

export interface ProcessManager {
  /**
   * 检查进程是否仍在运行
   * @param pid 进程 ID
   * @returns true 如果进程存活，false 否则
   */
  isProcessAlive(pid: number): Promise<boolean>;

  /**
   * 清理孤儿 runs（进程已死但状态仍为 running）
   * @param companyId 公司 ID
   * @returns 清理的 run 数量
   */
  reapOrphanedRuns(companyId: string): Promise<number>;

  /**
   * 记录 run 的进程元数据
   * @param runId Run ID
   * @param meta 进程元数据
   */
  persistProcessMetadata(runId: string, meta: ProcessMetadata): Promise<void>;

  /**
   * 清理分离运行的警告标记
   * @param runId Run ID
   */
  clearDetachedRunWarning(runId: string): Promise<void>;
}

export interface ProcessManagerDeps {
  db: Db;
  logger: Logger;
}

/**
 * 创建进程管理器实例
 */
export function createProcessManager(deps: ProcessManagerDeps): ProcessManager {
  const { db, logger } = deps;

  /**
   * 跨平台进程存活检查
   * Unix: 使用 kill(pid, 0)
   * Windows: 使用 tasklist 查询
   */
  async function isProcessAlive(pid: number): Promise<boolean> {
    if (pid <= 0) return false;

    try {
      if (process.platform === "win32") {
        // Windows: 使用 tasklist 命令
        const { execSync } = await import("node:child_process");
        const result = execSync(`tasklist /FI "PID eq ${pid}"`, { encoding: "utf8" });
        return result.includes(pid.toString());
      } else {
        // Unix: 使用 kill(pid, 0) 检查进程是否存在
        // 信号 0 不会发送实际信号，仅检查权限和存在性
        process.kill(pid, 0);
        return true;
      }
    } catch (err) {
      // ESRCH: 进程不存在
      // EPERM: 进程存在但无权限（也算存活）
      if (err instanceof Error && "code" in err && err.code === "EPERM") {
        return true;
      }
      return false;
    }
  }

  /**
   * 清理孤儿 runs
   *
   * 查找状态为 "running" 但进程已死的 runs，标记为 failed。
   * 这种情况可能发生在：
   * - 服务器强制重启
   * - 进程被 kill -9 杀死
   * - 系统崩溃
   */
  async function reapOrphanedRuns(companyId: string): Promise<number> {
    const startTime = Date.now();

    // 1. 查询所有运行中的 runs
    const runningRuns = await db
      .select({
        id: heartbeatRuns.id,
        agentId: heartbeatRuns.agentId,
        pid: heartbeatRuns.pid,
        startedAt: heartbeatRuns.startedAt,
        contextSnapshot: heartbeatRuns.contextSnapshot,
      })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          eq(heartbeatRuns.status, "running"),
        ),
      );

    if (runningRuns.length === 0) {
      return 0;
    }

    logger.debug(
      { companyId, count: runningRuns.length },
      "checking running runs for orphaned processes",
    );

    // 2. 检查每个 run 的进程状态
    const orphanedIds: string[] = [];

    for (const run of runningRuns) {
      if (!run.pid) {
        // 没有 PID 记录 — 可能是 HTTP adapter 或尚未启动
        continue;
      }

      const alive = await isProcessAlive(run.pid);
      if (!alive) {
        orphanedIds.push(run.id);
        logger.warn(
          {
            runId: run.id,
            agentId: run.agentId,
            pid: run.pid,
            startedAt: run.startedAt,
          },
          "detected orphaned run (process died)",
        );
      }
    }

    if (orphanedIds.length === 0) {
      logger.debug({ companyId, elapsed: Date.now() - startTime }, "no orphaned runs found");
      return 0;
    }

    // 3. 批量更新孤儿 runs 为 failed 状态
    const now = new Date();
    const errorMessage = "Process terminated unexpectedly (orphaned run)";

    await db
      .update(heartbeatRuns)
      .set({
        status: "failed",
        error: errorMessage,
        errorCode: "process_died",
        finishedAt: now,
        updatedAt: now,
      })
      .where(inArray(heartbeatRuns.id, orphanedIds));

    // 4. 为每个孤儿 run 添加事件日志
    const eventInserts = orphanedIds.map((runId, index) => ({
      runId,
      seq: 999, // 高序号，确保在日志末尾
      eventType: "error" as const,
      stream: "system" as const,
      level: "error" as const,
      message: errorMessage,
      payload: {
        reason: "orphaned_process",
        detectedAt: now.toISOString(),
      } as Record<string, unknown>,
      createdAt: now,
    }));

    if (eventInserts.length > 0) {
      await db.insert(heartbeatRunEvents).values(eventInserts);
    }

    const elapsed = Date.now() - startTime;
    logger.info(
      { companyId, count: orphanedIds.length, elapsed },
      "reaped orphaned runs",
    );

    return orphanedIds.length;
  }

  /**
   * 记录进程元数据到 contextSnapshot
   */
  async function persistProcessMetadata(runId: string, meta: ProcessMetadata): Promise<void> {
    await db
      .update(heartbeatRuns)
      .set({
        pid: meta.pid,
        contextSnapshot: {
          processMetadata: {
            pid: meta.pid,
            startTime: meta.startTime,
            command: meta.command,
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(heartbeatRuns.id, runId));
  }

  /**
   * 清理分离运行的警告标记
   *
   * 某些 adapter（如 process adapter）可能会 fork 出独立进程，
   * 这些进程在 adapter.execute() 返回后仍继续运行。
   * 清理警告标记允许这些 runs 正常完成。
   */
  async function clearDetachedRunWarning(runId: string): Promise<void> {
    const run = await db
      .select({ contextSnapshot: heartbeatRuns.contextSnapshot })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);

    if (!run) return;

    const context = (run.contextSnapshot ?? {}) as Record<string, unknown>;
    if (context.detachedRunWarning) {
      delete context.detachedRunWarning;
      await db
        .update(heartbeatRuns)
        .set({
          contextSnapshot: context,
          updatedAt: new Date(),
        })
        .where(eq(heartbeatRuns.id, runId));
    }
  }

  return {
    isProcessAlive,
    reapOrphanedRuns,
    persistProcessMetadata,
    clearDetachedRunWarning,
  };
}
