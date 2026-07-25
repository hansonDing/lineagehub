/**
 * 新手引导步骤定义(driver.js)
 * 跨页面漫游:步骤带 path 时,前进/后退先 navigate(path) 再等渲染完成(setTimeout)后高亮。
 * 锚点统一用 [data-tour=xxx] selector;元素不存在(如移动端隐藏侧栏、角色专属入口)自动跳过。
 */

export interface TourStepDef {
  /** data-tour 锚点名;缺省为居中弹窗步骤 */
  anchor?: string
  /** 高亮前需要处于的路由(path + search) */
  path?: string
  titleKey: string
  descKey: string
  /** popover 相对元素的方位 */
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
}

/** 首访完成标记:写入 localStorage 后不再自动弹 */
export const TOUR_DONE_KEY = 'lineagehub-tour-v1-done'

export function isTourDone(): boolean {
  try {
    return window.localStorage.getItem(TOUR_DONE_KEY) === '1'
  } catch {
    return true // localStorage 不可用时不再自动弹
  }
}

export function markTourDone(): void {
  try {
    window.localStorage.setItem(TOUR_DONE_KEY, '1')
  } catch {
    /* 静默 */
  }
}

/** 步骤顺序即漫游顺序:欢迎 → 侧栏 → 总览×4 → 血缘×3 → SQL×3 → 变更×3 → 用户切换 → 结束 */
export const TOUR_STEPS: TourStepDef[] = [
  {
    titleKey: 'tour.steps.welcome.title',
    descKey: 'tour.steps.welcome.desc',
  },
  {
    anchor: 'sidebar',
    titleKey: 'tour.steps.sidebar.title',
    descKey: 'tour.steps.sidebar.desc',
    side: 'right',
  },
  {
    anchor: 'dashboard-approvals',
    path: '/',
    titleKey: 'tour.steps.dashboardApprovals.title',
    descKey: 'tour.steps.dashboardApprovals.desc',
    side: 'top',
  },
  {
    anchor: 'dashboard-layers',
    path: '/',
    titleKey: 'tour.steps.dashboardLayers.title',
    descKey: 'tour.steps.dashboardLayers.desc',
    side: 'top',
  },
  {
    anchor: 'dashboard-recent',
    path: '/',
    titleKey: 'tour.steps.dashboardRecent.title',
    descKey: 'tour.steps.dashboardRecent.desc',
    side: 'top',
  },
  {
    anchor: 'dashboard-hot',
    path: '/',
    titleKey: 'tour.steps.dashboardHot.title',
    descKey: 'tour.steps.dashboardHot.desc',
    side: 'top',
  },
  {
    anchor: 'lineage-toolbar',
    path: '/lineage',
    titleKey: 'tour.steps.lineageToolbar.title',
    descKey: 'tour.steps.lineageToolbar.desc',
    side: 'bottom',
  },
  {
    anchor: 'lineage-canvas',
    path: '/lineage',
    titleKey: 'tour.steps.lineageCanvas.title',
    descKey: 'tour.steps.lineageCanvas.desc',
    side: 'top',
  },
  {
    anchor: 'lineage-table-list',
    path: '/lineage',
    titleKey: 'tour.steps.lineageTableList.title',
    descKey: 'tour.steps.lineageTableList.desc',
    side: 'right',
  },
  {
    anchor: 'sql-submit',
    path: '/sql',
    titleKey: 'tour.steps.sqlSubmit.title',
    descKey: 'tour.steps.sqlSubmit.desc',
    side: 'top',
  },
  {
    anchor: 'sql-list',
    path: '/sql',
    titleKey: 'tour.steps.sqlList.title',
    descKey: 'tour.steps.sqlList.desc',
    side: 'top',
  },
  {
    anchor: 'sql-import',
    path: '/sql',
    titleKey: 'tour.steps.sqlImport.title',
    descKey: 'tour.steps.sqlImport.desc',
    side: 'left',
  },
  {
    anchor: 'changes-create',
    path: '/changes?tab=create',
    titleKey: 'tour.steps.changesCreate.title',
    descKey: 'tour.steps.changesCreate.desc',
    side: 'top',
  },
  {
    anchor: 'changes-events',
    path: '/changes?tab=events',
    titleKey: 'tour.steps.changesEvents.title',
    descKey: 'tour.steps.changesEvents.desc',
    side: 'top',
  },
  {
    anchor: 'changes-inbox',
    path: '/changes?tab=inbox',
    titleKey: 'tour.steps.changesInbox.title',
    descKey: 'tour.steps.changesInbox.desc',
    side: 'top',
  },
  {
    anchor: 'user-menu',
    titleKey: 'tour.steps.userMenu.title',
    descKey: 'tour.steps.userMenu.desc',
    side: 'bottom',
    align: 'end',
  },
  {
    titleKey: 'tour.steps.done.title',
    descKey: 'tour.steps.done.desc',
  },
]
