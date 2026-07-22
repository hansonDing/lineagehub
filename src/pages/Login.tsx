/**
 * 登录页(/login)— 全屏无侧栏,不进 Layout 嵌套
 * 左侧品牌区(墨蓝 #0C1222:logo + 产品名 + 价值文案 + 极简血缘 SVG 装饰);
 * 右侧登录卡:用户选择(7 人卡片网格,选中 teal 描边)+ 密码 + 登录(loading)
 * + 演示密码提示条;401 红字提示。已有 token 时直接跳 /。
 */

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { KeyRound, LogIn } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AuthUser } from '@/lib/api'
import { getAuthUsers } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { Avatar } from '@/components/common/Avatar'
import { LangSwitcher } from '@/components/LangSwitcher'
import { Button } from '@/components/ui/button'
import { DEMO_USERS, useUser } from '@/hooks/useUser'

/** 品牌区极简血缘装饰:3 源节点 → 中间节点 → 2 目标节点(深色底,teal 强调) */
function LineageArtwork() {
  const nodeStroke = '#263349'
  const nodeFill = '#121B2E'
  const edge = '#2E3D55'
  const accent = '#2DD4BF'
  return (
    <svg viewBox="0 0 520 240" className="w-full max-w-[520px]" fill="none" aria-hidden>
      {/* 边:源 -> 中间 */}
      <path d="M120 40 C 180 40, 200 110, 250 113" stroke={edge} strokeWidth="1.5" />
      <path d="M120 120 L 250 120" stroke={accent} strokeWidth="1.5" strokeDasharray="6 6" />
      <path d="M120 200 C 180 200, 200 130, 250 127" stroke={edge} strokeWidth="1.5" />
      {/* 边:中间 -> 目标 */}
      <path d="M330 113 C 380 110, 390 70, 430 66" stroke={accent} strokeWidth="1.5" />
      <path d="M330 127 C 380 130, 390 170, 430 174" stroke={edge} strokeWidth="1.5" />
      {/* 源节点 */}
      {[
        { y: 24, label: 'ods.ods_trade_order' },
        { y: 104, label: 'ods.ods_user_info' },
        { y: 184, label: 'dim.dim_region' },
      ].map((n) => (
        <g key={n.label}>
          <rect x="20" y={n.y} width="100" height="32" rx="6" fill={nodeFill} stroke={nodeStroke} strokeWidth="1.5" />
          <text x="30" y={n.y + 20} fill="#8B98AD" fontSize="11" fontFamily="JetBrains Mono, Menlo, monospace">
            {n.label.length > 14 ? `${n.label.slice(5, 16)}…` : n.label}
          </text>
        </g>
      ))}
      {/* 中间节点(聚焦) */}
      <rect x="250" y="100" width="80" height="40" rx="6" fill={nodeFill} stroke={accent} strokeWidth="1.5" />
      <text x="262" y="124" fill="#E2E8F0" fontSize="11" fontFamily="JetBrains Mono, Menlo, monospace">
        dwd
      </text>
      {/* 目标节点 */}
      <g>
        <rect x="430" y="50" width="70" height="32" rx="6" fill={nodeFill} stroke={nodeStroke} strokeWidth="1.5" />
        <text x="442" y="70" fill="#8B98AD" fontSize="11" fontFamily="JetBrains Mono, Menlo, monospace">
          dws
        </text>
      </g>
      <g>
        <rect x="430" y="158" width="70" height="32" rx="6" fill={nodeFill} stroke={nodeStroke} strokeWidth="1.5" />
        <text x="442" y="178" fill="#8B98AD" fontSize="11" fontFamily="JetBrains Mono, Menlo, monospace">
          ads
        </text>
      </g>
    </svg>
  )
}

export default function Login() {
  const { t } = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const { isAuthenticated, login } = useUser()

  const [users, setUsers] = useState<AuthUser[]>([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [usersFallback, setUsersFallback] = useState(false)
  const [selected, setSelected] = useState<string>('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // 拉取可选用户(演示模式走 mock;失败时兜底内置演示用户)
  useEffect(() => {
    let cancelled = false
    getAuthUsers()
      .then((list) => {
        if (cancelled) return
        setUsers(list)
        setSelected((cur) => cur || list[0]?.name || '')
      })
      .catch(() => {
        if (cancelled) return
        setUsers(DEMO_USERS)
        setSelected((cur) => cur || DEMO_USERS[0]?.name || '')
        setUsersFallback(true)
      })
      .finally(() => {
        if (!cancelled) setUsersLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 已登录访问 /login → 回首页
  if (isAuthenticated) return <Navigate to="/" replace />

  const from = (location.state as { from?: string } | null)?.from

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!selected || submitting) return
    setSubmitting(true)
    setError('')
    try {
      await login(selected, password)
      navigate(from && from !== '/login' ? from : '/', { replace: true })
    } catch (err) {
      // 401 使用后端/mock 原文(用户名或密码错误),其余给通用文案
      // (MockApiError 与 ApiError 不同类,统一按 status 判定)
      const status = (err as { status?: number } | null)?.status
      setError(status === 401 && err instanceof Error && err.message ? err.message : t('login.error.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-[100dvh] bg-white">
      {/* ============ 左侧品牌区 ============ */}
      <div className="hidden w-[46%] flex-col justify-between bg-ink p-10 lg:flex xl:p-14">
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="LineageHub" width={34} height={34} />
          <div className="leading-tight">
            <div className="text-[17px] font-semibold text-white">LineageHub</div>
            <div className="text-[11px] text-[#55637A]">{t('layout.subtitle')}</div>
          </div>
        </div>
        <div>
          <h1 className="text-[28px] font-semibold leading-10 text-white">{t('login.brand.value')}</h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-[#8B98AD]">{t('login.brand.desc')}</p>
          <div className="mt-10">
            <LineageArtwork />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-[#34D399]" />
          <span className="text-[11px] text-[#55637A]">{t('layout.engine.name')}</span>
          <span className="font-mono text-xs text-[#8B98AD]">dialect = spark</span>
        </div>
      </div>

      {/* ============ 右侧登录卡 ============ */}
      <div className="relative flex flex-1 items-center justify-center bg-slate-50 px-4 py-8 sm:px-6 sm:py-10">
        <div className="absolute right-4 top-4 sm:right-6 sm:top-5">
          <LangSwitcher />
        </div>
        <div className="w-full max-w-[400px]">
          {/* 移动端品牌头( lg 以下品牌区隐藏时) */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <img src="/logo.svg" alt="LineageHub" width={30} height={30} />
            <div className="leading-tight">
              <div className="text-[15px] font-semibold text-slate-900">LineageHub</div>
              <div className="text-[11px] text-slate-500">{t('layout.subtitle')}</div>
            </div>
          </div>

          <h2 className="text-xl font-semibold text-slate-900">{t('login.title')}</h2>
          <p className="mt-1 text-[13px] text-slate-500">{t('login.subtitle')}</p>

          <form onSubmit={(e) => void handleSubmit(e)} className="mt-6 space-y-5">
            {/* 用户选择(卡片网格) */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-[13px] font-medium text-slate-700">{t('login.users.title')}</label>
                {usersFallback && <span className="text-[11px] text-pending">{t('login.users.loadFailed')}</span>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {usersLoading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="h-12 animate-pulse-soft rounded-md border border-slate-200 bg-slate-100" />
                    ))
                  : users.map((u) => {
                      const active = selected === u.name
                      return (
                        <button
                          key={u.name}
                          type="button"
                          onClick={() => setSelected(u.name)}
                          aria-pressed={active}
                          className={cn(
                            'flex h-12 items-center gap-2.5 rounded-md border px-3 text-left transition-colors duration-120',
                            active
                              ? 'border-primary-600 bg-primary-50 ring-2 ring-[rgba(13,148,136,0.30)]'
                              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                          )}
                        >
                          <Avatar name={u.name} size={28} />
                          <span className="min-w-0 leading-tight">
                            <span className="block truncate text-[13px] font-medium text-slate-900">{u.name}</span>
                            <span className="block truncate text-[11px] text-slate-500">{u.role}</span>
                          </span>
                        </button>
                      )
                    })}
              </div>
            </div>

            {/* 密码 */}
            <div>
              <label htmlFor="login-password" className="mb-1.5 block text-[13px] font-medium text-slate-700">
                {t('login.password.label')}
              </label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setError('')
                  }}
                  placeholder={t('login.password.placeholder')}
                  autoComplete="current-password"
                  className={cn(
                    'h-9 w-full rounded-md border bg-white pl-8 pr-3 text-[13px] text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:ring-2 focus:ring-[rgba(13,148,136,0.30)]',
                    error ? 'border-danger' : 'border-slate-300 focus:border-primary-600',
                  )}
                />
              </div>
              {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
              {/* 演示密码提示条 */}
              <div className="mt-2 flex h-8 items-center gap-2 rounded-md bg-slate-100 px-2.5 text-xs text-slate-500">
                <span>{t('login.password.demoHint')}</span>
                <code className="rounded bg-white px-1.5 py-px font-mono text-[11px] text-slate-700">
                  lineagehub123
                </code>
              </div>
            </div>

            <Button type="submit" className="h-9 w-full" loading={submitting} disabled={!selected || usersLoading}>
              {!submitting && <LogIn className="size-3.5" />}
              {submitting ? t('login.submitting') : t('common.button.login')}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
