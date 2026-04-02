// Paperclip 中文翻译 — 轻量级方案（无外部依赖）
const zh: Record<string, string> = {
  // 导航
  "Dashboard": "仪表盘",
  "Inbox": "收件箱",
  "Issues": "任务",
  "Routines": "定期任务",
  "Goals": "目标",
  "Agents": "智能体",
  "Org": "组织",
  "Skills": "技能",
  "Costs": "费用",
  "Activity": "动态",
  "Settings": "设置",
  "Projects": "项目",
  "Approvals": "审批",

  // Issue 状态
  "Backlog": "待办池",
  "Todo": "待处理",
  "In Progress": "进行中",
  "In Review": "审核中",
  "Done": "已完成",
  "Blocked": "已阻塞",
  "Cancelled": "已取消",

  // 优先级
  "Critical": "紧急",
  "High": "高",
  "Medium": "中",
  "Low": "低",
  "None": "无",

  // Agent 状态
  "Active": "运行中",
  "Paused": "已暂停",
  "Error": "异常",
  "Idle": "空闲",
  "idle": "空闲",
  "running": "执行中",
  "paused": "已暂停",
  "error": "异常",

  // Agent 角色
  "CEO": "首席执行官",
  "CTO": "首席技术官",
  "CMO": "首席营销官",
  "CFO": "首席财务官",
  "Engineer": "工程师",
  "Designer": "设计师",
  "PM": "产品经理",
  "QA": "测试工程师",
  "DevOps": "运维工程师",
  "Researcher": "研究员",
  "General": "通用",

  // 按钮和操作
  "New Issue": "新建任务",
  "New Agent": "新建智能体",
  "Create": "创建",
  "Save": "保存",
  "Cancel": "取消",
  "Delete": "删除",
  "Edit": "编辑",
  "Close": "关闭",
  "Submit": "提交",
  "Assign": "分配",
  "Archive": "归档",
  "Search...": "搜索...",
  "Search": "搜索",
  "Filter": "筛选",
  "Sort": "排序",
  "Export": "导出",
  "Import": "导入",

  // 表单标签
  "Title": "标题",
  "Description": "描述",
  "Status": "状态",
  "Priority": "优先级",
  "Assignee": "负责人",
  "Labels": "标签",
  "Due Date": "截止日期",
  "Created": "创建时间",
  "Updated": "更新时间",
  "Name": "名称",
  "Role": "角色",
  "Model": "模型",
  "Company": "公司",

  // 通知和提示
  "No issues found": "暂无任务",
  "No agents found": "暂无智能体",
  "Loading...": "加载中...",
  "Error loading data": "数据加载失败",
  "Successfully created": "创建成功",
  "Successfully updated": "更新成功",
  "Successfully deleted": "删除成功",
  "Are you sure?": "确定要执行此操作吗？",
  "This action cannot be undone": "此操作无法撤销",

  // 时间
  "just now": "刚刚",
  "minutes ago": "分钟前",
  "hours ago": "小时前",
  "days ago": "天前",
  "yesterday": "昨天",

  // 统计
  "Total": "总计",
  "Completed": "已完成",
  "Open": "待处理",
  "Overdue": "逾期",
  "This Week": "本周",
  "This Month": "本月",
  "All Time": "全部",
  "All": "全部",

  // 面板标题
  "Issue Details": "任务详情",
  "Agent Details": "智能体详情",
  "Execution Log": "执行日志",
  "Recent Activity": "最近动态",
  "Recent Tasks": "最近任务",
  "Quick Actions": "快捷操作",
  "Onboarding": "初始化向导",
  "Company Settings": "公司设置",

  // Dashboard
  "Agents Enabled": "已启用智能体",
  "Tasks In Progress": "进行中的任务",
  "Month Spend": "本月花费",
  "Pending Approvals": "待审批",
  "Run Activity": "运行动态",
  "Issues by Priority": "按优先级分布",
  "Issues by Status": "按状态分布",
  "Success Rate": "成功率",
  "Last 14 days": "近 14 天",

  // NewIssueDialog
  "New issue": "新建任务",
  "Issue title": "任务标题",
  "Add description...": "添加描述...",
  "Create Issue": "创建任务",
  "Creating...": "创建中...",
  "Creating issue...": "正在创建任务...",
  "Discard Draft": "丢弃草稿",
  "Start date": "开始日期",
  "Due date": "截止日期",
  "Upload": "上传",
  "Documents": "文档",
  "Attachments": "附件",

  // IssuesList
  "Filters": "筛选",
  "Show terminated": "显示已终止",

  // Sidebar sections
  "Work": "工作",

  // 分组/排序
  "Group": "分组",

  // 适配器
  "Adapter": "适配器",
  "Select adapter": "选择适配器",
};

export function t(key: string): string {
  return zh[key] || key;
}

export function tStatus(status: string): string {
  const map: Record<string, string> = {
    backlog: "待办池", todo: "待处理", in_progress: "进行中",
    in_review: "审核中", done: "已完成", blocked: "已阻塞", cancelled: "已取消",
  };
  return map[status] || zh[status] || status;
}

export function tPriority(priority: string): string {
  const map: Record<string, string> = {
    critical: "紧急", high: "高", medium: "中", low: "低", none: "无",
  };
  return map[priority] || zh[priority] || priority;
}

export default { t, tStatus, tPriority };
