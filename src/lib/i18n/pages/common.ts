/**
 * 共享词条:按钮 / 状态 / 角色 / 数仓层名 / 变更类型 / 通用文案
 * key 规范:common.<分组>.<名称>;zh/en 必须同步增减
 * 通用交互文案(确认/取消/重试/关闭/空态/分页等)优先放这里,页面私有文案放各自页面文件
 */
export const zh: Record<string, string> = {
  // ---------- 按钮 ----------
  'common.button.confirm': '确认',
  'common.button.cancel': '取消',
  'common.button.save': '保存',
  'common.button.delete': '删除',
  'common.button.edit': '编辑',
  'common.button.create': '新建',
  'common.button.submit': '提交',
  'common.button.close': '关闭',
  'common.button.retry': '重试',
  'common.button.refresh': '刷新',
  'common.button.search': '搜索',
  'common.button.undo': '撤销',
  'common.button.approve': '通过',
  'common.button.reject': '驳回',
  'common.button.detail': '详情',
  'common.button.login': '登录',
  // ---------- 通用 ----------
  'common.close': '关闭', // 图标按钮 aria-label(Modal/Drawer/Toast)
  'common.loading': '加载中…',
  'common.empty.title': '暂无数据', // EmptyState / DataTable 默认空态标题
  'common.error.loadFailed': '数据加载失败',
  // ---------- 表格 ----------
  'common.table.total': '共 {count} 条',
  'common.table.sort': '排序', // 排序图标 aria-label
  // ---------- 语义状态(StatusBadge) ----------
  'common.status.pending': '待审批',
  'common.status.approving': '审批中',
  'common.status.approved': '已通过',
  'common.status.effective': '已生效',
  'common.status.rejected': '已驳回',
  'common.status.parsed': '已解析',
  'common.status.parsing': '解析中',
  'common.status.parse_failed': '解析失败',
  'common.status.warning': '警告',
  'common.status.running': '运行中',
  'common.status.paused': '已暂停',
  // ---------- 审批角色 ----------
  'common.role.report_owner': '报表负责人',
  'common.role.system_owner': 'System Owner',
  'common.role.table_owner': '中间表负责人',
  // ---------- 数仓分层 ----------
  'common.layer.ods': '贴源层',
  'common.layer.dim': '维度层',
  'common.layer.dwd': '明细层',
  'common.layer.dws': '汇总层',
  'common.layer.ads': '应用层',
  'common.layer.other': '未识别',
  // ---------- 变更类型 ----------
  'common.changeType.ddl_change': 'DDL 变更',
  'common.changeType.sql_change': 'SQL 变更',
  'common.changeType.create_table': '新建表',
  'common.changeType.drop_table': '删除表',
  // ---------- 代码编辑器状态条 ----------
  'common.editor.engine': 'Spark SQL · sqlglot 解析',
  'common.editor.position': '行 {line},列 {column} · UTF-8',
}

export const en: Record<string, string> = {
  // ---------- Buttons ----------
  'common.button.confirm': 'Confirm',
  'common.button.cancel': 'Cancel',
  'common.button.save': 'Save',
  'common.button.delete': 'Delete',
  'common.button.edit': 'Edit',
  'common.button.create': 'New',
  'common.button.submit': 'Submit',
  'common.button.close': 'Close',
  'common.button.retry': 'Retry',
  'common.button.refresh': 'Refresh',
  'common.button.search': 'Search',
  'common.button.undo': 'Undo',
  'common.button.approve': 'Approve',
  'common.button.reject': 'Reject',
  'common.button.detail': 'Details',
  'common.button.login': 'Sign in',
  // ---------- Generic ----------
  'common.close': 'Close',
  'common.loading': 'Loading…',
  'common.empty.title': 'No data yet',
  'common.error.loadFailed': 'Failed to load data',
  // ---------- Table ----------
  'common.table.total': '{count} items',
  'common.table.sort': 'Sort',
  // ---------- Semantic statuses (StatusBadge) ----------
  'common.status.pending': 'Pending',
  'common.status.approving': 'Approving',
  'common.status.approved': 'Approved',
  'common.status.effective': 'Effective',
  'common.status.rejected': 'Rejected',
  'common.status.parsed': 'Parsed',
  'common.status.parsing': 'Parsing',
  'common.status.parse_failed': 'Parse Failed',
  'common.status.warning': 'Warning',
  'common.status.running': 'Running',
  'common.status.paused': 'Paused',
  // ---------- Approver roles ----------
  'common.role.report_owner': 'Report Owner',
  'common.role.system_owner': 'System Owner',
  'common.role.table_owner': 'Table Owner',
  // ---------- Warehouse layers ----------
  'common.layer.ods': 'Staging',
  'common.layer.dim': 'Dimension',
  'common.layer.dwd': 'Detail',
  'common.layer.dws': 'Summary',
  'common.layer.ads': 'Application',
  'common.layer.other': 'Unknown',
  // ---------- Change types ----------
  'common.changeType.ddl_change': 'DDL Change',
  'common.changeType.sql_change': 'SQL Change',
  'common.changeType.create_table': 'Create Table',
  'common.changeType.drop_table': 'Drop Table',
  // ---------- Code editor status bar ----------
  'common.editor.engine': 'Spark SQL · Parsed by sqlglot',
  'common.editor.position': 'Ln {line}, Col {column} · UTF-8',
}
