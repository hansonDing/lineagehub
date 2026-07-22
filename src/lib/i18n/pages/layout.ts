/**
 * Layout 词条:侧栏导航 / 顶栏搜索 / 面包屑 / 环境徽标 / 用户卡
 * key 规范:layout.<区域>.<名称>
 */
export const zh: Record<string, string> = {
  // ---------- 侧栏 ----------
  'layout.subtitle': '数据血缘平台', // Logo 下副标题
  'layout.nav.dashboard': '总览',
  'layout.nav.lineage': '血缘图谱',
  'layout.nav.sql': 'SQL 管理',
  'layout.nav.metadata': '元数据配置',
  'layout.nav.changes': '变更与审批',
  'layout.nav.settings': '集成设置',
  'layout.engine.name': '解析引擎 · sqlglot', // 侧栏引擎状态卡
  'layout.user.logout': '登出', // 顶栏登出按钮
  'layout.menu.open': '打开菜单', // 移动端汉堡按钮 aria-label
  'layout.menu.close': '关闭菜单', // 移动端抽屉关闭按钮 aria-label
  // ---------- 顶栏搜索 ----------
  'layout.search.placeholder': '搜索表 / 报表 / 系统…',
  'layout.search.empty': '未找到匹配的结果',
  'layout.search.group.tables': '数仓表',
  'layout.search.group.reports': '报表',
  'layout.search.group.systems': '系统',
  'layout.search.group.scripts': '脚本',
  // ---------- 顶栏右侧 ----------
  'layout.notifications': '通知', // 铃铛 aria-label
  'layout.env.production': '生产环境',
  'layout.env.demo': '演示模式 · 后端未连接',
  'layout.env.demoTip': 'API 不可达,当前为浏览器内置演示数据',
}

export const en: Record<string, string> = {
  // ---------- Sidebar ----------
  'layout.subtitle': 'Data Lineage Platform',
  'layout.nav.dashboard': 'Overview',
  'layout.nav.lineage': 'Lineage Graph',
  'layout.nav.sql': 'SQL Management',
  'layout.nav.metadata': 'Metadata',
  'layout.nav.changes': 'Changes & Approvals',
  'layout.nav.settings': 'Integration Settings',
  'layout.engine.name': 'Parser Engine · sqlglot',
  'layout.user.logout': 'Sign out',
  'layout.menu.open': 'Open menu',
  'layout.menu.close': 'Close menu',
  // ---------- Topbar search ----------
  'layout.search.placeholder': 'Search tables / reports / systems…',
  'layout.search.empty': 'No matching results',
  'layout.search.group.tables': 'Tables',
  'layout.search.group.reports': 'Reports',
  'layout.search.group.systems': 'Systems',
  'layout.search.group.scripts': 'Scripts',
  // ---------- Topbar right ----------
  'layout.notifications': 'Notifications',
  'layout.env.production': 'Production',
  'layout.env.demo': 'Demo Mode · Backend offline',
  'layout.env.demoTip': 'API unreachable; showing built-in browser demo data',
}
