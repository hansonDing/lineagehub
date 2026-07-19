import type { ReactNode } from 'react'
import { createContext, useContext, useMemo, useState } from 'react'

/**
 * 全局当前登录用户(design.md §2 全局状态)
 * 默认「张三」,顶栏可切换身份以便演示;审批收件箱按其过滤
 */

export const DEMO_USERS = ['张三', '李四', '王五', '赵六', '孙七', '周八', '吴九'] as const

interface UserContextValue {
  user: string
  setUser: (name: string) => void
}

const UserContext = createContext<UserContextValue>({ user: '张三', setUser: () => {} })

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<string>('张三')
  const value = useMemo(() => ({ user, setUser }), [user])
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>
}

export function useUser() {
  return useContext(UserContext)
}
