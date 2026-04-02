/**
 * Agent Feedback Service
 *
 * Tracks agent execution outcomes and computes per-agent performance scores.
 * Uses the existing activity_log table for persistence (action = "agent.run_feedback")
 * and queries heartbeat_runs for aggregate statistics.
 *
 * No new database tables are required.
 */

import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { activityLog, heartbeatRuns } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { logActivity } from "./activity-log.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentFeedback {
  agentId: string;
  companyId: string;
  runId: string;
  issueId: string | null;
  success: boolean;
  durationMs: number;
  modelUsed: string | null;
  timestamp: Date;
}

export interface AgentPerformanceScore {
  agentId: string;
  totalRuns: number;
  succeededRuns: number;
  failedRuns: number;
  successRate: number;
  avgDurationMs: number;
  recentTrend: "improving" | "stable" | "declining";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FEEDBACK_ACTION = "agent.run_feedback";
const SCORE_WINDOW_DAYS = 30;
const TREND_RECENT_WINDOW = 7;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function agentFeedbackService(db: Db) {
  /**
   * Record feedback for a completed agent run. Persists to activity_log so
   * no schema migration is needed.
   */
  async function recordFeedback(feedback: AgentFeedback): Promise<void> {
    try {
      await logActivity(db, {
        companyId: feedback.companyId,
        actorType: "system",
        actorId: "agent-feedback",
        action: FEEDBACK_ACTION,
        entityType: "agent",
        entityId: feedback.agentId,
        agentId: feedback.agentId,
        runId: feedback.runId,
        details: {
          issueId: feedback.issueId,
          success: feedback.success,
          durationMs: feedback.durationMs,
          modelUsed: feedback.modelUsed,
          timestamp: feedback.timestamp.toISOString(),
        },
      });
    } catch (err) {
      logger.warn(
        { err, agentId: feedback.agentId, runId: feedback.runId },
        "failed to record agent feedback",
      );
    }
  }

  /**
   * Compute a performance score for an agent based on heartbeat_runs over
   * the last SCORE_WINDOW_DAYS days.
   */
  async function getAgentScore(
    companyId: string,
    agentId: string,
  ): Promise<AgentPerformanceScore> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - SCORE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const trendStart = new Date(now.getTime() - TREND_RECENT_WINDOW * 24 * 60 * 60 * 1000);

    // Aggregate over the full window
    const [fullWindow] = await db
      .select({
        totalRuns: sql<number>`count(*)::int`,
        succeededRuns: sql<number>`count(*) filter (where ${heartbeatRuns.status} = 'succeeded')::int`,
        failedRuns: sql<number>`count(*) filter (where ${heartbeatRuns.status} = 'failed')::int`,
        avgDurationMs: sql<number>`coalesce(
          avg(
            extract(epoch from (${heartbeatRuns.finishedAt} - ${heartbeatRuns.startedAt})) * 1000
          )::int,
          0
        )`,
      })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          eq(heartbeatRuns.agentId, agentId),
          gte(heartbeatRuns.createdAt, windowStart),
          sql`${heartbeatRuns.status} in ('succeeded', 'failed')`,
        ),
      );

    // Aggregate over the recent trend window
    const [recentWindow] = await db
      .select({
        succeededRuns: sql<number>`count(*) filter (where ${heartbeatRuns.status} = 'succeeded')::int`,
        totalRuns: sql<number>`count(*)::int`,
      })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          eq(heartbeatRuns.agentId, agentId),
          gte(heartbeatRuns.createdAt, trendStart),
          sql`${heartbeatRuns.status} in ('succeeded', 'failed')`,
        ),
      );

    const total = fullWindow?.totalRuns ?? 0;
    const succeeded = fullWindow?.succeededRuns ?? 0;
    const failed = fullWindow?.failedRuns ?? 0;
    const avgDurationMs = fullWindow?.avgDurationMs ?? 0;
    const overallRate = total > 0 ? succeeded / total : 0;

    const recentTotal = recentWindow?.totalRuns ?? 0;
    const recentSucceeded = recentWindow?.succeededRuns ?? 0;
    const recentRate = recentTotal > 0 ? recentSucceeded / recentTotal : 0;

    let recentTrend: "improving" | "stable" | "declining" = "stable";
    if (total >= 5 && recentTotal >= 2) {
      const delta = recentRate - overallRate;
      if (delta > 0.1) recentTrend = "improving";
      else if (delta < -0.1) recentTrend = "declining";
    }

    return {
      agentId,
      totalRuns: total,
      succeededRuns: succeeded,
      failedRuns: failed,
      successRate: Math.round(overallRate * 1000) / 1000,
      avgDurationMs,
      recentTrend,
    };
  }

  /**
   * Get performance scores for all agents in a company.
   */
  async function getCompanyScores(
    companyId: string,
  ): Promise<AgentPerformanceScore[]> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - SCORE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        agentId: heartbeatRuns.agentId,
        totalRuns: sql<number>`count(*)::int`,
        succeededRuns: sql<number>`count(*) filter (where ${heartbeatRuns.status} = 'succeeded')::int`,
        failedRuns: sql<number>`count(*) filter (where ${heartbeatRuns.status} = 'failed')::int`,
        avgDurationMs: sql<number>`coalesce(
          avg(
            extract(epoch from (${heartbeatRuns.finishedAt} - ${heartbeatRuns.startedAt})) * 1000
          )::int,
          0
        )`,
      })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          gte(heartbeatRuns.createdAt, windowStart),
          sql`${heartbeatRuns.status} in ('succeeded', 'failed')`,
        ),
      )
      .groupBy(heartbeatRuns.agentId);

    return rows.map((row) => {
      const rate = row.totalRuns > 0 ? row.succeededRuns / row.totalRuns : 0;
      return {
        agentId: row.agentId,
        totalRuns: row.totalRuns,
        succeededRuns: row.succeededRuns,
        failedRuns: row.failedRuns,
        successRate: Math.round(rate * 1000) / 1000,
        avgDurationMs: row.avgDurationMs,
        recentTrend: "stable" as const,
      };
    });
  }

  return {
    recordFeedback,
    getAgentScore,
    getCompanyScores,
  };
}
