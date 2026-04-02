# Paperclip Codemap

**最后更新:** 2026-04-01
**版本:** V1 Implementation Target
**入口点:** `server/src/index.ts`, `ui/src/App.tsx`

---

## 项目概览

Paperclip 是一个 **AI 代理编排系统**，用于管理和协调多个 AI 代理组成的"公司"。它提供组织架构、目标对齐、预算控制、任务分配、审批流程等企业管理功能。

**核心理念:**
- OpenClaw/Claude Code/Cursor 是"员工"
- Paperclip 是管理这些员工的"公司"
- 任务管理器界面，底层是完整的企业编排系统

---

## 项目结构树

```
paperclip/
├── server/                    # Express 后端 + 编排服务
│   ├── src/
│   │   ├── index.ts          # 服务器启动入口 (746行)
│   │   ├── app.ts            # Express 应用配置
│   │   ├── config.ts         # 配置加载器
│   │   ├── routes/           # API 路由 (18个路由模块)
│   │   ├── services/         # 业务逻辑层 (48k+ 行)
│   │   ├── middleware/       # 认证/鉴权/日志/错误处理
│   │   ├── realtime/         # WebSocket 实时通信
│   │   ├── storage/          # 文件存储抽象层
│   │   └── auth/             # Better Auth 集成
│   └── package.json
│
├── ui/                        # React 前端
│   ├── src/
│   │   ├── App.tsx           # 应用根组件
│   │   ├── pages/            # 路由页面
│   │   ├── components/       # UI 组件
│   │   ├── context/          # React Context (实时更新/公司切换)
│   │   └── lib/              # API 客户端
│   └── package.json
│
├── packages/
│   ├── db/                   # 数据库层
│   │   ├── src/
│   │   │   ├── client.ts     # Drizzle ORM 客户端
│   │   │   ├── schema/       # 59 张表定义
│   │   │   └── migrations/   # 自动生成的迁移文件
│   │   └── drizzle.config.ts
│   │
│   ├── shared/               # 跨包共享代码
│   │   ├── src/
│   │   │   ├── types/        # TypeScript 类型定义
│   │   │   ├── validators/   # Zod 校验器
│   │   │   ├── api.ts        # API 路径常量
│   │   │   └── constants.ts  # 系统常量
│   │   └── package.json
│   │
│   ├── adapters/             # Agent 适配器 (10个)
│   │   ├── openclaw-gateway/ # OpenClaw WebSocket 适配器
│   │   ├── claude-local/     # Claude Code 本地适配器
│   │   ├── cursor-local/     # Cursor 本地适配器
│   │   ├── codex-local/      # Codex 适配器
│   │   ├── opencode-local/   # OpenCode 适配器
│   │   ├── aider-worker/     # Aider 适配器
│   │   ├── glm-http/         # GLM HTTP 适配器
│   │   ├── gemini-local/     # Gemini 本地适配器
│   │   ├── pi-local/         # Pi 本地适配器
│   │   └── deerflow/         # Deerflow 适配器
│   │
│   ├── adapter-utils/        # 适配器共享工具
│   │
│   └── plugins/              # 插件系统
│       ├── sdk/              # 插件 SDK
│       ├── create-paperclip-plugin/  # 插件脚手架
│       ├── plugin-hyperchat-bridge/  # HyperChat 集成
│       └── examples/         # 插件示例
│
├── cli/                      # CLI 工具 (npx paperclipai)
│   └── src/index.ts
│
├── doc/                      # 文档
│   ├── GOAL.md              # 产品目标
│   ├── PRODUCT.md           # 产品定义
│   ├── SPEC.md              # 长期规格
│   ├── SPEC-implementation.md  # V1 实现规格
│   ├── DEVELOPING.md        # 开发指南
│   └── DATABASE.md          # 数据库架构
│
├── skills/                   # Agent 技能模板
├── tests/                    # 测试
│   ├── e2e/                 # Playwright E2E 测试
│   └── release-smoke/       # 发布冒烟测试
│
├── AGENTS.md                 # 开发者 & AI 协作指南
├── CONTRIBUTING.md           # 贡献指南
├── docker-compose.yml        # Docker 部署配置
├── package.json              # Monorepo 根配置
└── pnpm-workspace.yaml       # pnpm 工作区配置
```

---

## 核心架构

### 1. 数据层 (packages/db)

**文件:** `packages/db/src/client.ts` (创建 Drizzle ORM 客户端)

**59 张表 (部分核心表):**

| 表名 | 功能 | 关键字段 |
|------|------|---------|
| `companies` | 公司/组织 | id, name, urlKey, status |
| `agents` | AI 代理员工 | id, companyId, name, role, adapterType, budgetMonthlyCents |
| `issues` | 任务/工单 | id, companyId, projectId, assigneeAgentId, status, priority |
| `projects` | 项目 | id, companyId, name, goalId |
| `goals` | 目标 | id, companyId, parentGoalId, title, description |
| `approvals` | 审批流程 | id, companyId, agentId, status, approvalType |
| `heartbeat_runs` | Agent 心跳执行记录 | id, agentId, status, costCents |
| `heartbeat_run_events` | 心跳事件日志 | id, runId, eventType, payload |
| `company_secrets` | 加密密钥管理 | id, companyId, key, encryptedValue |
| `company_skills` | 公司技能库 | id, companyId, name, content |
| `budget_policies` | 预算策略 | id, agentId, monthlyLimitCents |
| `budget_incidents` | 预算超支事件 | id, agentId, monthlySpendCents |
| `activity_log` | 操作审计日志 | id, companyId, actorType, action |
| `execution_workspaces` | 执行工作空间 | id, companyId, path, runtimeConfig |
| `plugin_config` | 插件配置 | id, companyId, pluginId, enabled |
| `auth_users` | 认证用户 | id, email, name |
| `company_memberships` | 公司成员关系 | id, companyId, principalId, membershipRole |

**数据库模式:**
- 支持嵌入式 PostgreSQL (开发环境)
- 支持外部 PostgreSQL (生产环境)
- 自动迁移管理 (Drizzle Kit)

---

### 2. API 层 (server/src/routes)

**入口:** `server/src/index.ts:startServer()` → `server/src/app.ts:createApp()`

**API 基础路径:** `/api`

#### 核心 API 路由

| 路由文件 | 路径前缀 | 功能 | 关键端点 |
|---------|---------|------|---------|
| `health.ts` | `/api/health` | 健康检查 | GET / |
| `companies.ts` | `/api/companies` | 公司管理 | GET /, POST /, GET /:id, PATCH /:id, DELETE /:id |
| `agents.ts` | `/api/agents` | Agent 管理 | GET /, POST /, GET /:id, PATCH /:id, DELETE /:id, POST /:id/keys |
| `projects.ts` | `/api/projects` | 项目管理 | GET /, POST /, GET /:id, PATCH /:id, DELETE /:id |
| `issues.ts` | `/api/issues` | 任务/工单 | GET /, POST /, GET /:id, PATCH /:id, POST /:id/checkout |
| `goals.ts` | `/api/goals` | 目标管理 | GET /, POST /, GET /:id, PATCH /:id, DELETE /:id |
| `routines.ts` | `/api/routines` | 定时任务 | GET /, POST /, GET /:id, PATCH /:id, DELETE /:id |
| `approvals.ts` | `/api/approvals` | 审批流程 | GET /, POST /, PATCH /:id |
| `secrets.ts` | `/api/secrets` | 密钥管理 | GET /, POST /, PATCH /:id, DELETE /:id |
| `costs.ts` | `/api/costs` | 成本追踪 | GET /monthly, GET /runs |
| `activity.ts` | `/api/activity` | 活动日志 | GET / |
| `dashboard.ts` | `/api/dashboard` | 仪表盘数据 | GET / |
| `llms.ts` | `/api/llms` | LLM 模型配置 | GET /models |
| `access.ts` | `/api/access` | 权限管理 | GET /, POST /, DELETE / |
| `company-skills.ts` | `/api/company-skills` | 技能管理 | GET /, POST /, PATCH /:id, DELETE /:id |
| `sidebar-badges.ts` | `/api/sidebar-badges` | 侧边栏徽章 | GET / |
| `instance-settings.ts` | `/api/instance-settings` | 实例设置 | GET /, PATCH / |
| `execution-workspaces.ts` | `/api/execution-workspaces` | 工作空间 | GET /, POST / |

**认证模式:**
- `local_trusted`: 本地开发，自动创建 `local-board` 用户
- `authenticated`: Better Auth 认证，支持 OAuth

**授权检查:**
- Board (人类管理员): 全权限
- Agent (AI 代理): API Key 认证，公司隔离，权限受限

---

### 3. 业务逻辑层 (server/src/services)

**核心服务索引 (48k+ 行):**

| 服务文件 | 行数估算 | 功能 | 关键函数 |
|---------|---------|------|---------|
| `heartbeat.ts` | 1500+ | Agent 心跳调度 | `tickTimers()`, `enqueueRun()`, `executeRun()` |
| `workspace-runtime.ts` | 1564 | 工作空间运行时管理 | `reconcileServices()`, `startService()` |
| `workspace-operations.ts` | 261 | 工作空间操作日志 | `logOperation()`, `getOperations()` |
| `issue.ts` | 1200+ | 工单生命周期 | `checkout()`, `complete()`, `assign()` |
| `agents.ts` | 800+ | Agent CRUD + 权限 | `create()`, `update()`, `getChainOfCommand()` |
| `budgets.ts` | 500+ | 预算执行与暂停 | `checkBudget()`, `pauseIfOverBudget()` |
| `model-router.ts` | 123 | 任务自动路由 | `routeIssueByLabels()` |
| `secrets.ts` | 400+ | 加密密钥管理 | `encrypt()`, `decrypt()` |
| `company-portability.ts` | 800+ | 公司模板导入/导出 | `exportCompany()`, `importCompany()` |
| `plugin-loader.ts` | 600+ | 插件动态加载 | `loadPlugin()`, `registerPlugin()` |
| `plugin-registry.ts` | 400+ | 插件注册管理 | `getEnabledPlugins()` |
| `plugin-tool-dispatcher.ts` | 300+ | 插件工具调度 | `executeTool()` |
| `dashboard.ts` | 300+ | 仪表盘聚合数据 | `getDashboardStats()` |
| `finance.ts` | 400+ | 财务报告 | `getMonthlySpend()` |
| `work-products.ts` | 123 | 工作产物管理 | `createWorkProduct()` |

**关键编排逻辑:**

1. **心跳系统** (`heartbeat.ts`)
   - 定时触发 Agent 检查任务
   - 原子性任务分配 (checkout)
   - 成本统计与预算检查
   - 孤儿任务回收 (orphaned runs)

2. **任务路由** (`model-router.ts`)
   - 基于标签自动分配任务
   - 规则: `review → cto`, `code/bug → engineer`, `research → researcher`
   - 优先级: 按规则顺序匹配

3. **预算控制** (`budgets.ts`)
   - 每月预算额度检查
   - 超支自动暂停 Agent
   - 事件记录到 `budget_incidents`

4. **工作空间运行时** (`workspace-runtime.ts`)
   - 管理代理执行环境 (Docker/本地进程)
   - 服务生命周期协调
   - 端口/URL 暴露与追踪

---

### 4. 前端层 (ui/src)

**框架:** React 18 + Vite + TanStack Router + Tailwind CSS

**关键页面:**

| 路由 | 页面文件 | 功能 |
|------|---------|------|
| `/` | `pages/index.tsx` | 公司列表 |
| `/:company` | `pages/$company/index.tsx` | 公司仪表盘 |
| `/:company/agents` | `pages/$company/agents/index.tsx` | Agent 列表 |
| `/:company/agents/:agentId` | `pages/$company/agents/$agentId.tsx` | Agent 详情 |
| `/:company/issues` | `pages/$company/issues/index.tsx` | 任务列表 (看板) |
| `/:company/issues/:issueId` | `pages/$company/issues/$issueId.tsx` | 任务详情 |
| `/:company/projects` | `pages/$company/projects/index.tsx` | 项目列表 |
| `/:company/goals` | `pages/$company/goals/index.tsx` | 目标树 |
| `/:company/routines` | `pages/$company/routines/index.tsx` | 定时任务 |
| `/:company/settings` | `pages/$company/settings.tsx` | 公司设置 |

**关键组件:**

- **`CompanyRail.tsx`**: 公司切换侧边栏
- **`ActiveAgentsPanel.tsx`**: 实时 Agent 状态面板
- **`OnboardingWizard.tsx`**: 新用户引导
- **`NewIssueDialog.tsx`**: 创建任务对话框
- **`ApprovalCard.tsx`**: 审批卡片
- **`RunTranscriptView.tsx`**: Agent 执行日志查看器
- **`ScheduleEditor.tsx`**: Cron 表达式编辑器

**Context 管理:**

- **`CompanyContext`**: 当前公司选择状态
- **`LiveUpdatesProvider`**: WebSocket 实时更新
- **`ThemeContext`**: 亮/暗主题切换
- **`ToastContext`**: 全局提示消息
- **`DialogContext`**: 对话框管理

**实时通信:**
- WebSocket 连接到 `/ws`
- 事件类型: `issue:updated`, `agent:heartbeat`, `approval:created`
- 自动重连机制

---

### 5. Adapter 系统 (packages/adapters)

**Adapter 清单:**

| Adapter | 类型 | 协议 | 用途 |
|---------|------|------|------|
| `openclaw-gateway` | WebSocket | Gateway Protocol | OpenClaw 原生网关连接 |
| `claude-local` | 本地进程 | HTTP/CLI | Claude Code 本地实例 |
| `cursor-local` | 本地进程 | HTTP/CLI | Cursor IDE 集成 |
| `codex-local` | 本地进程 | HTTP/CLI | Codex 本地实例 |
| `opencode-local` | 本地进程 | HTTP/CLI | OpenCode 集成 |
| `aider-worker` | 后台进程 | CLI | Aider 命令行工具 |
| `glm-http` | HTTP API | REST | GLM (智谱) HTTP 接口 |
| `gemini-local` | 本地进程 | HTTP/CLI | Gemini 本地实例 |
| `pi-local` | 本地进程 | HTTP/CLI | Pi 本地实例 |
| `deerflow` | HTTP API | REST | Deerflow 集成 |

**Adapter 接口规范:**

每个 adapter 必须实现:

```typescript
export const type: string;              // 适配器类型标识
export const label: string;             // 显示名称
export const models: Array<{id, label}>; // 支持的模型列表
export const agentConfigurationDoc: string; // 配置文档
```

**工作流程:**
1. Agent 收到任务分配
2. Heartbeat 服务调用对应 adapter
3. Adapter 将 Paperclip 任务转换为特定格式
4. Agent 执行并返回结果
5. Adapter 将结果标准化后返回

**示例:** OpenClaw Gateway Adapter (`openclaw-gateway/src/index.ts`)
- 建立 WebSocket 连接
- 发送 `agent.wake` 消息
- 等待 `agent.response` 或 `agent.error`
- 支持会话路由 (issue/fixed/run)

---

### 6. 插件系统 (packages/plugins)

**核心包:**

- **`sdk`**: 插件开发 SDK
  - Hook 类型: `PreIssueCreate`, `PostIssueUpdate`, `AgentWake`, etc.
  - 工具注册: `registerTool()`
  - 状态管理: `getState()`, `setState()`

- **`create-paperclip-plugin`**: 插件脚手架生成器
  - `npm create paperclip-plugin@latest`

**插件示例:**

- **`plugin-hyperchat-bridge`**: HyperChat 集成
- **`plugin-hello-world-example`**: 最小示例
- **`plugin-kitchen-sink-example`**: 完整功能示例
- **`plugin-file-browser-example`**: 文件浏览工具

**插件生命周期:**

1. 加载: `plugin-loader.ts` 动态导入插件
2. 注册: `plugin-registry.ts` 管理插件元数据
3. Hook 触发: `plugin-hook-dispatcher.ts` 调用插件 Hook
4. 工具调度: `plugin-tool-dispatcher.ts` 执行插件工具

---

## 关键流程

### 1. 任务创建与自动分配

```
UI: POST /api/issues (labels: ["code"])
  ↓
routes/issues.ts:createIssue()
  ↓
services/model-router.ts:routeIssueByLabels()
  ├─ 匹配标签 "code" → 规则: engineer
  └─ 查找 companyAgents (role=engineer, name startsWith "Sonnet")
  ↓
分配给 Sonnet Engineer
  ↓
services/issue-assignment-wakeup.ts:queueIssueAssignmentWakeup()
  ↓
触发 Agent 心跳
```

### 2. Agent 心跳执行

```
定时器触发 (默认 30s)
  ↓
services/heartbeat.ts:tickTimers()
  ├─ 检查所有 Agent 的 nextHeartbeatAt
  └─ 对到期 Agent 调用 enqueueRun()
  ↓
enqueueRun() → 创建 heartbeat_runs 记录
  ↓
executeRun()
  ├─ 调用 Adapter (如 openclaw-gateway)
  ├─ 传递任务上下文 (issue, project, goal)
  └─ 等待 Agent 响应
  ↓
记录成本到 heartbeat_runs.costCents
  ↓
services/budgets.ts:checkBudget()
  └─ 如果超支 → pauseIfOverBudget() → status=paused
```

### 3. 任务签出 (Checkout)

```
Agent: POST /api/issues/:id/checkout
  ↓
routes/issues.ts:checkoutIssue()
  ↓
services/issue.ts:checkout()
  ├─ 原子性检查: status=todo/backlog
  ├─ 更新 status=in_progress, assigneeAgentId=actorId
  └─ 记录 checkedOutByRunId (防止并发冲突)
  ↓
返回完整任务上下文 (project, goal, workspace)
```

### 4. 预算超支暂停

```
Agent 执行完成 → 记录 costCents
  ↓
services/budgets.ts:recordCost()
  ↓
查询 budget_policies.monthlyLimitCents
  ↓
对比 agents.spentMonthlyCents
  ↓
超支检测 → pauseIfOverBudget()
  ├─ 更新 agents.status=paused
  ├─ 记录 agents.pauseReason=budget_exhausted
  └─ 创建 budget_incidents 记录
  ↓
通知 WebSocket 客户端: agent:paused
```

### 5. 公司模板导出/导入

```
导出: POST /api/companies/:id/export
  ↓
services/company-portability.ts:exportCompany()
  ├─ 序列化 company, agents, projects, goals, skills
  ├─ 清洗密钥 (secrets → placeholders)
  └─ 生成 JSON (包含版本号 + schema hash)
  ↓
导入: POST /api/companies/import
  ↓
services/company-portability.ts:importCompany()
  ├─ 校验版本兼容性
  ├─ 重新生成 ID (避免冲突)
  ├─ 恢复关系 (reportsTo, parentGoalId)
  └─ 提示需要配置密钥
```

---

## 数据流图

```
┌─────────────┐         ┌──────────────┐         ┌───────────────┐
│   Browser   │────────▶│  Express API │────────▶│  PostgreSQL   │
│  (React UI) │◀────────│  (server/)   │◀────────│  (packages/db)│
└─────────────┘  REST   └──────────────┘  Drizzle└───────────────┘
       │                       │
       │ WebSocket            │ Adapter
       ▼                       ▼
┌─────────────┐         ┌──────────────┐
│  /ws (Live) │         │ Agent Runtime│
│   Updates   │         │ (openclaw/   │
└─────────────┘         │  claude/etc) │
                        └──────────────┘
```

---

## 环境变量配置

**核心环境变量:**

| 变量名 | 默认值 | 用途 |
|--------|--------|------|
| `DATABASE_URL` | (空) | 外部 PostgreSQL 连接串 |
| `PORT` | 3100 | 服务器监听端口 |
| `HOST` | 127.0.0.1 | 绑定地址 |
| `PAPERCLIP_DEPLOYMENT_MODE` | local_trusted | 部署模式 (local_trusted/authenticated) |
| `PAPERCLIP_EMBEDDED_POSTGRES_PORT` | 15432 | 嵌入式 PG 端口 |
| `PAPERCLIP_HEARTBEAT_SCHEDULER_ENABLED` | true | 启用心跳调度器 |
| `PAPERCLIP_HEARTBEAT_SCHEDULER_INTERVAL_MS` | 30000 | 心跳检查间隔 (30秒) |
| `PAPERCLIP_MIGRATION_AUTO_APPLY` | false | 自动应用数据库迁移 |
| `BETTER_AUTH_SECRET` | (必填) | JWT 签名密钥 (authenticated 模式) |
| `PAPERCLIP_SECRETS_PROVIDER` | env | 密钥提供者 (env/file) |
| `PAPERCLIP_SECRETS_MASTER_KEY_FILE` | (空) | 加密主密钥文件路径 |

**示例 .env 文件:**

```bash
# 开发环境 (使用嵌入式 PostgreSQL)
PORT=3100
PAPERCLIP_DEPLOYMENT_MODE=local_trusted
PAPERCLIP_HEARTBEAT_SCHEDULER_ENABLED=true

# 生产环境 (外部 PostgreSQL)
DATABASE_URL=postgres://user:pass@host:5432/paperclip
PAPERCLIP_DEPLOYMENT_MODE=authenticated
BETTER_AUTH_SECRET=your-secret-key-here
PAPERCLIP_AUTH_BASE_URL=https://paperclip.yourcompany.com
```

---

## 开发命令速查

```bash
# 安装依赖
pnpm install

# 开发模式 (带热重载)
pnpm dev              # API + UI 同时启动
pnpm dev:server       # 仅 API
pnpm dev:ui           # 仅 UI

# 构建
pnpm build            # 构建所有包
pnpm -r typecheck     # 类型检查

# 数据库
pnpm db:generate      # 生成迁移文件
pnpm db:migrate       # 应用迁移
pnpm db:backup        # 备份数据库

# 测试
pnpm test             # 单元测试 (watch)
pnpm test:run         # 单元测试 (一次)
pnpm test:e2e         # E2E 测试

# 发布
pnpm release          # 发布新版本
pnpm release:canary   # Canary 版本
pnpm release:stable   # Stable 版本
```

---

## 代码质量守则

**来自 AGENTS.md:**

1. **公司隔离强制执行**
   - 所有 API 必须检查 `companyId`
   - Agent 不能跨公司访问数据

2. **合约同步**
   - 修改 schema → 更新 types → 更新 validators → 更新 routes → 更新 UI

3. **控制平面不变量**
   - 单分配任务模型 (一个 issue 只能被一个 agent checkout)
   - 原子性签出语义 (防止并发冲突)
   - 审批门控 (重要操作需要 Board 批准)
   - 预算硬停止 (超支自动暂停)
   - 活动日志 (所有变更可审计)

4. **完成定义**
   - 行为匹配 `doc/SPEC-implementation.md`
   - Typecheck + Tests + Build 通过
   - 合约跨层同步
   - 文档已更新

---

## 技术栈总结

| 层级 | 技术 | 用途 |
|------|------|------|
| **后端** | Node.js 20 + Express + TypeScript | API 服务器 |
| **数据库** | PostgreSQL + Drizzle ORM | 持久化存储 |
| **前端** | React 18 + Vite + TanStack Router | 单页应用 |
| **样式** | Tailwind CSS + shadcn/ui | UI 组件库 |
| **实时通信** | WebSocket (ws) | 实时更新推送 |
| **认证** | Better Auth | OAuth 集成 |
| **校验** | Zod | 运行时类型校验 |
| **测试** | Vitest + Playwright | 单元测试 + E2E |
| **包管理** | pnpm 9.15 + workspace | Monorepo 管理 |
| **部署** | Docker Compose / npm 安装 | 多种部署方式 |

---

## 关键文件索引

**必读文档:**
- `AGENTS.md` — 开发者协作指南 (149行)
- `doc/SPEC-implementation.md` — V1 实现规格
- `doc/DEVELOPING.md` — 开发环境搭建
- `doc/DATABASE.md` — 数据库架构详解

**核心入口:**
- `server/src/index.ts:74` — `startServer()` 函数
- `server/src/app.ts` — Express 应用配置
- `ui/src/App.tsx` — React 根组件
- `packages/db/src/client.ts:48` — `createDb()` 函数

**关键服务:**
- `server/src/services/heartbeat.ts` — 心跳调度核心逻辑
- `server/src/services/model-router.ts:40` — `routeIssueByLabels()` 自动路由
- `server/src/services/budgets.ts` — 预算控制与暂停
- `server/src/services/workspace-runtime.ts` — 工作空间运行时管理 (1564行)
- `server/src/services/company-portability.ts` — 导入/导出模板

**路由文件:**
- `server/src/routes/issues.ts:43` — `issueRoutes()` 任务管理 API
- `server/src/routes/agents.ts` — Agent 管理 API
- `server/src/routes/approvals.ts` — 审批流程 API

**类型定义:**
- `packages/shared/src/types/agent.ts:62` — `Agent` 接口
- `packages/shared/src/types/issue.ts` — `Issue` 接口
- `packages/shared/src/types/goal.ts` — `Goal` 接口

**数据库 Schema:**
- `packages/db/src/schema/agents.ts` — agents 表定义
- `packages/db/src/schema/issues.ts` — issues 表定义
- `packages/db/src/schema/heartbeat_runs.ts` — heartbeat_runs 表定义

---

## 扩展开发指南

### 添加新的 Adapter

1. 在 `packages/adapters/` 创建新目录
2. 实现接口:
   ```typescript
   export const type = "my-adapter";
   export const label = "My Adapter";
   export const models = [];
   export const agentConfigurationDoc = `...`;
   ```
3. 在 `server/src/services/heartbeat.ts` 中注册 adapter
4. 测试适配器调用流程

### 添加新的 API 端点

1. 在 `server/src/routes/` 创建路由文件
2. 在 `server/src/services/` 添加业务逻辑
3. 更新 `packages/shared/src/api.ts` 添加路径常量
4. 更新 `packages/shared/src/types/` 添加类型定义
5. 在 UI 中调用新 API

### 添加新的数据库表

1. 在 `packages/db/src/schema/` 创建表定义文件
2. 在 `packages/db/src/schema/index.ts` 导出表
3. 运行 `pnpm db:generate` 生成迁移
4. 运行 `pnpm db:migrate` 应用迁移
5. 更新相关 service 和 types

### 创建新插件

```bash
cd packages/plugins
npm create paperclip-plugin@latest
```

参考 `packages/plugins/examples/` 中的示例代码。

---

## 性能特征

- **心跳调度:** 30s 间隔，支持数百个 Agent
- **原子签出:** 使用数据库事务防止并发冲突
- **实时推送:** WebSocket 多路复用，自动重连
- **查询优化:** Drizzle ORM 自动生成索引
- **文件存储:** 支持本地文件系统/S3 (可配置)

---

## 部署模式

1. **本地开发 (local_trusted)**
   - 嵌入式 PostgreSQL
   - 自动创建 local-board 用户
   - 无需认证

2. **Tailscale 访问 (authenticated)**
   - 外部 PostgreSQL
   - Better Auth OAuth
   - 私有网络访问

3. **公网部署 (authenticated + public)**
   - 外部 PostgreSQL
   - Better Auth OAuth
   - 显式配置 publicBaseUrl

4. **Docker Compose**
   ```bash
   docker-compose up
   ```

---

## 故障排查

**常见问题:**

1. **端口冲突**
   - 检查 `PORT` 环境变量
   - Paperclip 会自动寻找下一个空闲端口

2. **迁移失败**
   - 设置 `PAPERCLIP_MIGRATION_AUTO_APPLY=true`
   - 或手动运行 `pnpm db:migrate`

3. **Agent 不心跳**
   - 检查 `PAPERCLIP_HEARTBEAT_SCHEDULER_ENABLED=true`
   - 检查 Agent 的 `nextHeartbeatAt` 时间

4. **预算未生效**
   - 检查 `budget_policies` 表是否有记录
   - 检查 `agents.budgetMonthlyCents` 字段

5. **Adapter 连接失败**
   - 检查 Adapter 配置中的 URL/Token
   - 查看 `heartbeat_run_events` 表的错误日志

---

## 下一步阅读

1. **新手:** 阅读 `doc/GOAL.md` → `doc/PRODUCT.md` 理解产品定位
2. **开发者:** 阅读 `AGENTS.md` → `doc/DEVELOPING.md` 搭建环境
3. **架构师:** 阅读 `doc/SPEC-implementation.md` 理解 V1 规格
4. **贡献者:** 阅读 `CONTRIBUTING.md` 了解贡献流程

---

**本 CODEMAP 最后更新:** 2026-04-01
**生成者:** Claude Code (Sonnet 4.5)
**维护建议:** 每次重大架构变更或新增核心模块时更新此文件
