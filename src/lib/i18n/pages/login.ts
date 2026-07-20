/**
 * 登录页(Login)词条:品牌区 / 用户选择 / 密码 / 错误提示
 * key 规范:login.<区域>.<名称>;zh/en 必须同步增减
 * 登录按钮文案复用 common.button.login;品牌副标题复用 layout.subtitle
 */
export const zh: Record<string, string> = {
  // ---------- 品牌区 ----------
  'login.brand.value': '让每一条数据血缘清晰可见',
  'login.brand.desc': '提交 SQL 自动构建表级血缘,变更影响一屏尽览。',
  // ---------- 登录卡 ----------
  'login.title': '登录',
  'login.subtitle': '选择用户并输入密码,进入数据血缘控制台',
  'login.users.title': '选择用户',
  'login.users.loading': '正在加载用户…',
  'login.users.loadFailed': '用户列表加载失败,已使用内置演示用户',
  'login.password.label': '密码',
  'login.password.placeholder': '请输入密码',
  'login.password.demoHint': '演示环境统一密码',
  'login.submitting': '登录中…',
  // ---------- 错误 ----------
  'login.error.generic': '登录失败,请稍后重试',
}

export const en: Record<string, string> = {
  // ---------- Brand panel ----------
  'login.brand.value': 'Make every data lineage visible',
  'login.brand.desc': 'Submit SQL to build table-level lineage automatically, with change impact at a glance.',
  // ---------- Sign-in card ----------
  'login.title': 'Sign in',
  'login.subtitle': 'Choose a user and enter the password to open the lineage console',
  'login.users.title': 'Choose a user',
  'login.users.loading': 'Loading users…',
  'login.users.loadFailed': 'Failed to load users; showing built-in demo users',
  'login.password.label': 'Password',
  'login.password.placeholder': 'Enter password',
  'login.password.demoHint': 'Demo password for all users',
  'login.submitting': 'Signing in…',
  // ---------- Errors ----------
  'login.error.generic': 'Sign-in failed, please try again',
}
