# Heartbeat Service 模块化重构

**状态**: 进行中（Phase 1）
**参考**: `/doc/refactor-heartbeat-service.md`

---

## 模块结构

```
server/src/services/heartbeat/
├── README.md                    # 本文件
├── process-manager.ts           # ✅ 已完成 - 进程生命周期管理
├── queue-manager.ts             # 🚧 待实现 - Run 队列调度
├── executor.ts                  # 🚧 待实现 - Adapter 执行引擎
├── run-finalizer.ts             # 🚧 待实现 - Run 完成处理
├── policies.ts                  # 🚧 待实现 - 策略引擎
├── errors.ts                    # 🚧 待实现 - 错误分类
└── index.ts                     # 🚧 待实现 - 主入口（编排层）
```

---

## 模块说明

### ✅ process-manager.ts
**行数**: ~250 行
**职责**:
- 跨平台进程存活检查
- 孤儿 run 清理（进程已死但状态仍为 running）
- 进程元数据记录

**接口**:
```typescript
interface ProcessManager {
  isProcessAlive(pid: number): Promise<boolean>;
  reapOrphanedRuns(companyId: string): Promise<number>;
  persistProcessMetadata(runId: string, meta: ProcessMetadata): Promise<void>;
  clearDetachedRunWarning(runId: string): Promise<void>;
}
```

**测试覆盖**: 待添加

---

### 🚧 queue-manager.ts (待实现)
**预估行数**: ~400 行
**职责**:
- Run 认领逻辑
- 优先级调度
- 取消和重试管理

**接口草案**:
```typescript
interface QueueManager {
  claimRun(runId: string, agentId: string): Promise<Run | null>;
  cancelRun(runId: string, reason: string): Promise<void>;
  getNextQueuedRun(agentId: string): Promise<Run | null>;
  canExecute(agent: Agent, run: Run): Promise<{ allowed: boolean; reason?: string }>;
}
```

---

### 🚧 executor.ts (待实现)
**预估行数**: ~600 行
**职责**:
- Adapter 调用
- 日志收集和流式输出
- Runtime services 管理
- Workspace 准备

---

### 🚧 run-finalizer.ts (待实现)
**预估行数**: ~500 行
**职责**:
- 成功/失败/取消/超时的分支处理
- Cost 计算和规范化
- Session 状态管理
- Agent feedback 记录

---

### 🚧 policies.ts (待实现)
**预估行数**: ~200 行
**职责**:
- Heartbeat policy 解析
- Budget 检查
- Session compaction 评估

---

### 🚧 errors.ts (待实现)
**预估行数**: ~100 行
**职责**:
- 统一错误类型定义
- 错误码枚举
- 可恢复性标记

---

### 🚧 index.ts (待实现)
**预估行数**: < 1500 行
**职责**:
- 编排所有子模块
- 对外暴露统一接口
- 兼容现有 heartbeatService() 签名

---

## 迁移进度

### Week 1 (当前)
- [x] 创建 process-manager.ts
- [ ] 在主文件中集成 process-manager
- [ ] 验证 reapOrphanedRuns 功能无退化

### Week 2
- [ ] 实现 run-finalizer.ts
- [ ] 实现 queue-manager.ts
- [ ] 创建 errors.ts

### Week 3
- [ ] 实现 executor.ts
- [ ] 实现 policies.ts
- [ ] 重写 index.ts

### Week 4
- [ ] 单元测试覆盖
- [ ] 性能测试
- [ ] 删除旧 heartbeat.ts

---

## 设计原则

1. **单一职责**: 每个模块只处理一类问题
2. **依赖注入**: 通过构造函数注入 db、logger 等依赖
3. **接口优先**: 先定义接口，再实现
4. **可测试性**: 所有模块支持 mock 依赖
5. **向后兼容**: 保持 `heartbeatService(db)` 签名不变

---

## 测试策略

### 单元测试
每个模块独立测试，mock 外部依赖：
```typescript
test("reapOrphanedRuns marks dead process runs as failed", async () => {
  const mockDb = createMockDb();
  const pm = createProcessManager({ db: mockDb, logger: mockLogger });
  // ...
});
```

### 集成测试
测试模块间协作：
```typescript
test("full heartbeat execution flow", async () => {
  // 使用真实 DB（test instance）
  // 验证 claim → execute → finalize 完整流程
});
```

---

## 性能监控

重构前后对比指标：
- Run 平均执行时间
- 内存占用峰值
- 数据库查询次数
- 事件发布延迟

**目标**: 性能偏离 < ±5%

---

## 下一步

1. 在 `heartbeat.ts` 中引入 `createProcessManager()`
2. 替换现有的 `isProcessAlive()` 调用
3. 运行现有测试确保无退化
4. 开始实现 `run-finalizer.ts`
