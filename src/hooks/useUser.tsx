import type { ReactNode } from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { AuthUserInfo, StoredAuth } from '@/lib/auth'
import { clearStoredAuth, getStoredAuth, storeAuth } from '@/lib/auth'
import { getMe, login as apiLogin } from '@/lib/api'

/**
 * 全局当前登录用户(design.md §2 全局状态)
 * 登录即身份:凭证持久化在 localStorage(lineagehub-auth),
 * 顶栏展示登录用户 + 登出;审批收件箱按 user(姓名)过滤。
 * 未登录态:user 为空串、token 为 null,由路由守卫重定向到 /login。
 */

/** 演示用户(与后端 PRESET_USERS 一致;登录页拉取失败时的兜底展示) */
export const DEMO_USERS: AuthUserInfo[] = [
  { name: 'Leo', role: '数据工程师' },
  { name: 'Doris', role: '数据工程师' },
  { name: 'Fiona', role: '数据分析师' },
  { name: 'Hanson', role: '系统负责人' },
  { name: 'Jacky', role: '系统负责人' },
  { name: 'Jerry', role: 'BI 工程师' },
  { name: 'Maggie', role: '财务分析师' },
]

interface UserContextValue {
  /** 当前用户姓名(未登录为空串);兼容旧消费:审批过滤、提交人展示 */
  user: string
  /** 当前用户角色(未登录为空串) */
  role: string
  /** Bearer token(未登录为 null) */
  token: string | null
  isAuthenticated: boolean
  /** 登录:成功写入 localStorage 并返回用户;失败抛 ApiError(401 等) */
  login: (username: string, password: string) => Promise<AuthUserInfo>
  /** 登出:清除本地凭证与内存态(调用方负责跳 /login) */
  logout: () => void
}

const UserContext = createContext<UserContextValue>({
  user: '',
  role: '',
  token: null,
  isAuthenticated: false,
  login: async () => ({ name: '', role: '' }),
  logout: () => {},
})

export function UserProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<StoredAuth | null>(() => getStoredAuth())

  // 启动时校验本地 token 有效性;/auth/me 401 时 api 层已清除 localStorage,这里同步内存态
  useEffect(() => {
    if (!getStoredAuth()) return
    let cancelled = false
    getMe()
      .then((me) => {
        if (cancelled) return
        setAuth((cur) => (cur ? { ...cur, user: { name: me.name, role: me.role } } : cur))
      })
      .catch(() => {
        if (!cancelled) setAuth(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo<UserContextValue>(
    () => ({
      user: auth?.user.name ?? '',
      role: auth?.user.role ?? '',
      token: auth?.token ?? null,
      isAuthenticated: auth !== null,
      login: async (username, password) => {
        const res = await apiLogin({ username, password })
        const next: StoredAuth = { token: res.token, user: res.user }
        storeAuth(next)
        setAuth(next)
        return res.user
      },
      logout: () => {
        clearStoredAuth()
        setAuth(null)
      },
    }),
    [auth],
  )
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>
}

export function useUser() {
  return useContext(UserContext)
}
