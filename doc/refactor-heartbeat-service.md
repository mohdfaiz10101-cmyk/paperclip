# Heartbeat Service 重构计划

**当前状态**: God File — 3877 行，43 个函数，60+ 依赖导入
**目标**: 模块化 — 6-7 个职责清晰的子模块，< 1500 行主文件

---

## 当前问题分析

### 代码指标
| 指标 | 当前 | 目标 | 偏离度 |
|------|------|------|--------|
| **文件行数** | 3877 | < 1500 | **258%** |
| **函数数量** | 43 | < 15 (主文件) | 287% |
| **依赖导入** | 60+ | < 20 (主文件) | 300% |
| **嵌套层级** | 最深 6 层 | < 4 层 | 150% |
| **圈复杂度** | executeHeartbeatRun: 50+ | < 10 | 500% |

### 职责混杂

当前 `heartbeat.ts` 包含：
1. **进程管理** (138 处 execFile/spawn 调用)
2. **队列调度** (claim/reap/priority 逻辑)
3. **执行引擎** (adapter 调用 + 日志收集)
4. **完成处理** (cost 计算 + session 管理 + feedback)
5. **策略解析** (heartbeat policy + budget check)
6. **状态机管理** (run status 转换 + agent status 同步)
7. **数据库操作** (大量 raw SQL + ORM 混用)

---

## 重构策略

### Phase 1: 提取独立模块（不修改主文件接口）

#### 模块 1: `heartbeat-process-manager.ts` (300 行)

**职责**: 进程生命周期管理

```typescript
export interface ProcessManager {
  /** 检查进程是否存活 */
  isProcessAlive(pid: number): Promise<boolean>;

  /** 清理孤儿进程 */
  reapOrphanedRuns(companyId: string): Promise<number>;

  /** 记录进程元数据 */
  persistProcessMetadata(runId: string, meta: ProcessMeta): Promise<void>;

  /** 清理分离运行的警告 */
  clearDetachedRunWarning(runId: string): Promise<void>;
}
```

**提取函数**:
- `isProcessAlive()` (当前第 1200 行附近)
- `reapOrphanedRuns()` (当前第 1733-1810 行)
- `persistRunProcessMetadata()` (当前第 850 行)
- `clearDetachedRunWarning()` (当前第 900 行)

**依赖注入**:
```typescript
export function createProcessManager(deps: {
  db: Db;
  logger: Logger;
}): ProcessManager {
  return {
    async isProcessAlive(pid) {
      if (process.platform === "win32") {
        // Windows 实现
      } else {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      }
    },
    // ...
  };
}
```

---

#### 模块 2: `heartbeat-run-finalizer.ts` (500 行)

**职责**: Run 完成后的清理和状态更新

```typescript
export interface RunFinalizer {
  /** 处理成功完成的 run */
  finalizeSuccess(run: Run, result: AdapterResult): Promise<void>;

  /** 处理失败的 run */
  finalizeFailure(run: Run, error: Error): Promise<void>;

  /** 处理取消的 run */
  finalizeCancellation(run: Run): Promise<void>;

  /** 处理超时的 run */
  finalizeTimeout(run: Run): Promise<void>;
}
```

**提取逻辑**:
- 当前第 2600-2797 行的完成处理内嵌代码
- Cost 计算和规范化
- Session 状态管理
- Agent feedback 记录
- Issue execution release

**状态机**:
```typescript
type RunOutcome = "succeeded" | "failed" | "cancelled" | "timed_out";

async function determineOutcome(
  run: Run,
  result: AdapterResult,
): Promise<RunOutcome> {
  if (run.status === "cancelled") return "cancelled";
  if (result.timedOut) return "timed_out";
  if ((result.exitCode ?? 0) === 0 && !result.errorMessage) return "succeeded";
  return "failed";
}
```

---

#### 模块 3: `heartbeat-queue-manager.ts` (400 行)

**职责**: Run 队列管理和优先级调度

```typescript
export interface QueueManager {
  /** 从队列中认领一个 run */
  claimRun(runId: string, agentId: string): Promise<Run | null>;

  /** 取消 run */
  cancelRun(runId: string, reason: string): Promise<void>;

  /** 获取下一个待执行的 run */
  getNextQueuedRun(agentId: string): Promise<Run | null>;

  /** 检查是否允许执行 */
  canExecute(agent: Agent, run: Run): Promise<{ allowed: boolean; reason?: string }>;
}
```

**提取函数**:
- `claimQueuedRun()` (当前第 1632-1685 行)
- `cancelRunInternal()` (当前第 1550 行)
- `startNextQueuedRunForAgent()` (当前第 1900 行)
- `countRunningRunsForAgent()` (当前第 1620 行)

**分离职责**:
```typescript
// ❌ 当前：混合了验证、数据库更新、事件发布
async function claimQueuedRun(run) {
  if (run.status !== "queued") return run;
  const agent = await getAgent(run.agentId);

  if (agent.status === "paused") {
    await cancelRunInternal(...);
    return null;
  }

  const budgetBlock = await budgets.getInvocationBlock(...);
  if (budgetBlock) {
    await cancelRunInternal(...);
    return null;
  }

  const claimed = await db.update(heartbeatRuns).set({...}).returning();
  publishLiveEvent({ ... });
  await setWakeupStatus(...);
  return claimed;
}

// ✅ 重构后：分离验证、执行、通知
async function canClaim(run: Run): Promise<ValidationResult> {
  // 纯验证逻辑，无副作用
}

async function claimInDb(run: Run): Promise<Run | null> {
  // 仅数据库操作，事务包裹
}

async function notifyClaimed(run: Run): Promise<void> {
  // 仅事件发布
}
```

---

#### 模块 4: `heartbeat-executor.ts` (600 行)

**职责**: Adapter 执行和日志收集

```typescript
export interface Executor {
  /** 执行 adapter 并收集日志 */
  execute(ctx: ExecutionContext): Promise<AdapterExecutionResult>;

  /** 初始化日志收集器 */
  setupLogging(run: Run): Promise<LogHandle>;

  /** 准备执行环境 */
  prepareEnvironment(agent: Agent, run: Run): Promise<ExecutionEnvironment>;
}
```

**提取范围**:
- Adapter 调用逻辑 (当前第 2516-2576 行)
- 日志处理 onLog callback (当前第 2401-2432 行)
- Runtime services 管理 (当前第 2442-2485 行)
- Workspace 准备逻辑 (当前第 2100-2300 行)

---

#### 模块 5: `heartbeat-policies.ts` (200 行)

**职责**: 策略解析和决策

```typescript
export interface PolicyEngine {
  /** 解析 heartbeat 策略 */
  parsePolicy(agent: Agent): HeartbeatPolicy;

  /** 检查预算限制 */
  checkBudget(agent: Agent): Promise<BudgetCheck>;

  /** 评估 session 压缩需求 */
  evaluateSessionCompaction(session: Session): Promise<CompactionDecision>;
}
```

**提取函数**:
- `parseHeartbeatPolicy()` (当前第 1612 行)
- `evaluateSessionCompaction()` (当前第 2309 行)
- Budget 检查逻辑 (当前散布在多处)

---

#### 模块 6: `heartbeat-core.ts` (< 1500 行) — 主入口

**职责**: Orchestration（编排子模块）

```typescript
export function heartbeatService(db: Db) {
  const processManager = createProcessManager({ db, logger });
  const queueManager = createQueueManager({ db, logger });
  const executor = createExecutor({ db, logger });
  const finalizer = createRunFinalizer({ db, logger });
  const policyEngine = createPolicyEngine({ db });

  async function executeHeartbeatRun(runId: string): Promise<void> {
    const run = await getRun(runId);
    if (!run) throw new Error("Run not found");

    // 1. Claim run
    const claimed = await queueManager.claimRun(run.id, run.agentId);
    if (!claimed) return;

    try {
      // 2. Prepare environment
      const env = await executor.prepareEnvironment(agent, run);

      // 3. Execute adapter
      const result = await executor.execute({ run, env, agent });

      // 4. Finalize based on outcome
      await finalizer.finalize(run, result);
    } catch (err) {
      await finalizer.finalizeFailure(run, err);
    } finally {
      await queueManager.startNextQueuedRun(run.agentId);
    }
  }

  return {
    executeHeartbeatRun,
    wakeup,
    cleanup: processManager.reapOrphanedRuns,
    // ...
  };
}
```

---

### Phase 2: 统一错误处理（Week 2）

创建 `heartbeat-errors.ts`:

```typescript
export enum HeartbeatErrorCode {
  AGENT_NOT_FOUND = "agent_not_found",
  BUDGET_EXCEEDED = "budget_exceeded",
  ADAPTER_FAILED = "adapter_failed",
  TIMEOUT = "timeout",
  PROCESS_DIED = "process_died",
  DB_ERROR = "db_error",
}

export class HeartbeatError extends Error {
  constructor(
    public code: HeartbeatErrorCode,
    message: string,
    public isRecoverable: boolean = false,
  ) {
    super(message);
    this.name = "HeartbeatError";
  }
}

// 使用示例
throw new HeartbeatError(
  HeartbeatErrorCode.BUDGET_EXCEEDED,
  "Monthly budget limit reached",
  false, // 不可恢复，需要人工介入
);
```

**替换所有 catch 块**:
```typescript
// ❌ 当前
catch (error) {
  throw new Error(`Failed to...`);
}

// ✅ 重构后
catch (error) {
  throw new HeartbeatError(
    HeartbeatErrorCode.ADAPTER_FAILED,
    `Adapter execution failed: ${error.message}`,
    true, // 可重试
  );
}
```

---

### Phase 3: 测试策略（Week 3）

当前：**无法单元测试**（all-in-one 单体 + 强依赖）

重构后：**每个模块独立可测**

```typescript
// 示例：测试 ProcessManager
import { createProcessManager } from "./heartbeat-process-manager.js";

test("isProcessAlive returns false for non-existent PID", async () => {
  const pm = createProcessManager({ db: mockDb, logger: mockLogger });
  const result = await pm.isProcessAlive(999999);
  expect(result).toBe(false);
});

test("reapOrphanedRuns marks stale runs as failed", async () => {
  const pm = createProcessManager({ db: mockDb, logger: mockLogger });
  // 模拟 3 个孤儿 runs
  const count = await pm.reapOrphanedRuns("company-123");
  expect(count).toBe(3);
  // 验证数据库状态变更
});
```

---

## 迁移路径

### Week 1: 基础模块提取
- [x] 创建 `heartbeat-process-manager.ts`
- [x] 提取 `isProcessAlive` + `reapOrphanedRuns`
- [ ] 在主文件中切换到新模块
- [ ] 验证现有功能无退化

### Week 2: 复杂模块提取
- [ ] 创建 `heartbeat-run-finalizer.ts`
- [ ] 提取完成处理逻辑
- [ ] 创建 `heartbeat-queue-manager.ts`
- [ ] 统一错误处理体系

### Week 3: 主文件瘦身
- [ ] 创建 `heartbeat-executor.ts`
- [ ] 创建 `heartbeat-policies.ts`
- [ ] 重写 `heartbeat-core.ts`（主入口）
- [ ] 删除旧代码

### Week 4: 测试与优化
- [ ] 为每个模块编写单元测试
- [ ] 集成测试覆盖主要流程
- [ ] 性能测试（确保无性能退化）
- [ ] 文档更新

---

## 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| **功能退化** | 高 | 严重 | 每周回归测试 + E2E 覆盖 |
| **性能退化** | 中 | 中等 | Benchmark 对比 + 性能 profile |
| **接口破坏** | 低 | 严重 | 保持外部 API 不变 + 版本控制 |
| **并发 bug** | 中 | 高 | 增加并发测试用例 |

---

## 成功指标

- [ ] 主文件 < 1500 行
- [ ] 每个模块 < 600 行
- [ ] 单元测试覆盖率 > 80%
- [ ] 圈复杂度 < 10 (主要函数)
- [ ] 无功能退化（所有 E2E 测试通过）
- [ ] 性能无退化（± 5% 允许范围内）

---

## 下一步

1. **立即**: 创建 `heartbeat-process-manager.ts`（示例模块）
2. **本周**: 提取 process management 逻辑并验证
3. **下周**: 启动 Week 2 计划

**预计总时间**: 4 周（1 人全职，每周 40 小时）
