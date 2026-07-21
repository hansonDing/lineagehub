import type { ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import Layout from '@/components/Layout'
import { UserProvider, useUser } from '@/hooks/useUser'
import Dashboard from '@/pages/Dashboard'
import Lineage from '@/pages/Lineage'
import Login from '@/pages/Login'
import Sql from '@/pages/Sql'
import Metadata from '@/pages/Metadata'
import Changes from '@/pages/Changes'
import Settings from '@/pages/Settings'

/** 路由守卫:无 token 访问业务页 → /login(并记住来源路径,登录后回跳) */
function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useUser()
  const location = useLocation()
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <UserProvider>
      <Routes>
        {/* 登录页全屏无侧栏,不进 Layout 嵌套(已登录时 Login 内部重定向到 /) */}
        <Route path="login" element={<Login />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="lineage" element={<Lineage />} />
          <Route path="sql" element={<Sql />} />
          <Route path="metadata" element={<Metadata />} />
          <Route path="changes" element={<Changes />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </UserProvider>
  )
}
