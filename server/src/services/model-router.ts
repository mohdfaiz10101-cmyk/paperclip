/**
 * Model Router Service
 *
 * Automatically routes issues to the appropriate agent based on label names.
 * When an issue is created with labels but no explicit assignee, the router
 * checks label names against a configurable mapping and assigns the best
 * matching agent.
 *
 * Priority order: first matching label wins (labels checked in priority order).
 */

import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, labels, issueLabels } from "@paperclipai/db";

/** Label-name patterns mapped to agent roles, checked in priority order. */
const LABEL_ROUTING_RULES: ReadonlyArray<{
  labelPatterns: string[];
  agentRole: string;
  agentNamePrefix?: string;
}> = [
  // High-priority: code review goes to CTO/Opus
  { labelPatterns: ["review"], agentRole: "cto", agentNamePrefix: "Opus" },
  // Core engineering tasks
  { labelPatterns: ["code", "feature", "bug"], agentRole: "engineer", agentNamePrefix: "Sonnet" },
  // CRM follow-up tasks
  { labelPatterns: ["crm", "crm-followup", "followup"], agentRole: "engineer", agentNamePrefix: "Sonnet" },
  // Image / visual analysis
  { labelPatterns: ["image", "image-analysis", "visual"], agentRole: "analyst" },
  // Research tasks
  { labelPatterns: ["research"], agentRole: "researcher", agentNamePrefix: "DeepSeek" },
  // WeChat analysis and translation (Chinese-centric)
  { labelPatterns: ["wechat", "wechat-analysis", "translation"], agentRole: "pm", agentNamePrefix: "GLM" },
  // Documentation generation
  { labelPatterns: ["documentation", "docs-gen"], agentRole: "engineer" },
  // Chinese content, product, general docs
  { labelPatterns: ["chinese", "product", "docs"], agentRole: "pm", agentNamePrefix: "GLM" },
];

export interface RouteResult {
  agentId: string;
  agentName: string;
  matchedLabel: string;
  rule: string;
}

/**
 * Given a set of label IDs on a newly created issue, resolve the best agent
 * to assign.  Returns null when no routing rule matches or the target agent
 * cannot be found.
 */
export async function routeIssueByLabels(
  db: Db,
  companyId: string,
  labelIds: string[],
): Promise<RouteResult | null> {
  if (labelIds.length === 0) return null;

  // Fetch the actual label rows so we can match by name.
  const labelRows = await db
    .select({ id: labels.id, name: labels.name })
    .from(labels)
    .where(and(eq(labels.companyId, companyId), inArray(labels.id, labelIds)));

  if (labelRows.length === 0) return null;

  const labelNameSet = new Set(labelRows.map((l) => l.name.toLowerCase()));

  // Walk rules in priority order; first match wins.
  for (const rule of LABEL_ROUTING_RULES) {
    const matchedLabel = rule.labelPatterns.find((p) => labelNameSet.has(p));
    if (!matchedLabel) continue;

    // Find a matching agent in this company.
    const companyAgents = await db
      .select({ id: agents.id, name: agents.name, role: agents.role, status: agents.status })
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.role, rule.agentRole)));

    // Prefer agent whose name starts with the expected prefix.
    let target = rule.agentNamePrefix
      ? companyAgents.find((a) => a.name.startsWith(rule.agentNamePrefix!))
      : companyAgents[0];

    if (!target && companyAgents.length > 0) target = companyAgents[0];
    if (!target) continue;

    return {
      agentId: target.id,
      agentName: target.name,
      matchedLabel,
      rule: `${rule.labelPatterns.join("|")} → ${rule.agentRole}`,
    };
  }

  return null;
}

/**
 * Resolve labels for an already-created issue (when labelIds were not passed
 * during creation but labels were synced separately).
 */
export async function routeIssueByIssueId(
  db: Db,
  companyId: string,
  issueId: string,
): Promise<RouteResult | null> {
  const rows = await db
    .select({ labelId: issueLabels.labelId })
    .from(issueLabels)
    .where(eq(issueLabels.issueId, issueId));

  if (rows.length === 0) return null;
  return routeIssueByLabels(db, companyId, rows.map((r) => r.labelId));
}

/**
 * Find the designated code-review agent for a company.
 * Looks for agents with role "cto" and name starting with "Opus".
 * Returns the agent id or null if not found.
 */
export async function findReviewAgent(
  db: Db,
  companyId: string,
): Promise<{ id: string; name: string } | null> {
  const reviewRule = LABEL_ROUTING_RULES.find((r) => r.labelPatterns.includes("review"));
  if (!reviewRule) return null;

  const companyAgents = await db
    .select({ id: agents.id, name: agents.name, role: agents.role })
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.role, reviewRule.agentRole)));

  const target = reviewRule.agentNamePrefix
    ? companyAgents.find((a) => a.name.startsWith(reviewRule.agentNamePrefix!))
    : companyAgents[0];

  if (!target && companyAgents.length > 0) return companyAgents[0];
  return target ?? null;
}
