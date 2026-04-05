# Dispatcher & Report Daemon 集成方案

**状态**: 设计阶段
**目标**: 将外部脚本集成到 Paperclip 核心，消除环境变量依赖和密钥管理复杂度

---

## 当前架构问题

### Dispatcher (paperclip-dispatcher)
- **位置**: `~/.local/bin/paperclip-dispatcher` (独立 Python 脚本)
- **触发**: 手动执行或 cron/systemd timer
- **问题**:
  1. 硬编码 LiteLLM 密钥为默认值
  2. 重复实现 HTTP 请求逻辑（Paperclip API 已有 SDK）
  3. Agent 路由表硬编码，无法动态更新
  4. 无法利用 Paperclip 内部服务（budget、permissions 等）

### Report Daemon (paperclip-report-daemon.sh)
- **位置**: `~/.local/bin/paperclip-report-daemon.sh` (独立 Bash 脚本)
- **触发**: systemd user service，30秒轮询
- **问题**:
  1. 轮询效率低（95% 时间无新 runs）
  2. 需要专用 API key (`PAPERCLIP_REPORT_DAEMON_KEY`)
  3. 竞态条件（已修复 flock，但仍有开销）
  4. 无法访问内部状态（需二次 API 调用获取 agent 名称）

---

## 集成方案

### Phase 1: Dispatcher 集成（优先级 P1）

#### 1.1 数据层

在 `packages/db/src/schema/` 创建 `dispatch_rules.ts`:

```typescript
export const dispatchRules = pgTable("dispatch_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  category: text("category").notNull(), // "coding", "architecture", etc.
  targetAgentId: uuid("target_agent_id").notNull().references(() => agents.id),
  fallbackAgentId: uuid("fallback_agent_id").references(() => agents.id),
  keywords: jsonb("keywords").$type<string[]>().notNull(),
  priority: integer("priority").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  companyCategoryIdx: index("dispatch_rules_company_category_idx").on(
    table.companyId,
    table.category,
  ),
}));
```

#### 1.2 服务层

创建 `server/src/services/auto-dispatch.ts`:

```typescript
export function autoDispatchService(db: Db) {
  async function routeIssue(
    issue: Issue,
    companyId: string,
  ): Promise<{ agentId: string; reason: string }> {
    // 1. 加载调度规则
    const rules = await db
      .select()
      .from(dispatchRules)
      .where(
        and(
          eq(dispatchRules.companyId, companyId),
          eq(dispatchRules.enabled, true),
        ),
      )
      .orderBy(desc(dispatchRules.priority));

    // 2. 关键词匹配
    const category = matchKeywords(issue.title, issue.description, rules);

    // 3. LLM 路由（如果关键词无法匹配）
    if (!category) {
      return await llmRoute(issue, companyId);
    }

    // 4. 检查 agent 状态并应用 fallback
    const rule = rules.find((r) => r.category === category);
    const agentStatus = await getAgentStatus(rule.targetAgentId);

    if (agentStatus === "error" && rule.fallbackAgentId) {
      return { agentId: rule.fallbackAgentId, reason: "primary_agent_error" };
    }

    return { agentId: rule.targetAgentId, reason: `keyword_match:${category}` };
  }

  async function processUnassignedIssues(companyId: string): Promise<number> {
    const unassigned = await issueService(db).listUnassigned(companyId);
    let assigned = 0;

    for (const issue of unassigned) {
      const { agentId, reason } = await routeIssue(issue, companyId);
      await issueService(db).assign(issue.id, agentId, { source: "auto_dispatch", reason });
      assigned++;
    }

    return assigned;
  }

  return { routeIssue, processUnassignedIssues };
}
```

#### 1.3 定时任务

**方案 A**: 使用 Routine 系统（推荐）

在 Paperclip UI 创建 Routine:
- **Type**: interval
- **Interval**: 15 分钟
- **Action**: 调用 `/api/companies/:id/dispatch/process`

**方案 B**: Node.js cron job

```typescript
// server/src/cron/dispatcher.ts
import cron from "node-cron";

export function startDispatcherCron(db: Db) {
  if (process.env.DISABLE_AUTO_DISPATCH === "true") return;

  cron.schedule("*/15 * * * *", async () => {
    const companies = await db.select({ id: companies.id }).from(companies);
    for (const company of companies) {
      try {
        const count = await autoDispatchService(db).processUnassignedIssues(company.id);
        if (count > 0) {
          logger.info({ companyId: company.id, count }, "auto-dispatched issues");
        }
      } catch (err) {
        logger.error({ err, companyId: company.id }, "auto-dispatch failed");
      }
    }
  });
}
```

#### 1.4 API 路由

```typescript
// server/src/routes/dispatch.ts
router.post("/companies/:companyId/dispatch/process", async (req, res) => {
  assertCompanyAccess(req, req.params.companyId);
  const count = await autoDispatchService(db).processUnassignedIssues(req.params.companyId);
  res.json({ dispatched: count });
});

router.get("/companies/:companyId/dispatch/rules", async (req, res) => {
  // 返回调度规则列表
});

router.post("/companies/:companyId/dispatch/rules", async (req, res) => {
  // 创建调度规则
});
```

---

### Phase 2: Report Daemon 重构（优先级 P2）

#### 2.1 Webhook 模式

**触发器**: Heartbeat run 状态变更时推送事件

```typescript
// server/src/services/heartbeat.ts (现有代码中添加)
async function finalizeAgentStatus(agentId: string, outcome: string) {
  // ... 现有逻辑 ...

  // 新增: 发送 webhook 通知
  await sendRunCompletionNotification(run);
}

async function sendRunCompletionNotification(run: HeartbeatRun) {
  const webhooks = await db
    .select()
    .from(companyWebhooks)
    .where(
      and(
        eq(companyWebhooks.companyId, run.companyId),
        eq(companyWebhooks.event, "heartbeat.run.completed"),
        eq(companyWebhooks.enabled, true),
      ),
    );

  for (const webhook of webhooks) {
    try {
      await fetch(webhook.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event: "heartbeat.run.completed",
          run: {
            id: run.id,
            agentId: run.agentId,
            status: run.status,
            finishedAt: run.finishedAt,
          },
        }),
      });
    } catch (err) {
      logger.warn({ err, webhookId: webhook.id }, "webhook delivery failed");
    }
  }
}
```

#### 2.2 内部通知服务

创建 `server/src/services/notifications.ts`:

```typescript
export function notificationService(db: Db) {
  async function onRunCompleted(run: HeartbeatRun) {
    const agent = await getAgent(run.agentId);
    const issue = run.contextSnapshot?.issueId
      ? await getIssue(run.contextSnapshot.issueId)
      : null;

    // 1. 生成报告
    const report = await generateRunReport(run, agent, issue);
    await saveReport(report);

    // 2. 发送桌面通知（如果配置）
    await sendDesktopNotification({
      title: `${run.status === "succeeded" ? "✅" : "❌"} ${agent.name} 完成`,
      body: `费用: $${run.usageJson?.costUsd ?? 0}`,
    });

    // 3. 发送 Telegram（如果配置）
    await sendTelegramNotification({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: formatRunSummary(run, agent),
    });
  }

  return { onRunCompleted };
}
```

#### 2.3 移除轮询

删除 `paperclip-report-daemon.service`，改为：
1. Paperclip server 内部调用 `notificationService.onRunCompleted()`
2. 或配置 webhook 指向本地通知服务

---

## 迁移路径

### Week 1: Dispatcher 集成
- [ ] 创建 `dispatch_rules` 表和 migration
- [ ] 实现 `auto-dispatch` service
- [ ] 添加 API 路由
- [ ] 迁移现有 Python 脚本中的路由规则到数据库
- [ ] 测试自动分配功能
- [ ] 在 Paperclip UI 添加规则管理界面

### Week 2: Report Daemon 重构
- [ ] 实现 `notifications` service
- [ ] 在 heartbeat finalize 中调用通知
- [ ] 测试报告生成和通知发送
- [ ] 停用 systemd report-daemon.service
- [ ] 删除 `~/.local/bin/paperclip-report-daemon.sh`

### Week 3: 清理与优化
- [ ] 删除独立 Python dispatcher 脚本
- [ ] 清理 secrets.env 中的 dispatcher 密钥
- [ ] 文档更新
- [ ] 性能测试（webhook vs 轮询）

---

## 优势对比

| 维度 | 当前（脚本） | 集成后 |
|------|-------------|--------|
| **密钥管理** | 2 个独立密钥 | 内部调用，无需密钥 |
| **配置管理** | 硬编码 + env vars | 数据库驱动 + UI 配置 |
| **延迟** | 最高 15 分钟（dispatcher）<br>最高 30 秒（daemon） | 实时（webhook）|
| **资源占用** | 持续轮询 | 事件驱动 |
| **可维护性** | 2 个独立脚本 + systemd | 单一代码库 |
| **权限控制** | API key 粗粒度 | 内部服务细粒度 |
| **扩展性** | 手动修改脚本 | UI 可配置规则 |

---

## 风险评估

**High Risk**:
- Webhook 失败时无重试机制 → 需要实现 dead letter queue

**Medium Risk**:
- LLM 路由失败回退策略不完善 → 需要明确 fallback 链

**Low Risk**:
- 迁移过程中双运行（脚本 + 服务） → 可能重复分配任务，需加幂等性检查

---

## 实施决策

**推荐**: Phase 1 优先实施（Dispatcher 集成），Phase 2 延后

**理由**:
1. Dispatcher 逻辑更复杂，收益更大（动态规则、权限控制）
2. Report Daemon 当前方案已稳定（flock 修复后），webhook 迁移非必需
3. 分阶段降低风险，逐步验证架构

**下一步**: 创建 `dispatch_rules` migration，实现基础 service 层
