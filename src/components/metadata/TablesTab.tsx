/**
 * 数仓表标签页(metadata.md §3)
 * 分层筛选 chips + 来源系统筛选 + 搜索;行可展开(字段列表 + mini 血缘);
 * 配置抽屉(来源系统 / 负责人 / 描述 → PUT /api/tables/{id});未配置来源 >20% 琥珀引导条
 */

import type { ReactNode } from 'react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  ChevronRight,
  Network,
  Pencil,
  Send,
  Server,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { GraphResponse, SqlScript, System, TableDetail, TableLayer, TableListItem } from '@/lib/api'
import { getTable, updateTable } from '@/lib/api'
import { LAYER_COLORS, formatDateTime, relativeTime } from '@/lib/format'
import { Avatar } from '@/components/common/Avatar'
import { Drawer } from '@/components/common/Drawer'
import { EmptyState } from '@/components/common/EmptyState'
import { LayerBadge } from '@/components/common/LayerBadge'
import { toast } from '@/components/common/Toast'
import { Button } from '@/components/ui/button'
import { FieldError, FieldLabel, SearchInput, SelectInput, TextArea, TextInput } from './controls'

const LAYERS: TableLayer[] = ['ods', 'dim', 'dwd', 'dws', 'ads']
const EXPAND_VISIBLE_ROWS = 8

export interface TablesDeepLink {
  layer?: TableLayer
  keyword?: string
  systemId?: number | 'none'
}

export interface TablesTabProps {
  tables: TableListItem[]
  systems: System[]
  scripts: SqlScript[]
  overview: GraphResponse | null
  loading: boolean
  onRefresh: () => void
  deepLink: TablesDeepLink | null
  deepLinkNonce: number
}

/** 分区字段判定(种子 DDL 约定:dt 或注释含「分区」) */
function isPartitionColumn(name: string, comment: string | null): boolean {
  return name === 'dt' || /分区/.test(comment ?? '')
}

export function TablesTab({
  tables,
  systems,
  scripts,
  overview,
  loading,
  onRefresh,
  deepLink,
  deepLinkNonce,
}: TablesTabProps) {
  const [layer, setLayer] = useState<'all' | TableLayer>('all')
  const [systemFilter, setSystemFilter] = useState<'all' | 'none' | number>('all')
  const [keyword, setKeyword] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [details, setDetails] = useState<Map<number, TableDetail>>(new Map())
  const [detailLoading, setDetailLoading] = useState<Set<number>>(new Set())
  const [configTarget, setConfigTarget] = useState<TableListItem | null>(null)
  const [flashId, setFlashId] = useState<number | null>(null)
  const flashTimer = useRef<number | undefined>(undefined)

  // 深链(?layer= / ?keyword= / 系统 Tab 跳转)
  useEffect(() => {
    if (!deepLink) return
    if (deepLink.layer !== undefined) setLayer(deepLink.layer)
    if (deepLink.keyword !== undefined) setKeyword(deepLink.keyword)
    if (deepLink.systemId !== undefined) setSystemFilter(deepLink.systemId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkNonce])

  // ---------- 血缘聚合 ----------
  const nodeName = useMemo(() => {
    const map = new Map<number, string>()
    for (const n of overview?.nodes ?? []) map.set(n.id, n.name)
    return map
  }, [overview])

  const { upstreamOf, downstreamOf } = useMemo(() => {
    const up = new Map<number, Set<number>>()
    const down = new Map<number, Set<number>>()
    for (const e of overview?.edges ?? []) {
      if (!up.has(e.target)) up.set(e.target, new Set())
      up.get(e.target)?.add(e.source)
      if (!down.has(e.source)) down.set(e.source, new Set())
      down.get(e.source)?.add(e.target)
    }
    return { upstreamOf: up, downstreamOf: down }
  }, [overview])

  // ---------- 注册来源(由血缘边回查创建脚本) ----------
  const registerSource = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of overview?.edges ?? []) {
      const target = nodeName.get(e.target)
      if (!target || !e.script_name || map.has(target)) continue
      const script = scripts.find((s) => s.name === e.script_name)
      map.set(
        target,
        script ? `脚本 ${script.name} · ${script.created_at.slice(0, 10)}` : `脚本 ${e.script_name}`,
      )
    }
    return map
  }, [overview, nodeName, scripts])

  // ---------- 筛选 ----------
  const layerCounts = useMemo(() => {
    const counts = new Map<TableLayer, number>()
    for (const t of tables) counts.set(t.layer, (counts.get(t.layer) ?? 0) + 1)
    return counts
  }, [tables])

  const unconfigured = useMemo(() => tables.filter((t) => t.source_system_id === null), [tables])
  const showGuide = tables.length > 0 && unconfigured.length / tables.length > 0.2

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return tables
      .filter((t) => (layer === 'all' ? true : t.layer === layer))
      .filter((t) => {
        if (systemFilter === 'all') return true
        if (systemFilter === 'none') return t.source_system_id === null
        return t.source_system_id === systemFilter
      })
      .filter((t) => (kw ? t.name.toLowerCase().includes(kw) : true))
  }, [tables, layer, systemFilter, keyword])

  const hasFilter = layer !== 'all' || systemFilter !== 'all' || keyword.trim() !== ''

  // ---------- 行展开 ----------
  const toggleExpand = async (table: TableListItem) => {
    const next = new Set(expanded)
    if (next.has(table.id)) {
      next.delete(table.id)
      setExpanded(next)
      return
    }
    next.add(table.id)
    setExpanded(next)
    if (!details.has(table.id)) {
      setDetailLoading((prev) => new Set(prev).add(table.id))
      try {
        const detail = await getTable(table.id)
        setDetails((prev) => new Map(prev).set(table.id, detail))
      } catch {
        toast.error('加载失败', `无法获取 ${table.name} 的字段列表`)
      } finally {
        setDetailLoading((prev) => {
          const s = new Set(prev)
          s.delete(table.id)
          return s
        })
      }
    }
  }

  const handleSaved = (tableId: number) => {
    setConfigTarget(null)
    onRefresh()
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlashId(null), 600)
    setFlashId(tableId)
  }

  // ---------- 分层 chips ----------
  const chips: { key: 'all' | TableLayer; label: string; color: string; count: number }[] = [
    { key: 'all', label: '全部', color: '#64748B', count: tables.length },
    ...LAYERS.map((l) => ({
      key: l as 'all' | TableLayer,
      label: l.toUpperCase(),
      color: LAYER_COLORS[l],
      count: layerCounts.get(l) ?? 0,
    })),
  ]

  return (
    <div>
      {/* 工具条 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          {chips.map((chip) => {
            const active = layer === chip.key
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => setLayer(chip.key)}
                style={
                  active
                    ? { backgroundColor: `${chip.color}1F`, color: chip.color, borderColor: 'transparent' }
                    : undefined
                }
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors duration-150',
                  active ? '' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
                )}
              >
                <span className="size-1.5 rounded-full" style={{ backgroundColor: chip.color }} />
                {chip.label}
                <span className="font-mono">{chip.count}</span>
              </button>
            )
          })}
        </div>
        <SelectInput
          value={String(systemFilter)}
          onChange={(e) => setSystemFilter(e.target.value === 'all' || e.target.value === 'none' ? e.target.value : Number(e.target.value))}
          className="w-36"
        >
          <option value="all">全部来源</option>
          {systems.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          <option value="none">未配置</option>
        </SelectInput>
        <div className="ml-auto flex items-center gap-2">
          <SearchInput value={keyword} onChange={setKeyword} placeholder="搜索表名…" className="w-52" />
          <span className="hidden text-xs text-slate-400 2xl:inline">表由 SQL 解析自动注册,本页配置归属</span>
        </div>
      </div>

      {/* 未配置来源引导条(>20%) */}
      {showGuide && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-pending/20 bg-pending-light px-3 py-2">
          <AlertTriangle className="size-3.5 shrink-0 text-pending" />
          <span className="text-xs text-slate-700">
            <span className="font-mono font-medium text-pending">{unconfigured.length}</span>{' '}
            张表未配置来源系统,变更时将无法通知上游负责人
          </span>
          <button
            type="button"
            onClick={() => setSystemFilter('none')}
            className="ml-auto text-xs font-medium text-primary-600 hover:underline underline-offset-4"
          >
            一键筛选未配置
          </button>
        </div>
      )}

      {/* 表格(行可展开) */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-card">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="h-9 border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
              <th className="w-10 px-3" aria-label="展开" />
              <th className="px-3">表名</th>
              <th className="w-40 px-3">来源系统</th>
              <th className="w-36 px-3">负责人</th>
              <th className="w-16 px-3">字段</th>
              <th className="w-24 px-3">上游 / 下游</th>
              <th className="w-24 px-3">更新时间</th>
              <th className="w-24 px-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="h-11 border-b border-slate-100">
                  {Array.from({ length: 8 }).map((__, j) => (
                    <td key={j} className="px-3">
                      <div className="h-3.5 animate-pulse-soft rounded bg-slate-100" style={{ width: `${70 - i * 12}%` }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <EmptyState
                    image="/empty-table.svg"
                    title={hasFilter ? '未找到匹配的表' : '还没有数仓表'}
                    description={hasFilter ? '换个关键词,或检查筛选条件' : '提交 SQL 脚本后,解析引擎将自动注册表'}
                    className="min-h-60"
                  />
                </td>
              </tr>
            ) : (
              filtered.map((table) => {
                const isOpen = expanded.has(table.id)
                const upSet = upstreamOf.get(table.id)
                const downSet = downstreamOf.get(table.id)
                return (
                  <Fragment key={table.id}>
                    <tr
                      onClick={() => void toggleExpand(table)}
                      className="h-11 cursor-pointer border-b border-slate-100 text-[13px] text-slate-900 transition-colors duration-120 hover:bg-slate-50"
                    >
                      <td className="px-3">
                        <ChevronRight
                          className={cn('size-3.5 text-slate-400 transition-transform duration-150', isOpen && 'rotate-90')}
                        />
                      </td>
                      <td className="px-3">
                        <span className="flex items-center gap-2">
                          <LayerBadge layer={table.layer} />
                          <span className="font-mono text-[13px]">{table.name}</span>
                        </span>
                      </td>
                      <td
                        className={cn('px-3 transition-colors duration-500', flashId === table.id && 'bg-primary-50')}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {table.source_system_name ? (
                          <span className="text-[13px]">{table.source_system_name}</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfigTarget(table)}
                            className="text-[13px] font-medium text-pending hover:underline underline-offset-4"
                          >
                            + 配置来源
                          </button>
                        )}
                      </td>
                      <td className="px-3">
                        {table.owner ? (
                          <span className="flex items-center gap-1.5">
                            <Avatar name={table.owner} size={24} />
                            <span>{table.owner}</span>
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 font-mono text-[13px]">{table.column_count}</td>
                      <td className="px-3" onClick={(e) => e.stopPropagation()}>
                        <span className="font-mono text-xs text-slate-700">
                          {upSet?.size ?? 0} /{' '}
                          {(downSet?.size ?? 0) > 0 ? (
                            <Link
                              to={`/lineage?table=${encodeURIComponent(table.name)}`}
                              className="text-primary-600 hover:underline underline-offset-4"
                            >
                              {downSet?.size ?? 0}
                            </Link>
                          ) : (
                            '0'
                          )}
                        </span>
                      </td>
                      <td className="px-3">
                        <span className="text-xs text-slate-500" title={formatDateTime(table.updated_at)}>
                          {relativeTime(table.updated_at)}
                        </span>
                      </td>
                      <td className="px-3" onClick={(e) => e.stopPropagation()}>
                        <span className="flex items-center justify-end gap-0.5">
                          <Button variant="ghost" size="icon-sm" aria-label="配置" onClick={() => setConfigTarget(table)}>
                            <Pencil className="size-3.5" />
                          </Button>
                          <Link
                            to={`/lineage?table=${encodeURIComponent(table.name)}`}
                            aria-label="查看血缘"
                            className="inline-flex size-7 items-center justify-center rounded-[6px] text-slate-500 transition-colors duration-120 hover:bg-slate-100 hover:text-slate-900"
                          >
                            <Network className="size-3.5" />
                          </Link>
                        </span>
                      </td>
                    </tr>
                    <AnimatePresence>
                      {isOpen && (
                        <tr key={`${table.id}-expand`} className="border-b border-slate-100">
                          <td colSpan={8} className="bg-slate-50 p-0">
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.22 }}
                              className="overflow-hidden"
                            >
                              <ExpandedContent
                                table={table}
                                detail={details.get(table.id)}
                                detailLoading={detailLoading.has(table.id)}
                                upstreamNames={Array.from(upSet ?? []).map((id) => nodeName.get(id) ?? '')}
                                downstreamNames={Array.from(downSet ?? []).map((id) => nodeName.get(id) ?? '')}
                              />
                            </motion.div>
                          </td>
                        </tr>
                      )}
                    </AnimatePresence>
                  </Fragment>
                )
              })
            )}
          </tbody>
        </table>
        <div className="flex h-10 items-center justify-end border-t border-slate-200 px-3 text-xs text-slate-500">
          {hasFilter && filtered.length !== tables.length
            ? `筛选出 ${filtered.length} 条 / 共 ${tables.length} 条`
            : `共 ${filtered.length} 条`}
        </div>
      </div>

      {/* 配置抽屉 */}
      <TableConfigDrawer
        table={configTarget}
        systems={systems}
        registerInfo={configTarget ? registerSource.get(configTarget.name) : undefined}
        fieldCount={configTarget?.column_count ?? 0}
        upstreamCount={configTarget ? upstreamOf.get(configTarget.id)?.size ?? 0 : 0}
        downstreamCount={configTarget ? downstreamOf.get(configTarget.id)?.size ?? 0 : 0}
        onClose={() => setConfigTarget(null)}
        onSaved={handleSaved}
      />
    </div>
  )
}

// ---------- 行展开内容:字段列表 + 血缘速览 ----------

function ExpandedContent({
  table,
  detail,
  detailLoading,
  upstreamNames,
  downstreamNames,
}: {
  table: TableListItem
  detail?: TableDetail
  detailLoading: boolean
  upstreamNames: string[]
  downstreamNames: string[]
}) {
  const columns = detail?.columns ?? []
  return (
    <div className="grid grid-cols-12 gap-6 px-6 py-4">
      {/* 左 7 列:字段列表 */}
      <div className="col-span-12 xl:col-span-7">
        <p className="mb-2 text-xs font-medium text-slate-500">字段列表</p>
        {detailLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-3.5 animate-pulse-soft rounded bg-slate-200/70" style={{ width: `${80 - i * 10}%` }} />
            ))}
          </div>
        ) : columns.length === 0 ? (
          <p className="text-xs text-slate-400">暂无字段信息</p>
        ) : (
          <div style={{ maxHeight: EXPAND_VISIBLE_ROWS * 28 }} className="overflow-y-auto">
            <table className="w-full">
              <thead>
                <tr className="h-7 text-left text-[11px] font-medium text-slate-400">
                  <th className="w-2/5 pr-3">字段名</th>
                  <th className="w-1/4 pr-3">类型</th>
                  <th>注释</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((col) => (
                  <tr key={col.id} className="h-7">
                    <td className="pr-3">
                      <span className="flex items-center gap-1.5 font-mono text-xs text-slate-900">
                        {col.name}
                        {isPartitionColumn(col.name, col.comment) && (
                          <span
                            title="分区字段"
                            className="rounded bg-slate-200/80 px-1 font-mono text-[10px] font-medium text-slate-500"
                          >
                            P
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="pr-3">
                      <span className="rounded bg-slate-200/60 px-1 py-px font-mono text-[10px] uppercase text-slate-500">
                        {col.data_type || '—'}
                      </span>
                    </td>
                    <td className="truncate text-xs text-slate-500">{col.comment ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 右 5 列:血缘速览 */}
      <div className="col-span-12 xl:col-span-5">
        <p className="mb-2 text-xs font-medium text-slate-500">血缘速览</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <TableChips names={upstreamNames} />
          <ArrowRight className="size-3 shrink-0 text-slate-400" />
          <span className="rounded border border-primary-100 bg-primary-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-primary-700">
            {table.name}
          </span>
          <ArrowRight className="size-3 shrink-0 text-slate-400" />
          <TableChips names={downstreamNames} />
        </div>
        <Link
          to={`/lineage?table=${encodeURIComponent(table.name)}`}
          className="mt-3 inline-block text-xs text-primary-600 hover:underline underline-offset-4"
        >
          完整血缘 →
        </Link>
      </div>
    </div>
  )
}

function TableChips({ names }: { names: string[] }) {
  const valid = names.filter(Boolean)
  if (valid.length === 0) return <span className="text-xs text-slate-400">—</span>
  const shown = valid.slice(0, 3)
  const rest = valid.length - shown.length
  return (
    <>
      {shown.map((n) => (
        <span key={n} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
          {n}
        </span>
      ))}
      {rest > 0 && <span className="font-mono text-[11px] text-slate-400">+{rest}</span>}
    </>
  )
}

// ---------- 配置抽屉 ----------

const KIND_ICON: Record<string, ReactNode> = {
  source: <Server className="size-3.5 text-slate-400" />,
  target: <Send className="size-3.5 text-slate-400" />,
  both: <ArrowLeftRight className="size-3.5 text-slate-400" />,
}

function TableConfigDrawer({
  table,
  systems,
  registerInfo,
  fieldCount,
  upstreamCount,
  downstreamCount,
  onClose,
  onSaved,
}: {
  table: TableListItem | null
  systems: System[]
  registerInfo?: string
  fieldCount: number
  upstreamCount: number
  downstreamCount: number
  onClose: () => void
  onSaved: (tableId: number) => void
}) {
  const [sourceSystemId, setSourceSystemId] = useState<'none' | number>('none')
  const [owner, setOwner] = useState('')
  const [description, setDescription] = useState('')
  const [ownerError, setOwnerError] = useState('')
  const [saving, setSaving] = useState(false)
  const [sysDropdownOpen, setSysDropdownOpen] = useState(false)

  useEffect(() => {
    if (!table) return
    setSourceSystemId(table.source_system_id ?? 'none')
    setOwner(table.owner ?? '')
    setDescription(table.description ?? '')
    setOwnerError('')
    setSysDropdownOpen(false)
  }, [table])

  const selectedSystem = systems.find((s) => s.id === sourceSystemId)

  const handleSave = async () => {
    if (!table) return
    if (!owner.trim()) {
      setOwnerError('请填写负责人')
      return
    }
    setSaving(true)
    try {
      await updateTable(table.id, {
        source_system_id: sourceSystemId === 'none' ? null : sourceSystemId,
        owner: owner.trim(),
        description: description.trim(),
      })
      toast.success('配置已保存', table.name)
      onSaved(table.id)
    } catch (err) {
      toast.error('保存失败', err instanceof Error ? err.message : '请刷新后重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open={!!table}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          {table && <LayerBadge layer={table.layer} />}
          <span className="font-mono">{table?.name ?? ''}</span>
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void handleSave()} loading={saving}>
            {saving ? '保存中…' : '保存配置'}
          </Button>
        </>
      }
    >
      {table && (
        <div className="space-y-4">
          <div>
            <FieldLabel>来源系统</FieldLabel>
            <div className="relative">
              <button
                type="button"
                onClick={() => setSysDropdownOpen((v) => !v)}
                className="flex h-8 w-full items-center gap-2 rounded-md border border-slate-300 bg-white px-2.5 text-left text-[13px] text-slate-900 outline-none transition-colors focus:border-primary-600 focus:ring-2 focus:ring-[rgba(13,148,136,0.30)]"
              >
                {selectedSystem ? (
                  <>
                    {KIND_ICON[selectedSystem.kind]}
                    {selectedSystem.name}
                  </>
                ) : (
                  <span className="text-slate-500">数仓内部加工(无来源)</span>
                )}
                <ChevronRight className={cn('ml-auto size-3.5 rotate-90 text-slate-400 transition-transform', sysDropdownOpen && '-rotate-90')} />
              </button>
              {sysDropdownOpen && (
                <>
                  <button
                    type="button"
                    aria-label="关闭"
                    className="fixed inset-0 z-10 cursor-default"
                    onClick={() => setSysDropdownOpen(false)}
                  />
                  <div className="absolute inset-x-0 top-9 z-20 max-h-56 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-overlay">
                    <button
                      type="button"
                      onClick={() => {
                        setSourceSystemId('none')
                        setSysDropdownOpen(false)
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-slate-50',
                        sourceSystemId === 'none' ? 'text-primary-700' : 'text-slate-500',
                      )}
                    >
                      数仓内部加工(无来源)
                    </button>
                    {systems.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setSourceSystemId(s.id)
                          setSysDropdownOpen(false)
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-slate-50',
                          sourceSystemId === s.id ? 'text-primary-700' : 'text-slate-900',
                        )}
                      >
                        {KIND_ICON[s.kind]}
                        {s.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div>
            <FieldLabel required>负责人</FieldLabel>
            <TextInput
              value={owner}
              onChange={(e) => {
                setOwner(e.target.value)
                setOwnerError('')
              }}
              placeholder="张三"
              error={!!ownerError}
            />
            <FieldError>{ownerError}</FieldError>
          </div>

          <div>
            <FieldLabel>描述</FieldLabel>
            <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>

          {/* 只读信息区 */}
          <div className="space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <div className="flex justify-between">
              <span>注册来源</span>
              <span className="font-mono text-slate-700">{registerInfo ?? 'SQL 解析自动注册'}</span>
            </div>
            <div className="flex justify-between">
              <span>字段数</span>
              <span className="font-mono text-slate-700">{fieldCount}</span>
            </div>
            <div className="flex justify-between">
              <span>上游 / 下游</span>
              <span className="font-mono text-slate-700">
                {upstreamCount} / {downstreamCount}
              </span>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  )
}
