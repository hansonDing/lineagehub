import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BarChart3, Copy, FileCode2, Send, X } from 'lucide-react'
import { useNavigate } from 'react-router'
import type { ReportListItem, SqlScript, TableDetail, TableLayer } from '@/lib/api'
import { getChange, getLineageGraph, getTable, listChanges, listReports, listScripts } from '@/lib/api'
import { formatChangeId, formatDateTime } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/common/Avatar'
import { LayerBadge } from '@/components/common/LayerBadge'
import { StatusBadge } from '@/components/common/StatusBadge'
import { toast } from '@/components/common/Toast'
import { layerColor } from './constants'

/** 上/下游邻居(携边来源脚本名) */
interface NeighborRef {
  id: number
  name: string
  layer: TableLayer
  scriptName: string | null
}

type DrawerTab = 'fields' | 'up' | 'down' | 'sql' | 'reports'

/** 后端 TableDetail 实际含 source_system_name / column_count(api.ts 类型未冗余声明) */
type TableDetailFull = TableDetail & {
  source_system_name?: string | null
  column_count?: number
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      return true
    } catch {
      return false
    }
  }
}

const sectionContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
}
const sectionItem = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } },
}

/** 分区字段判定:注释含「分区」 */
function isPartitionColumn(comment: string | null): boolean {
  return !!comment && comment.includes('分区')
}

/**
 * 右侧表详情抽屉(lineage.md §5,深色 400px,无遮罩)
 * Tabs:字段 | 上游 | 下游 | 关联 SQL | 关联报表;底部固定操作条
 */
export function DetailDrawer({
  tableId,
  onClose,
  onFocusTable,
}: {
  tableId: number
  onClose: () => void
  onFocusTable: (id: number, name: string) => void
}) {
  const { t } = useT()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<TableDetailFull | null>(null)
  const [up, setUp] = useState<NeighborRef[]>([])
  const [down, setDown] = useState<NeighborRef[]>([])
  const [scripts, setScripts] = useState<SqlScript[]>([])
  const [reports, setReports] = useState<ReportListItem[]>([])
  /** 最近 DDL 变更涉及字段:字段名 → 变更事件 id */
  const [changedCols, setChangedCols] = useState<Map<string, number>>(new Map())
  const [tab, setTab] = useState<DrawerTab>('fields')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setTab('fields')
    setDetail(null)
    setChangedCols(new Map())

    async function load() {
      try {
        const [table, graph, allScripts, allReports] = await Promise.all([
          getTable(tableId),
          getLineageGraph({ table_id: tableId, direction: 'both', depth: 1 }).catch(() => ({
            nodes: [],
            edges: [],
          })),
          listScripts().catch(() => [] as SqlScript[]),
          listReports().catch(() => [] as ReportListItem[]),
        ])
        if (cancelled) return

        const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
        const upList: NeighborRef[] = []
        const downList: NeighborRef[] = []
        const scriptNames = new Set<string>()
        for (const e of graph.edges) {
          if (e.script_name) scriptNames.add(e.script_name)
          if (e.target === tableId) {
            const n = nodeById.get(e.source)
            if (n) upList.push({ id: n.id, name: n.name, layer: n.layer, scriptName: e.script_name })
          }
          if (e.source === tableId) {
            const n = nodeById.get(e.target)
            if (n) downList.push({ id: n.id, name: n.name, layer: n.layer, scriptName: e.script_name })
          }
        }
        setDetail(table as TableDetailFull)
        setUp(upList)
        setDown(downList)
        setScripts(
          allScripts.filter((s) => s.target_table === table.name || scriptNames.has(s.name)),
        )
        setReports(allReports.filter((r) => r.table_id === tableId))
        setLoading(false)

        // 最近 DDL 变更标记(尽力而为,失败静默)
        try {
          const changes = (await listChanges()).filter(
            (c) => c.change_type === 'ddl_change' && c.object_name === table.name,
          )
          changes.sort((a, b) => b.created_at.localeCompare(a.created_at))
          const marks = new Map<string, number>()
          for (const c of changes.slice(0, 2)) {
            const impact = await getChange(c.id)
            for (const col of impact.diff.added ?? []) {
              if (!marks.has(col.name)) marks.set(col.name, c.id)
            }
            for (const col of impact.diff.type_changed ?? []) {
              if (!marks.has(col.name)) marks.set(col.name, c.id)
            }
          }
          if (!cancelled) setChangedCols(marks)
        } catch {
          /* 无变更数据时静默 */
        }
      } catch (err) {
        if (!cancelled) {
          setLoading(false)
          toast.error(t('lineage.drawer.loadFailed'), err instanceof Error ? err.message : undefined)
          onClose()
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId])

  const tabs = useMemo(
    () =>
      [
        { key: 'fields', label: t('lineage.drawer.tab.fields') },
        { key: 'up', label: t('lineage.drawer.tab.upstream', { count: up.length }) },
        { key: 'down', label: t('lineage.drawer.tab.downstream', { count: down.length }) },
        { key: 'sql', label: t('lineage.drawer.tab.sql') },
        { key: 'reports', label: t('lineage.drawer.tab.reports') },
      ] as { key: DrawerTab; label: string }[],
    [t, up.length, down.length],
  )

  const columns = useMemo(
    () => (detail ? detail.columns.slice().sort((a, b) => a.ordinal - b.ordinal) : []),
    [detail],
  )

  const onCopyName = async () => {
    if (!detail) return
    const ok = await copyText(detail.name)
    if (ok) toast.success(t('lineage.toast.copied'), detail.name)
    else toast.error(t('lineage.toast.copyFailed'))
  }

  const neighborRow = (n: NeighborRef) => (
    <button
      key={n.id}
      type="button"
      onClick={() => onFocusTable(n.id, n.name)}
      className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left transition-colors duration-120 hover:bg-[rgba(148,163,184,0.08)]"
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: layerColor(n.layer) }} />
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-[#CBD5E1]">{n.name}</span>
      {n.scriptName && (
        <span className="shrink-0 truncate font-mono text-[11px] text-[#55637A]">{n.scriptName}</span>
      )}
    </button>
  )

  const emptyHint = (text: string) => (
    <div className="py-8 text-center text-xs text-[#55637A]">{text}</div>
  )

  return (
    <motion.aside
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
      className="absolute inset-y-0 right-0 z-20 flex w-[400px] flex-col border-l border-[#1E293B] bg-[#0F172A]"
    >
      {loading || !detail ? (
        /* 加载骨架 */
        <div className="flex h-full flex-col">
          <div className="flex h-14 items-center justify-between border-b border-[#1E293B] px-5">
            <div className="h-4 w-48 animate-pulse-soft rounded bg-[#1E293B]" />
            <X className="size-4 text-[#55637A]" />
          </div>
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-8 animate-pulse-soft rounded bg-[#121B2E]" />
            ))}
          </div>
        </div>
      ) : (
        <motion.div
          key={tableId}
          variants={sectionContainer}
          initial="hidden"
          animate="show"
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* 头部 */}
          <motion.div variants={sectionItem} className="shrink-0 border-b border-[#1E293B] px-5 pb-4 pt-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <LayerBadge layer={detail.layer} dark className="shrink-0" />
                <h2 className="break-all font-mono text-base font-semibold leading-6 text-[#F1F5F9]">
                  {detail.name}
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={onCopyName}
                  aria-label={t('lineage.action.copyName')}
                  title={t('lineage.action.copyName')}
                  className="rounded p-1 text-[#8B98AD] transition-colors duration-120 hover:bg-[rgba(148,163,184,0.08)] hover:text-[#F1F5F9]"
                >
                  <Copy className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t('common.close')}
                  className="rounded p-1 text-[#8B98AD] transition-colors duration-120 hover:bg-[rgba(148,163,184,0.08)] hover:text-[#F1F5F9]"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
            <div className="mt-2 text-xs leading-5 text-[#8B98AD]">
              {t('lineage.drawer.meta', {
                owner: detail.owner || t('lineage.drawer.ownerFallback'),
                system: detail.source_system_name ?? t('lineage.drawer.internalSystem'),
                count: detail.column_count ?? detail.columns.length,
                time: formatDateTime(detail.updated_at).slice(0, 10),
              })}
            </div>
            {reports.length > 0 && (
              <div className="mt-1 flex items-center gap-1 text-[11px] text-[#C9A23F]">
                <BarChart3 className="size-3" />
                {t('lineage.drawer.reportSource', { count: reports.length })}
              </div>
            )}
          </motion.div>

          {/* Tabs */}
          <motion.div variants={sectionItem} className="flex shrink-0 gap-5 border-b border-[#1E293B] px-5">
            {tabs.map((t) => {
              const active = tab === t.key
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={cn(
                    'relative px-0.5 py-2.5 text-[13px] font-medium transition-colors duration-180',
                    active ? 'text-[#5EEAD4]' : 'text-[#8B98AD] hover:text-[#CBD5E1]',
                  )}
                >
                  {t.label}
                  {active && (
                    <motion.span
                      layoutId="drawer-tab-underline"
                      transition={{ duration: 0.18 }}
                      className="absolute inset-x-0 bottom-0 h-0.5 bg-[#5EEAD4]"
                    />
                  )}
                </button>
              )
            })}
          </motion.div>

          {/* 内容区 */}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={tab}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {tab === 'fields' &&
                  (columns.length === 0 ? (
                    emptyHint(t('lineage.drawer.empty.fields'))
                  ) : (
                    <div>
                      {columns.map((c) => {
                        const changeId = changedCols.get(c.name)
                        return (
                          <div key={c.id} className="flex h-8 items-center gap-2 px-2">
                            {changeId != null ? (
                              <span
                                title={t('lineage.drawer.changeAdded', { id: formatChangeId(changeId) })}
                                className="size-[5px] shrink-0 rounded-full bg-[#D97706]"
                              />
                            ) : (
                              <span className="size-[5px] shrink-0" />
                            )}
                            <span className="min-w-0 truncate font-mono text-xs text-[#CBD5E1]">
                              {c.name}
                              {isPartitionColumn(c.comment) && (
                                <span
                                  title={t('lineage.drawer.partition')}
                                  className="ml-1 rounded bg-[#1E293B] px-1 font-mono text-[10px] text-[#8B98AD]"
                                >
                                  P
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 rounded bg-[#1E293B] px-1.5 py-px font-mono text-[10px] leading-4 text-[#8B98AD]">
                              {c.data_type}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-right text-[11px] text-[#55637A]">
                              {c.comment ?? ''}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                {tab === 'up' &&
                  (up.length === 0 ? emptyHint(t('lineage.drawer.empty.upstream')) : <div>{up.map(neighborRow)}</div>)}
                {tab === 'down' &&
                  (down.length === 0 ? emptyHint(t('lineage.drawer.empty.downstream')) : <div>{down.map(neighborRow)}</div>)}
                {tab === 'sql' &&
                  (scripts.length === 0 ? (
                    emptyHint(t('lineage.drawer.empty.sql'))
                  ) : (
                    <div>
                      {scripts.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => navigate(`/sql?script=${s.id}`)}
                          className="flex h-10 w-full items-center gap-2 rounded-md px-2 text-left transition-colors duration-120 hover:bg-[rgba(148,163,184,0.08)]"
                        >
                          <FileCode2 className="size-3.5 shrink-0 text-[#8B98AD]" />
                          <span className="min-w-0 flex-1 truncate font-mono text-xs text-[#CBD5E1]">
                            {s.name}
                          </span>
                          <span className="shrink-0 rounded bg-[#1E293B] px-1.5 py-px font-mono text-[10px] leading-4 text-[#8B98AD]">
                            v{s.version}
                          </span>
                          <StatusBadge status="parsed" hideDot />
                        </button>
                      ))}
                    </div>
                  ))}
                {tab === 'reports' &&
                  (reports.length === 0 ? (
                    emptyHint(t('lineage.drawer.empty.reports'))
                  ) : (
                    <div>
                      {reports.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => navigate('/metadata?tab=reports')}
                          className="flex h-10 w-full items-center gap-2 rounded-md px-2 text-left transition-colors duration-120 hover:bg-[rgba(148,163,184,0.08)]"
                        >
                          <span className="min-w-0 flex-1 truncate text-xs text-[#CBD5E1]">{r.name}</span>
                          <span className="flex shrink-0 items-center gap-1 text-[11px] text-[#8B98AD]">
                            <Send className="size-3" />
                            {r.target_system_name}
                          </span>
                          <Avatar name={r.owner} size={24} />
                        </button>
                      ))}
                    </div>
                  ))}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* 底部固定操作条 */}
          <motion.div
            variants={sectionItem}
            className="flex shrink-0 items-center justify-end gap-2 border-t border-[#1E293B] px-5 py-3"
          >
            <button
              type="button"
              onClick={() => navigate('/metadata?tab=tables')}
              className="h-8 rounded-md border border-[#263349] px-3 text-[13px] font-medium text-[#CBD5E1] transition-colors duration-120 hover:bg-[rgba(148,163,184,0.08)]"
            >
              {t('lineage.action.configure')}
            </button>
            <button
              type="button"
              onClick={() => navigate(`/changes?tab=create&table=${tableId}`)}
              className="h-8 rounded-md bg-primary-700 px-3 text-[13px] font-medium text-white transition-colors duration-120 hover:bg-primary-800"
            >
              {t('lineage.action.ddlChange')}
            </button>
          </motion.div>
        </motion.div>
      )}
    </motion.aside>
  )
}
