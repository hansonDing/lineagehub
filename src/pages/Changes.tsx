/**
 * 变更与审批中心(/changes,changes.md §1)
 * 页面头 + 状态统计条(待我审批/审批中/本周已生效/已驳回)+
 * Tabs(审批收件箱 ?tab=inbox | 变更事件 ?tab=events | 发起变更 ?tab=create),
 * 支持 &change=<id> 深链打开 720px 详情抽屉
 */

import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { GitBranchPlus } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { listApprovals, listChanges } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { Tabs } from '@/components/common/Tabs'
import { APPROVALS_REFRESH_EVENT } from '@/components/Layout'
import { useUser } from '@/hooks/useUser'
import { Button } from '@/components/ui/button'
import type { ChangeListItemReal } from '@/components/changes/types'
import { InboxTab } from '@/components/changes/InboxTab'
import { EventsTab } from '@/components/changes/EventsTab'
import { CreateTab } from '@/components/changes/CreateTab'
import { ChangeDetailDrawer } from '@/components/changes/ChangeDetailDrawer'
import { CountUp } from '@/components/changes/shared'

/** 首屏统计条入场仅播放一次 */
let entrancePlayed = false

const VALID_TABS = new Set(['inbox', 'events', 'create'])

interface StatsData {
  /** 待我审批(当前用户 pending 任务数,琥珀) */
  mine: number
  /** 审批中(未决事件数,蓝) */
  approving: number
  /** 本周已生效(绿) */
  effectiveWeek: number
  /** 已驳回(红) */
  rejected: number
}

function StatsBar({ stats, loading }: { stats: StatsData | null; loading: boolean }) {
  const { t } = useT()
  const segments: { label: string; value: number; className: string }[] = [
    { label: t('changes.stats.mine'), value: stats?.mine ?? 0, className: 'text-pending' },
    { label: t('common.status.approving'), value: stats?.approving ?? 0, className: 'text-info' },
    { label: t('changes.stats.effectiveWeek'), value: stats?.effectiveWeek ?? 0, className: 'text-success' },
    { label: t('common.status.rejected'), value: stats?.rejected ?? 0, className: 'text-danger' },
  ]
  return (
    <div className="mb-4 flex h-16 items-stretch rounded-lg border border-slate-200 bg-white shadow-card">
      {segments.map((seg, i) => (
        <motion.div
          key={seg.label}
          initial={!entrancePlayed ? { opacity: 0, y: 4 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.2,
            delay: !entrancePlayed ? i * 0.04 : 0,
            ease: [0.22, 1, 0.36, 1],
          }}
          className={cn(
            'flex min-w-0 flex-1 flex-col justify-center px-3 sm:px-4',
            i > 0 && 'border-l border-slate-100',
          )}
        >
          <span className="truncate text-xs text-slate-500">{seg.label}</span>
          <span
            className={cn(
              'mt-0.5 font-mono text-xl font-semibold leading-6',
              seg.className,
              !stats && loading && 'animate-pulse-soft text-slate-300',
            )}
          >
            {stats ? <CountUp value={seg.value} /> : '—'}
          </span>
        </motion.div>
      ))}
    </div>
  )
}

export default function Changes() {
  const { t } = useT()
  const { user } = useUser()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab') ?? 'inbox'
  const tab = VALID_TABS.has(tabParam) ? tabParam : 'inbox'
  const changeParam = searchParams.get('change')
  const drawerId = changeParam && /^\d+$/.test(changeParam) ? Number(changeParam) : null

  const [stats, setStats] = useState<StatsData | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)

  const loadStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      const [pendingMine, events] = await Promise.all([
        listApprovals({ status: 'pending', approver: user }),
        listChanges() as unknown as Promise<ChangeListItemReal[]>,
      ])
      const weekAgo = Date.now() - 7 * 86_400_000
      setStats({
        mine: pendingMine.length,
        approving: events.filter((e) => e.status === 'pending').length,
        effectiveWeek: events.filter(
          (e) => e.status === 'approved' && e.resolved_at && new Date(e.resolved_at).getTime() >= weekAgo,
        ).length,
        rejected: events.filter((e) => e.status === 'rejected').length,
      })
    } catch {
      /* 统计条失败不阻断页面,保持旧值 */
    } finally {
      setStatsLoading(false)
    }
  }, [user])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  // 审批操作 / 新变更发起后刷新统计条
  useEffect(() => {
    const handler = () => void loadStats()
    window.addEventListener(APPROVALS_REFRESH_EVENT, handler)
    return () => window.removeEventListener(APPROVALS_REFRESH_EVENT, handler)
  }, [loadStats])

  useEffect(() => {
    entrancePlayed = true
  }, [])

  const patchParams = (patch: (p: URLSearchParams) => void) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        patch(next)
        return next
      },
      { replace: true },
    )
  }

  const setTab = (key: string) => {
    patchParams((p) => {
      if (key === 'inbox') p.delete('tab')
      else p.set('tab', key)
    })
  }

  const openChange = (id: number) => {
    patchParams((p) => p.set('change', String(id)))
  }

  const closeChange = () => {
    patchParams((p) => p.delete('change'))
  }

  let tabContent: ReactNode
  if (tab === 'inbox') {
    tabContent = <InboxTab />
  } else if (tab === 'events') {
    tabContent = <EventsTab onOpenDetail={openChange} onCreate={() => setTab('create')} />
  } else {
    tabContent = (
      <CreateTab
        onSubmitted={(id) => {
          patchParams((p) => {
            p.set('tab', 'events')
            p.set('change', String(id))
          })
        }}
      />
    )
  }

  return (
    <div>
      {/* 页面头 */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold leading-7 text-slate-900">{t('changes.title')}</h1>
        <Button variant="primary" onClick={() => setTab('create')}>
          <GitBranchPlus className="size-3.5" />
          {t('changes.action.create')}
        </Button>
      </div>

      {/* 状态统计条 */}
      <StatsBar stats={stats} loading={statsLoading} />

      {/* Tabs */}
      <Tabs
        className="mb-4"
        items={[
          {
            key: 'inbox',
            label: t('changes.tabs.inbox'),
            count: stats?.mine,
            countTone: 'pending',
          },
          { key: 'events', label: t('changes.tabs.events') },
          { key: 'create', label: t('changes.action.create') },
        ]}
        value={tab}
        onChange={setTab}
      />

      {/* Tab 内容(切换 opacity 150ms) */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {tabContent}
        </motion.div>
      </AnimatePresence>

      {/* 详情抽屉(支持 ?change=<id> 深链) */}
      <ChangeDetailDrawer changeId={drawerId} onClose={closeChange} />
    </div>
  )
}
