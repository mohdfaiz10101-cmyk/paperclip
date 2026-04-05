# Paperclip Fork Workflow

## 架构说明

```
upstream (上游官方)        personal fork (你的定制版)
paperclipai/paperclip  →  mohdfaiz10101-cmyk/paperclip
     ↓ fetch                      ↑ push
     └─────→ 本地仓库 ──────────────┘
```

## 日常工作流

### 1. 修改代码后推送

```bash
# Opus/Sonnet/人工修改 → 自动推送（通过 post-commit hook）
git add .
git commit -m "feat: 新功能"
# Hook 自动执行 git push

# GLM 修改 → 需要审核
git commit -m "fix: GLM 修复"
# Hook 提示需要审核
git commit --amend -m "fix: GLM 修复 [approved]"  # 添加审核标记后自动推送
```

### 2. 同步上游更新

```bash
# 查看上游有哪些新功能
git fetch upstream
git log HEAD..upstream/master --oneline

# 合并上游更新（保留你的定制）
git merge upstream/master

# 如果有冲突：
# 1. 手动编辑冲突文件
# 2. git add <冲突文件>
# 3. git commit

# 推送合并后的代码
git push
```

### 3. 查看状态

```bash
# 本地有哪些未推送的提交
git log origin/master..HEAD --oneline

# Personal fork 落后上游多少
git log HEAD..upstream/master --oneline

# 查看所有远程分支
git branch -a
```

## 系统恢复

### 全新机器部署

```bash
# 运行恢复脚本（自动完成所有配置）
paperclip-restore /mnt/ai/ai-cluster/paperclip

# 或手动执行：
git clone https://github.com/mohdfaiz10101-cmyk/paperclip.git
cd paperclip
git remote add upstream https://github.com/paperclipai/paperclip.git
```

### 恢复后验证

```bash
git remote -v
# 应该看到：
# origin    https://github.com/mohdfaiz10101-cmyk/paperclip.git (personal fork)
# upstream  https://github.com/paperclipai/paperclip.git (官方上游)

git log -5 --oneline
# 应该看到你的定制化提交
```

## 合并策略

### 为什么要合并？

- **Personal fork**：包含你的定制化（adapters、UI、配置）
- **Upstream**：包含官方新功能、bug 修复
- **合并**：既保留定制，又获得新功能

### 合并冲突处理

```bash
# 合并时出现冲突
git merge upstream/master
# 提示：CONFLICT (content): Merge conflict in xxx.ts

# 查看冲突文件
git status

# 编辑冲突文件，保留需要的部分：
# <<<<<<< HEAD (你的修改)
# your custom code
# =======
# upstream new code
# >>>>>>> upstream/master (上游修改)

# 标记冲突已解决
git add <冲突文件>
git commit

# 推送合并结果
git push
```

### 避免冲突的最佳实践

1. **定期同步**：每周至少执行一次 `git fetch upstream && git merge upstream/master`
2. **模块化定制**：自定义代码放在独立文件/目录，避免修改核心文件
3. **记录修改**：在 CUSTOMIZATIONS.md 中记录所有定制点

## 自动推送规则

**Post-commit hook** 根据作者自动决定：

| 提交者        | 行为             | 说明                          |
|--------------|------------------|------------------------------|
| opus/sonnet  | 自动推送          | 高质量 AI，直接推送           |
| charlie      | 自动推送          | 人工修改，直接推送            |
| glm/deepseek | 等待审核          | 需要添加 `[approved]` 标记    |
| 其他         | 提示手动推送      | 未知来源，需人工确认          |

## 常见问题

### Q: 为什么不直接推送到 upstream？

A: 你没有 paperclipai/paperclip 的写入权限（只读）。个人定制必须推送到 personal fork。

### Q: 上游更新会覆盖我的定制吗？

A: 不会。`git merge` 会保留双方的修改，只有冲突时需要手动选择。

### Q: 如何查看我做了哪些定制？

```bash
# 对比 personal fork 与上游的差异
git diff upstream/master..HEAD

# 查看自己的提交记录
git log upstream/master..HEAD --oneline
```

### Q: 可以放弃定制，完全使用上游版本吗？

```bash
# 重置到上游状态（危险操作，会丢失定制）
git reset --hard upstream/master
git push origin master --force
```

## 相关脚本

- `/home/charlie/.local/bin/paperclip-restore` - 系统恢复脚本
- `.git/hooks/post-commit` - 自动推送 hook
- `~/.config/paperclip/secrets.env` - 敏感配置（不提交到 Git）
