import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import {
  Bell,
  Check,
  ChevronDown,
  Database,
  FileCode2,
  GitPullRequest,
  LayoutDashboard,
  Network,
  Search,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getDemoModeListeners,
  isDemoMode,
  listApprovals,
  listReports,
  listScripts,
  listSystems,
  listTables,
  type DemoModeListener,
} from '@/lib/api'
import { Avatar } from '@/components/common/Avatar'
import { LayerBadge } from '@/components/common/LayerBadge'
import { Toaster } from '@/components/common/Toast'
import { DEMO_USERS, useUser } from '@/hooks/useUser'

/** 审批收件箱刷新事件:审批操作后 dispatch 以更新侧栏徽标 */
export const APPROVALS_REFRESH_EVENT = 'lineagehub:approvals-refresh'
export function notifyApprovalsChanged() {
  window.dispatchEvent(new Event(APPROVALS_REFRESH_EVENT))
}

const NAV_ITEMS = [
  { to: '/', label: '总览', icon: LayoutDashboard, end: true },
  { to: '/lineage', label: '血缘图谱', icon: Network },
  { to: '/sql', label: 'SQL 管理', icon: FileCode2 },
  { to: '/metadata', label: '元数据配置', icon: Database },
  { to: '/changes', label: '变更与审批', icon: GitPullRequest },
] as const

const ROUTE_TITLES: Record<string, string> = {
  '/': '总览',
  '/lineage': '血缘图谱',
  '/sql': 'SQL 管理',
  '/metadata': '元数据配置',
  '/changes': '变更与审批',
}

// ---------- 侧栏 ----------

function SidebarSection({ children }: { children: ReactNode }) {
  return <div className="px-3">{children}</div>
}

function Sidebar({ pendingCount, user }: { pendingCount: number; user: string }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-[232px] flex-col bg-ink">
      {/* Logo 区:高 56px,与顶栏齐平 */}
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <img src="/logo.svg" alt="LineageHub" width={28} height={28} />
        <div className="leading-tight">
          <div className="text-[15px] font-semibold text-white">LineageHub</div>
          <div className="text-[11px] text-[#55637A]">数据血缘平台</div>
        </div>
      </div>

      {/* 主导航 */}
      <nav className="mt-2 flex-1 space-y-0.5 overflow-y-auto px-3">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={'end' in item ? item.end : false}
            className={({ isActive }) =>
              cn(
                'group flex h-9 items-center gap-2.5 rounded-md px-3 text-[13px] font-medium transition-colors duration-120',
                isActive
                  ? 'bg-[rgba(45,212,191,0.10)] text-[#5EEAD4]'
                  : 'text-[#8B98AD] hover:bg-[rgba(148,163,184,0.08)]',
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  className={cn(
                    'size-4 shrink-0 transition-colors duration-120',
                    isActive ? 'text-[#5EEAD4]' : 'text-[#55637A] group-hover:text-[#8B98AD]',
                  )}
                />
                <span className="flex-1">{item.label}</span>
                {item.to === '/changes' && pendingCount > 0 && (
                  <span className="rounded-full bg-pending px-1.5 text-[10px] font-medium leading-4 text-white">
                    {pendingCount > 99 ? '99+' : pendingCount}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* 底部区 */}
      <SidebarSection>
        <div className="border-t border-[rgba(148,163,184,0.12)] py-3">
          {/* 解析引擎状态卡 */}
          <div className="mb-3 rounded-md px-2 py-2">
            <div className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-[#34D399]" />
              <span className="text-[11px] text-[#55637A]">解析引擎 · sqlglot</span>
            </div>
            <div className="mt-1 pl-3.5 font-mono text-xs text-[#8B98AD]">dialect = spark</div>
          </div>
          {/* 当前用户卡 */}
          <div className="flex items-center gap-2.5 px-2">
            <Avatar name={user} size={28} />
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[13px] text-[#CBD5E1]">{user}</div>
              <div className="text-[11px] text-[#55637A]">数据工程师</div>
            </div>
          </div>
        </div>
      </SidebarSection>
    </aside>
  )
}

// ---------- 全局搜索 ----------

interface SearchResults {
  tables: { id: number; name: string; layer: string }[]
  reports: { id: number; name: string; owner: string }[]
  systems: { id: number; name: string }[]
  scripts: { id: number; name: string }[]
}

function GlobalSearch() {
  const [keyword, setKeyword] = useState('')
  const [focused, setFocused] = useState(false)
  const [results, setResults] = useState<SearchResults | null>(null)
  const navigate = useNavigate()
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!keyword.trim()) {
      setResults(null)
      return
    }
    const kw = keyword.trim().toLowerCase()
    const timer = setTimeout(async () => {
      const next: SearchResults = { tables: [], reports: [], systems: [], scripts: [] }
      try {
        const tables = await listTables({ keyword: kw })
        next.tables = tables.slice(0, 4).map((t) => ({ id: t.id, name: t.name, layer: t.layer }))
      } catch {
        /* 后端不可用时静默 */
      }
      try {
        const [reports, systems, scripts] = await Promise.all([
          listReports().catch(() => []),
          listSystems().catch(() => []),
          listScripts().catch(() => []),
        ])
        next.reports = reports.filter((r) => r.name.toLowerCase().includes(kw)).slice(0, 3)
        next.systems = systems.filter((s) => s.name.toLowerCase().includes(kw)).slice(0, 3)
        next.scripts = scripts.filter((s) => s.name.toLowerCase().includes(kw)).slice(0, 3)
      } catch {
        /* 忽略 */
      }
      setResults(next)
    }, 200)
    return () => clearTimeout(timer)
  }, [keyword])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setFocused(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        boxRef.current?.querySelector('input')?.focus()
      }
      if (e.key === 'Escape') setFocused(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const go = (path: string) => {
    setFocused(false)
    setKeyword('')
    navigate(path)
  }

  const hasResults =
    results && (results.tables.length + results.reports.length + results.systems.length + results.scripts.length > 0)

  return (
    <div
      ref={boxRef}
      className={cn('relative transition-[width] duration-200', focused ? 'w-[420px]' : 'w-80')}
    >
      <div className="flex h-8 items-center gap-2 rounded-md bg-slate-100 px-2.5">
        <Search className="size-4 shrink-0 text-slate-400" />
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder="搜索表 / 报表 / 系统…"
          className="h-full flex-1 bg-transparent text-[13px] text-slate-900 outline-none placeholder:text-slate-400"
        />
        <kbd className="rounded border border-slate-200 bg-white px-1 font-mono text-[11px] leading-4 text-slate-400">
          ⌘K
        </kbd>
      </div>
      {focused && keyword.trim() && (
        <div className="absolute left-0 right-0 top-9 z-50 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-overlay">
          {!hasResults ? (
            <div className="px-3 py-4 text-center text-xs text-slate-500">未找到匹配的结果</div>
          ) : (
            <>
              {results.tables.length > 0 && (
                <SearchGroup label="数仓表">
                  {results.tables.map((t) => (
                    <SearchRow key={`t-${t.id}`} onClick={() => go(`/lineage?table=${t.name}`)}>
                      <span className="flex-1 truncate font-mono text-[13px] text-slate-900">{t.name}</span>
                      <LayerBadge layer={t.layer} />
                    </SearchRow>
                  ))}
                </SearchGroup>
              )}
              {results.reports.length > 0 && (
                <SearchGroup label="报表">
                  {results.reports.map((r) => (
                    <SearchRow key={`r-${r.id}`} onClick={() => go('/metadata?tab=reports')}>
                      <span className="flex-1 truncate text-[13px] text-slate-900">{r.name}</span>
                      <span className="text-xs text-slate-400">{r.owner}</span>
                    </SearchRow>
                  ))}
                </SearchGroup>
              )}
              {results.systems.length > 0 && (
                <SearchGroup label="系统">
                  {results.systems.map((s) => (
                    <SearchRow key={`s-${s.id}`} onClick={() => go('/metadata?tab=systems')}>
                      <span className="flex-1 truncate text-[13px] text-slate-900">{s.name}</span>
                    </SearchRow>
                  ))}
                </SearchGroup>
              )}
              {results.scripts.length > 0 && (
                <SearchGroup label="脚本">
                  {results.scripts.map((s) => (
                    <SearchRow key={`sc-${s.id}`} onClick={() => go('/sql')}>
                      <span className="flex-1 truncate font-mono text-[13px] text-slate-900">{s.name}</span>
                    </SearchRow>
                  ))}
                </SearchGroup>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function SearchGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="px-3 pb-0.5 pt-2 text-[11px] text-slate-400">{label}</div>
      {children}
    </div>
  )
}

function SearchRow({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 w-full items-center gap-2 px-3 text-left transition-colors duration-120 hover:bg-slate-50"
    >
      {children}
    </button>
  )
}

// ---------- 用户切换 ----------

function UserSwitcher({ pendingCount }: { pendingCount: number }) {
  const { user, setUser } = useUser()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  return (
    <div className="flex items-center gap-3">
      {/* 通知铃铛 */}
      <button
        type="button"
        aria-label="通知"
        className="relative rounded p-1 text-slate-500 transition-colors duration-120 hover:text-slate-900"
      >
        <Bell className="size-4" />
        {pendingCount > 0 && (
          <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-pending" />
        )}
      </button>
      {/* 用户头像 + 身份切换 */}
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 rounded p-0.5 transition-colors duration-120 hover:bg-slate-100"
        >
          <Avatar name={user} size={28} />
          <ChevronDown className="size-3.5 text-slate-400" />
        </button>
        {open && (
          <div className="absolute right-0 top-10 z-50 w-40 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-overlay">
            <div className="px-3 pb-1 pt-2 text-[11px] text-slate-400">切换身份(演示)</div>
            {DEMO_USERS.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setUser(name)
                  setOpen(false)
                }}
                className="flex h-9 w-full items-center gap-2 px-3 text-left text-[13px] text-slate-700 transition-colors duration-120 hover:bg-slate-50"
              >
                <Avatar name={name} size={24} />
                <span className="flex-1">{name}</span>
                {name === user && <Check className="size-3.5 text-primary-600" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- Layout ----------

export default function Layout() {
  const location = useLocation()
  const { user } = useUser()
  const [pendingCount, setPendingCount] = useState(0)
  const [demoMode, setDemoMode] = useState(isDemoMode())

  // 订阅演示模式:API 降级到内置模拟数据时即时显示琥珀色徽标
  useEffect(() => {
    const listener: DemoModeListener = (active) => setDemoMode(active)
    getDemoModeListeners().add(listener)
    return () => {
      getDemoModeListeners().delete(listener)
    }
  }, [])

  const refreshPending = useCallback(async () => {
    try {
      const items = await listApprovals({ status: 'pending', approver: user })
      setPendingCount(items.length)
    } catch {
      setPendingCount(0) // 后端不可用时静默
    }
  }, [user])

  useEffect(() => {
    refreshPending()
  }, [refreshPending, location.pathname])

  useEffect(() => {
    window.addEventListener(APPROVALS_REFRESH_EVENT, refreshPending)
    return () => window.removeEventListener(APPROVALS_REFRESH_EVENT, refreshPending)
  }, [refreshPending])

  const title = ROUTE_TITLES[location.pathname] ?? '总览'
  const isCanvasPage = location.pathname === '/lineage'

  return (
    <div className="min-h-[100dvh] bg-slate-50">
      <Sidebar pendingCount={pendingCount} user={user} />
      <div className="pl-[232px]">
        {/* 顶栏 */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-slate-200 bg-white px-6">
          {/* 面包屑 */}
          <nav className="flex items-center gap-1.5 text-[13px]">
            <span className="text-slate-500">LineageHub</span>
            <span className="text-slate-300">/</span>
            <span className="font-semibold text-slate-900">{title}</span>
          </nav>
          <div className="flex-1" />
          <GlobalSearch />
          {/* 环境徽标 */}
          <span className="flex h-6 items-center gap-1.5 rounded bg-slate-100 px-2 text-xs text-slate-600">
            <span className="size-1.5 rounded-full bg-success" />
            生产环境
          </span>
          {/* 演示模式徽标:后端不可达降级到内置模拟 API 时显示 */}
          {demoMode && (
            <span
              title="API 不可达,当前为浏览器内置演示数据"
              className="flex h-6 cursor-default items-center gap-1.5 rounded px-2 text-[11px] font-medium"
              style={{ backgroundColor: 'rgba(217, 119, 6, 0.1)', color: '#D97706' }}
            >
              <span className="size-1.5 rounded-full" style={{ backgroundColor: '#D97706' }} />
              演示模式 · 后端未连接
            </span>
          )}
          <UserSwitcher pendingCount={pendingCount} />
        </header>
        {/* 内容区:血缘图谱页 0 padding 撑满画布 */}
        <main className={isCanvasPage ? 'h-[calc(100dvh-56px)]' : 'p-6'}>
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  )
}
