/**
 * 登录态本地持久化(localStorage 键 lineagehub-auth)。
 * 独立成模块而非放在 api.ts:mock/handlers 需要读取同一份凭证,
 * 而它不能反向依赖 api.ts(api.ts 运行时 import handlers,会成环)。
 */

export const AUTH_STORAGE_KEY = 'lineagehub-auth'

/** 已登录用户信息(与后端 AuthUser 同构) */
export interface AuthUserInfo {
  name: string
  role: string
}

/** 持久化的登录态:token + 用户 */
export interface StoredAuth {
  token: string
  user: AuthUserInfo
}

/** 安全获取 localStorage(隐私模式 / 非浏览器环境返回 null) */
function storage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
    const g = (globalThis as { localStorage?: Storage }).localStorage
    return g ?? null
  } catch {
    return null
  }
}

/** 读取本地登录态;缺失或数据损坏时返回 null */
export function getStoredAuth(): StoredAuth | null {
  try {
    const raw = storage()?.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredAuth>
    if (
      typeof parsed?.token !== 'string' ||
      !parsed.token ||
      typeof parsed?.user?.name !== 'string' ||
      typeof parsed?.user?.role !== 'string'
    ) {
      return null
    }
    return { token: parsed.token, user: { name: parsed.user.name, role: parsed.user.role } }
  } catch {
    return null
  }
}

/** 写入本地登录态(存储不可用时静默) */
export function storeAuth(auth: StoredAuth): void {
  try {
    storage()?.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth))
  } catch {
    /* 存储不可用时仅保留内存态 */
  }
}

/** 清除本地登录态(登出 / token 失效) */
export function clearStoredAuth(): void {
  try {
    storage()?.removeItem(AUTH_STORAGE_KEY)
  } catch {
    /* 静默 */
  }
}
