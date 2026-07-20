/**
 * Dashboard(总览)词条:页面头 / 统计卡 / 待办审批 / 分层分布 / 最近变更 / 热点表 / toast
 * key 规范:dashboard.<卡片或区域>.<名称>
 */
export const zh: Record<string, string> = {
  // ---------- 页面头 ----------
  'dashboard.title': '总览',
  'dashboard.subtitle': '数据血缘平台运行状况 · 更新于 {time}',
  'dashboard.action.refresh': '刷新',
  'dashboard.action.submitSql': '提交 SQL',
  'dashboard.emptyBanner.text': '系统暂无数据,提交第一个 SQL 脚本开始构建血缘',
  'dashboard.emptyBanner.action': '去提交 SQL',
  'dashboard.error.loadFailed': '数据加载失败',
  // ---------- 统计卡 ----------
  'dashboard.stat.tables': '数仓表',
  'dashboard.stat.tables.hint': '覆盖 {count} 个分层',
  'dashboard.stat.edges': '血缘边',
  'dashboard.stat.edges.hint': '覆盖 {pct}% 的数仓表',
  'dashboard.stat.systems': '业务系统',
  'dashboard.stat.systems.hint': '含来源系统与目标系统',
  'dashboard.stat.reports': '报表',
  'dashboard.stat.reports.hint': '待办审批 {count} 条',
  // ---------- 待办审批 ----------
  'dashboard.approvals.title': '待办审批',
  'dashboard.approvals.all': '全部审批 →',
  'dashboard.approvals.empty.title': '没有待处理的审批',
  'dashboard.approvals.empty.desc': '所有变更都已处理完毕',
  'dashboard.approvals.submittedBy': '{user} 提交',
  'dashboard.approvals.impact': '影响 报表×{reports} 系统×{systems}',
  'dashboard.approvals.processed': '已处理 {count} 条',
  'dashboard.approvals.taskDone': '审批任务 #{id} 处理完成',
  'dashboard.approvals.opFailed': '操作失败',
  'dashboard.approvals.submitFailed': '审批提交失败,请重试',
  'dashboard.approvals.undoTitle': '已撤销',
  'dashboard.approvals.undoDesc': '审批操作已取消',
  // ---------- 变更摘要(summarizeChange) ----------
  'dashboard.change.fieldsAdded': '新增 {count} 个字段',
  'dashboard.change.fieldsRemoved': '删除 {count} 个字段',
  'dashboard.change.fieldsTypeChanged': '变更 {count} 个字段类型',
  'dashboard.change.edgesAdded': '新增 {count} 条血缘边',
  'dashboard.change.edgesRemoved': '移除 {count} 条血缘边',
  'dashboard.change.join': ',', // 摘要分句连接符
  'dashboard.change.pendingApproval': '{name} 变更待审批',
  // ---------- 分层分布 ----------
  'dashboard.layers.title': '数仓分层分布',
  'dashboard.layers.total': '共 {count} 张表',
  // ---------- 最近变更 ----------
  'dashboard.recent.title': '最近变更',
  'dashboard.recent.all': '变更中心 →',
  'dashboard.recent.empty.title': '暂无变更事件',
  'dashboard.recent.empty.desc': '上游 DDL 或 SQL 发生变更时会在这里出现',
  // ---------- 热点表 ----------
  'dashboard.hot.title': '下游影响 Top 表',
  'dashboard.hot.subtitle': '按直接+间接下游表数量排序',
  'dashboard.hot.empty.title': '暂无血缘数据',
  'dashboard.hot.empty.desc': '提交 SQL 脚本后,这里会展示下游影响最大的表',
  'dashboard.hot.downstream': '下游 {count}',
  'dashboard.hot.reports': '报表 {count}',
}

export const en: Record<string, string> = {
  // ---------- Page header ----------
  'dashboard.title': 'Overview',
  'dashboard.subtitle': 'Platform status · Updated {time}',
  'dashboard.action.refresh': 'Refresh',
  'dashboard.action.submitSql': 'Submit SQL',
  'dashboard.emptyBanner.text': 'No data yet. Submit your first SQL script to start building lineage.',
  'dashboard.emptyBanner.action': 'Submit SQL',
  'dashboard.error.loadFailed': 'Failed to load data',
  // ---------- Stat cards ----------
  'dashboard.stat.tables': 'Tables',
  'dashboard.stat.tables.hint': 'Covers {count} layers',
  'dashboard.stat.edges': 'Lineage Edges',
  'dashboard.stat.edges.hint': 'Covers {pct}% of tables',
  'dashboard.stat.systems': 'Systems',
  'dashboard.stat.systems.hint': 'Includes source and target systems',
  'dashboard.stat.reports': 'Reports',
  'dashboard.stat.reports.hint': '{count} pending approvals',
  // ---------- Pending approvals ----------
  'dashboard.approvals.title': 'Pending Approvals',
  'dashboard.approvals.all': 'All Approvals →',
  'dashboard.approvals.empty.title': 'No pending approvals',
  'dashboard.approvals.empty.desc': 'All changes have been processed',
  'dashboard.approvals.submittedBy': 'by {user}',
  'dashboard.approvals.impact': 'Impacts {reports} reports · {systems} systems',
  'dashboard.approvals.processed': '{count} processed',
  'dashboard.approvals.taskDone': 'Approval task #{id} completed',
  'dashboard.approvals.opFailed': 'Operation failed',
  'dashboard.approvals.submitFailed': 'Failed to submit the approval. Please try again.',
  'dashboard.approvals.undoTitle': 'Undone',
  'dashboard.approvals.undoDesc': 'The approval action was canceled',
  // ---------- Change summary (summarizeChange) ----------
  'dashboard.change.fieldsAdded': '{count} fields added',
  'dashboard.change.fieldsRemoved': '{count} fields removed',
  'dashboard.change.fieldsTypeChanged': '{count} field types changed',
  'dashboard.change.edgesAdded': '{count} lineage edges added',
  'dashboard.change.edgesRemoved': '{count} lineage edges removed',
  'dashboard.change.join': ', ',
  'dashboard.change.pendingApproval': '{name} change pending approval',
  // ---------- Layer distribution ----------
  'dashboard.layers.title': 'Layer Distribution',
  'dashboard.layers.total': '{count} tables',
  // ---------- Recent changes ----------
  'dashboard.recent.title': 'Recent Changes',
  'dashboard.recent.all': 'Change Center →',
  'dashboard.recent.empty.title': 'No change events yet',
  'dashboard.recent.empty.desc': 'Upstream DDL or SQL changes will appear here',
  // ---------- Hot tables ----------
  'dashboard.hot.title': 'Top Tables by Downstream Impact',
  'dashboard.hot.subtitle': 'Ranked by direct + indirect downstream tables',
  'dashboard.hot.empty.title': 'No lineage data yet',
  'dashboard.hot.empty.desc': 'Submit a SQL script to see the tables with the most downstream impact',
  'dashboard.hot.downstream': '{count} downstream',
  'dashboard.hot.reports': '{count} reports',
}
