/**
 * Tour 词条:新手引导(driver.js)全部文案
 * key 规范:tour.<分组>.<名称>;步骤文案 tour.steps.<步骤名>.title/.desc
 */
export const zh: Record<string, string> = {
  // ---------- 按钮 ----------
  'tour.btn.next': '下一步',
  'tour.btn.prev': '上一步',
  'tour.btn.done': '完成',
  'tour.btn.close': '关闭引导',
  'tour.progress': '{{current}} / {{total}}',
  // ---------- 步骤 ----------
  'tour.steps.welcome.title': '欢迎使用 LineageHub',
  'tour.steps.welcome.desc':
    'LineageHub 是数据血缘平台:解析 SQL 自动构建表级血缘,追踪变更并走审批流。当前为演示模式,所有数据都保存在浏览器本地(localStorage),刷新不会丢失,可随时重置。',
  'tour.steps.sidebar.title': '五大功能模块',
  'tour.steps.sidebar.desc':
    '侧边导航包含:总览、血缘图谱、SQL 管理、元数据配置、变更与审批。System Owner 角色还会看到「集成设置」。接下来逐个看看。',
  'tour.steps.dashboardApprovals.title': '待办审批',
  'tour.steps.dashboardApprovals.desc':
    '登录后第一眼看到需要你审批的变更,可直接「通过 / 驳回」,5 秒内可撤销。点行可查看变更详情与影响面。',
  'tour.steps.dashboardLayers.title': '数仓分层分布',
  'tour.steps.dashboardLayers.desc':
    '按 ODS / DIM / DWD / DWS / ADS 分层统计表数量,点击某一层可跳到元数据配置页查看该层所有表。',
  'tour.steps.dashboardRecent.title': '最近变更',
  'tour.steps.dashboardRecent.desc': '全平台最新的变更事件时间线,带状态与来源徽标,点击任意一条进入变更详情。',
  'tour.steps.dashboardHot.title': '下游影响 Top 表',
  'tour.steps.dashboardHot.desc':
    '下游依赖最多的表排行。改这些表风险最高,点击可直达它的血缘聚焦视图,先看影响面再动手。',
  'tour.steps.lineageToolbar.title': '图谱工具栏',
  'tour.steps.lineageToolbar.desc':
    '在这里切换 全景 / 聚焦 模式、按表搜索、按层筛选、调节上下游层数,最右侧按钮切换布局方向(横向 / 纵向)。',
  'tour.steps.lineageCanvas.title': '血缘画布',
  'tour.steps.lineageCanvas.desc':
    '拖拽平移、滚轮缩放;hover 节点会高亮它的整条上下游链路;双击节点进入聚焦视图;点击节点打开右侧详情抽屉,查看字段、上下游与关联报表。',
  'tour.steps.lineageTableList.title': '表列表面板',
  'tour.steps.lineageTableList.desc': '左侧按分层列出所有表,点击任意表立即聚焦并居中,窄屏下可折叠为色点窄轨。',
  'tour.steps.sqlSubmit.title': '提交 SQL,自动建血缘',
  'tour.steps.sqlSubmit.desc':
    '在左侧编辑器粘贴 DDL 或 ETL SQL,点「解析并提交」:sqlglot 自动解析出源表 → 目标表的血缘边并入库,无需手工维护。',
  'tour.steps.sqlList.title': '脚本列表',
  'tour.steps.sqlList.desc':
    '所有已解析脚本:版本号、血缘规模(源表数 → 目标表数),可查看图、重新解析、查看版本历史或删除。',
  'tour.steps.sqlImport.title': '批量导入',
  'tour.steps.sqlImport.desc': '有成体系的 SQL 仓库?填目录路径批量导入,逐文件解析落库并输出汇总报告。',
  'tour.steps.changesCreate.title': '发起变更',
  'tour.steps.changesCreate.desc':
    '四种变更入口:DDL 变更、SQL 变更、新建表、删除表。提交后自动计算字段差异与下游影响,进入审批流。',
  'tour.steps.changesEvents.title': '变更事件列表',
  'tour.steps.changesEvents.desc':
    '全部变更事件:来源徽标(SQL 提交 / 手工发起)、状态筛选与统计,点击行打开 720px 详情抽屉查看 diff 与影响面。',
  'tour.steps.changesInbox.title': '审批收件箱',
  'tour.steps.changesInbox.desc': '分配给你的审批任务,通过后变更即时生效并更新血缘;驳回则退回提交人。',
  'tour.steps.userMenu.title': '切换用户,体验审批流',
  'tour.steps.userMenu.desc':
    '演示模式下可登出后用其他账号登录(如 Hanson / Jacky 是 System Owner),体验「提交人 vs 审批人」的完整流转;所有账号密码均为 lineagehub123。',
  'tour.steps.done.title': '引导完成',
  'tour.steps.done.desc': '随时可以点击顶栏的问号按钮重新播放本引导。开始探索你的数据血缘吧!',
}

export const en: Record<string, string> = {
  // ---------- Buttons ----------
  'tour.btn.next': 'Next',
  'tour.btn.prev': 'Back',
  'tour.btn.done': 'Done',
  'tour.btn.close': 'Close tour',
  'tour.progress': '{{current}} of {{total}}',
  // ---------- Steps ----------
  'tour.steps.welcome.title': 'Welcome to LineageHub',
  'tour.steps.welcome.desc':
    'LineageHub is a data lineage platform: it parses SQL to build table-level lineage automatically, and tracks changes through an approval flow. You are in demo mode — all data lives in your browser (localStorage), survives refresh, and can be reset anytime.',
  'tour.steps.sidebar.title': 'Five Modules',
  'tour.steps.sidebar.desc':
    'The sidebar holds: Overview, Lineage Graph, SQL Management, Metadata, and Changes & Approvals. System Owners also see Integration Settings. Let’s walk through them.',
  'tour.steps.dashboardApprovals.title': 'Pending Approvals',
  'tour.steps.dashboardApprovals.desc':
    'Changes awaiting your decision appear here first. Approve or reject inline, with a 5-second undo window. Click a row for full diff and blast radius.',
  'tour.steps.dashboardLayers.title': 'Layer Distribution',
  'tour.steps.dashboardLayers.desc':
    'Table counts by warehouse layer (ODS / DIM / DWD / DWS / ADS). Click a layer to browse its tables in Metadata.',
  'tour.steps.dashboardRecent.title': 'Recent Changes',
  'tour.steps.dashboardRecent.desc':
    'A timeline of the latest change events across the platform, with status and source badges. Click any entry for details.',
  'tour.steps.dashboardHot.title': 'Top Downstream Impact',
  'tour.steps.dashboardHot.desc':
    'Tables with the most downstream dependencies — the riskiest ones to change. Click to open its focused lineage view before touching it.',
  'tour.steps.lineageToolbar.title': 'Graph Toolbar',
  'tour.steps.lineageToolbar.desc':
    'Switch Overview / Focus mode, search tables, filter by layer, tune upstream/downstream depth, and flip layout direction (horizontal / vertical) with the right-most button.',
  'tour.steps.lineageCanvas.title': 'Lineage Canvas',
  'tour.steps.lineageCanvas.desc':
    'Drag to pan, scroll to zoom. Hover a node to highlight its full upstream/downstream chain; double-click to focus; click to open the detail drawer with columns, neighbors and related reports.',
  'tour.steps.lineageTableList.title': 'Table List Panel',
  'tour.steps.lineageTableList.desc':
    'All tables grouped by layer on the left. Click any table to focus and center it; on narrow screens it collapses to a color-dot rail.',
  'tour.steps.sqlSubmit.title': 'Submit SQL, Build Lineage',
  'tour.steps.sqlSubmit.desc':
    'Paste DDL or ETL SQL in the editor and hit “Parse & Submit”: sqlglot extracts source → target lineage edges automatically — no manual maintenance.',
  'tour.steps.sqlList.title': 'Script List',
  'tour.steps.sqlList.desc':
    'Every parsed script with version and lineage scale (sources → targets). View the graph, re-parse, browse version history, or delete.',
  'tour.steps.sqlImport.title': 'Batch Import',
  'tour.steps.sqlImport.desc':
    'Have a whole SQL repo? Point at a directory to batch-import: each file is parsed and stored with a summary report.',
  'tour.steps.changesCreate.title': 'Create a Change',
  'tour.steps.changesCreate.desc':
    'Four entry points: DDL change, SQL change, create table, drop table. On submit, field diffs and downstream impact are computed and routed into the approval flow.',
  'tour.steps.changesEvents.title': 'Change Events',
  'tour.steps.changesEvents.desc':
    'All change events with source badges (SQL submission / manual), status filters and stats. Click a row to open the 720px detail drawer with diffs and impact.',
  'tour.steps.changesInbox.title': 'Approval Inbox',
  'tour.steps.changesInbox.desc':
    'Tasks assigned to you. Approving applies the change and updates lineage immediately; rejecting sends it back to the submitter.',
  'tour.steps.userMenu.title': 'Switch Users, Try the Flow',
  'tour.steps.userMenu.desc':
    'In demo mode, sign out and log in as another account (e.g. Hanson / Jacky are System Owners) to experience the full submitter-vs-approver loop. Every demo account uses password lineagehub123.',
  'tour.steps.done.title': 'Tour Complete',
  'tour.steps.done.desc':
    'You can replay this tour anytime via the question-mark button in the top bar. Now go explore your data lineage!',
}
