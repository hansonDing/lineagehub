/**
 * SQL 管理(/sql)— sql.md
 * 区块一:提交 SQL 脚本(深色 CodeEditor + 解析配置面板)→ POST /api/scripts/parse
 * 区块二:解析结果(汇总 chips + 血缘明细/字段映射/警告 tabs + 嵌入式 mini-DAG)
 * 区块三:脚本列表(版本徽标)+ 版本历史抽屉(PUT 更新触发新版本与 diff 视图)
 */

import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  FileCode2,
  History,
  RefreshCw,
  Search,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { GraphResponse, SqlScript, SqlScriptDetail } from '@/lib/api'
import {
  deleteScript,
  getLineageOverview,
  getScript,
  listScripts,
  listTables,
  parseScript,
  updateScript,
} from '@/lib/api'
import { formatChangeId, formatDateTime, relativeTime } from '@/lib/format'
import { Avatar } from '@/components/common/Avatar'
import { CodeEditor } from '@/components/common/CodeEditor'
import type { Column } from '@/components/common/DataTable'
import { DataTable } from '@/components/common/DataTable'
import { Modal } from '@/components/common/Modal'
import { StatusBadge } from '@/components/common/StatusBadge'
import { toast } from '@/components/common/Toast'
import { Button } from '@/components/ui/button'
import { useUser } from '@/hooks/useUser'
import type { LocalParseResult } from '@/components/sql/parsePreview'
import { isBareSelect, parseSqlLocally } from '@/components/sql/parsePreview'
import type { ParseSummary } from '@/components/sql/ParseResultPanel'
import { ParseResultPanel } from '@/components/sql/ParseResultPanel'
import { ScriptDrawer } from '@/components/sql/ScriptDrawer'

/** 首屏入场仅播放一次(sql.md §1) */
let entrancePlayed = false

const ENTRANCE = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
}

function Section({ index, className, children }: { index: number; className?: string; children: ReactNode }) {
  const shouldAnimate = !entrancePlayed
  return (
    <motion.section
      className={className}
      initial={shouldAnimate ? ENTRANCE.initial : false}
      animate={ENTRANCE.animate}
      transition={{ ...ENTRANCE.transition, delay: shouldAnimate ? index * 0.06 : 0 }}
    >
      {children}
    </motion.section>
  )
}

const PLACEHOLDER_SQL = `-- 粘贴 Spark SQL:CREATE TABLE / CTAS / INSERT OVERWRITE / SELECT
CREATE TABLE dwd.dwd_trade_order_detail AS
SELECT o.order_id, o.user_id, u.region, o.amount
FROM ods.ods_trade_order o
JOIN ods.ods_user_info u ON o.user_id = u.user_id;`

interface PanelData {
  local: LocalParseResult
  summary: ParseSummary
  elapsed: number
  failed: boolean
}

interface ScriptLineage {
  sources: Set<string>
  targets: Set<string>
  edgeCount: number
}

export default function Sql() {
  const { user } = useUser()
  const [searchParams, setSearchParams] = useSearchParams()

  // ---------- 数据 ----------
  const [scripts, setScripts] = useState<SqlScript[]>([])
  const [scriptsLoading, setScriptsLoading] = useState(true)
  const [overview, setOverview] = useState<GraphResponse | null>(null)
  const [knownTables, setKnownTables] = useState<string[]>([])

  // ---------- 编辑器 ----------
  const [name, setName] = useState('')
  const [sqlText, setSqlText] = useState('')
  const [scriptKind, setScriptKind] = useState<'auto' | 'ddl' | 'etl'>('auto')
  const [targetTable, setTargetTable] = useState('')
  const [editing, setEditing] = useState<SqlScriptDetail | null>(null)
  const [nameError, setNameError] = useState('')
  const [sqlErrorMsg, setSqlErrorMsg] = useState('')
  const [sqlFlash, setSqlFlash] = useState(false)

  // ---------- 解析 ----------
  const [parsing, setParsing] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelLoading, setPanelLoading] = useState(false)
  const [panelMode, setPanelMode] = useState<'preview' | 'submit'>('submit')
  const [panelData, setPanelData] = useState<PanelData | null>(null)

  // ---------- 列表筛选 ----------
  const [keyword, setKeyword] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'ddl' | 'etl'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'parsed' | 'parse_failed'>('all')

  // ---------- 抽屉 / 删除 ----------
  const [drawerScript, setDrawerScript] = useState<SqlScript | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [deleting, setDeleting] = useState<SqlScript | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [reparsingId, setReparsingId] = useState<number | null>(null)

  const resultRef = useRef<HTMLDivElement>(null)
  const editorWrapRef = useRef<HTMLDivElement>(null)

  // ---------- 加载 ----------
  const refreshAll = useCallback(async () => {
    const [s, g, t] = await Promise.all([listScripts(), getLineageOverview(), listTables()])
    setScripts(s)
    setOverview(g)
    setKnownTables(t.map((x) => x.name))
  }, [])

  useEffect(() => {
    entrancePlayed = false
    setScriptsLoading(true)
    refreshAll()
      .catch(() => toast.error('加载失败', '无法获取脚本列表'))
      .finally(() => setScriptsLoading(false))
  }, [refreshAll])

  // ---------- 按脚本聚合血缘(源→目标数 / 独占边数) ----------
  const lineageByScript = useMemo(() => {
    const nodeName = new Map<number, string>()
    for (const n of overview?.nodes ?? []) nodeName.set(n.id, n.name)
    const map = new Map<string, ScriptLineage>()
    for (const e of overview?.edges ?? []) {
      if (!e.script_name) continue
      const entry = map.get(e.script_name) ?? { sources: new Set<string>(), targets: new Set<string>(), edgeCount: 0 }
      const sn = nodeName.get(e.source)
      const dn = nodeName.get(e.target)
      if (sn) entry.sources.add(sn)
      if (dn) entry.targets.add(dn)
      entry.edgeCount += 1
      map.set(e.script_name, entry)
    }
    return map
  }, [overview])

  const knownEdgePairs = useMemo(() => {
    const nodeName = new Map<number, string>()
    for (const n of overview?.nodes ?? []) nodeName.set(n.id, n.name)
    const set = new Set<string>()
    for (const e of overview?.edges ?? []) {
      const sn = nodeName.get(e.source)
      const dn = nodeName.get(e.target)
      if (sn && dn) set.add(`${sn}->${dn}`)
    }
    return set
  }, [overview])

  // ---------- URL ?script=<id> 深链 ----------
  useEffect(() => {
    const id = Number(searchParams.get('script'))
    if (!id || scripts.length === 0 || drawerOpen) return
    const found = scripts.find((s) => s.id === id)
    if (found) {
      setDrawerScript(found)
      setDrawerOpen(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scripts, searchParams])

  // ---------- 裸 SELECT 判定 → 目标表输入框 ----------
  const bareSelect = scriptKind === 'etl' ? true : scriptKind === 'ddl' ? false : isBareSelect(sqlText)
  const effectiveTarget = bareSelect && targetTable.trim() ? targetTable.trim() : undefined

  // ---------- 校验(预览不校验脚本名,提交才校验) ----------
  const validateSql = (): boolean => {
    if (!sqlText.trim()) {
      setSqlErrorMsg('请先粘贴 SQL 语句')
      setSqlFlash(true)
      window.setTimeout(() => setSqlFlash(false), 300)
      return false
    }
    return true
  }

  const validate = (): boolean => {
    if (!validateSql()) return false
    if (!editing && !name.trim()) {
      setNameError('请填写脚本名称')
      return false
    }
    return true
  }

  const scrollToResult = () => {
    window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80)
  }

  // ---------- 解析预览(不落库,本地解析) ----------
  const handlePreview = () => {
    if (!validateSql()) return
    setPreviewing(true)
    setPanelMode('preview')
    setPanelOpen(true)
    setPanelLoading(true)
    scrollToResult()
    const started = performance.now()
    // 本地解析是同步的;保留短暂骨架反馈(design:结果区骨架呼吸)
    window.setTimeout(() => {
      const local = parseSqlLocally(sqlText, effectiveTarget)
      const newTables = local.targets.filter((t) => !knownTables.includes(t)).length
      let newEdges = 0
      for (const s of local.statements) {
        if (!s.target) continue
        for (const src of s.sources) {
          if (!knownEdgePairs.has(`${src}->${s.target}`)) newEdges += 1
        }
      }
      setPanelData({
        local,
        failed: local.failed,
        elapsed: performance.now() - started,
        summary: {
          targets: local.targets.length,
          sources: local.sources.length,
          tablesCreated: newTables,
          edgesCreated: newEdges,
          warnings: local.warnings.length,
        },
      })
      setPanelLoading(false)
      setPreviewing(false)
    }, 350)
  }

  // ---------- 提交解析(POST /api/scripts/parse;编辑态 PUT) ----------
  const handleSubmit = async () => {
    if (!validate()) return
    setParsing(true)
    setPanelMode('submit')
    setPanelOpen(true)
    setPanelLoading(true)
    scrollToResult()
    const started = performance.now()
    try {
      const res = editing
        ? await updateScript(editing.id, { sql_text: sqlText })
        : await parseScript({ name: name.trim(), sql_text: sqlText, target_table: effectiveTarget })
      const elapsed = performance.now() - started
      const local = parseSqlLocally(sqlText, effectiveTarget)
      const failed = res.target_tables.length === 0 && res.source_tables.length === 0
      setPanelData({
        local: { ...local, warnings: res.warnings.length > 0 ? res.warnings : local.warnings },
        failed,
        elapsed,
        summary: {
          targets: res.target_tables.length,
          sources: res.source_tables.length,
          tablesCreated: res.tables_created.length,
          edgesCreated: res.edges_created,
          warnings: res.warnings.length,
        },
      })
      // 结果反馈(sql.md §2.2 / §5)
      if (res.change_event_id) {
        toast.info(
          '血缘已变化',
          `已自动创建变更事件 ${formatChangeId(res.change_event_id)} 并通知负责人审批,请前往「变更与审批」处理`,
        )
      } else if (res.edges_created === 0 && res.tables_created.length === 0) {
        toast.info('血缘无变化', '未创建新边')
      } else {
        toast.success('解析完成', `新建表 ${res.tables_created.length} · 新建边 ${res.edges_created}`)
      }
      setEditing(null)
      await refreshAll()
    } catch (err) {
      setPanelOpen(false)
      toast.error('解析失败', err instanceof Error ? err.message : '请求失败')
    } finally {
      setPanelLoading(false)
      setParsing(false)
    }
  }

  // ---------- 编辑器快捷键:⌘Enter 提交 / Tab 缩进 ----------
  const onEditorKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void handleSubmit()
      return
    }
    if (e.key === 'Tab' && (e.target as HTMLElement).tagName === 'TEXTAREA') {
      e.preventDefault()
      const ta = e.target as HTMLTextAreaElement
      const s = ta.selectionStart
      const next = `${ta.value.slice(0, s)}  ${ta.value.slice(ta.selectionEnd)}`
      setSqlText(next)
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = s + 2
      })
    }
  }

  // ---------- 编辑并重新解析(抽屉) ----------
  const handleEdit = (detail: SqlScriptDetail) => {
    setEditing(detail)
    setName(detail.name)
    setSqlText(detail.sql_text)
    setTargetTable(detail.target_table ?? '')
    setDrawerOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cancelEditing = () => {
    setEditing(null)
    setName('')
    setSqlText('')
    setTargetTable('')
  }

  // ---------- 重新解析(行操作,PUT 同文触发重解析) ----------
  const handleReparse = async (script: SqlScript) => {
    setReparsingId(script.id)
    try {
      const detail = await getScript(script.id)
      const res = await updateScript(script.id, { sql_text: detail.sql_text })
      if (res.change_event_id) {
        toast.info('血缘已变化', `已自动创建变更事件 ${formatChangeId(res.change_event_id)} 并通知负责人审批`)
      } else if (res.edges_created === 0) {
        toast.info('血缘无变化', '未创建新边')
      } else {
        toast.success('解析完成', `新建边 ${res.edges_created}`)
      }
      await refreshAll()
    } catch (err) {
      toast.error('重新解析失败', err instanceof Error ? err.message : '请求失败')
    } finally {
      setReparsingId(null)
    }
  }

  // ---------- 删除 ----------
  const handleDelete = async () => {
    if (!deleting) return
    setDeleteLoading(true)
    try {
      await deleteScript(deleting.id)
      toast.success('脚本已删除', deleting.name)
      setDeleting(null)
      if (drawerScript?.id === deleting.id) setDrawerOpen(false)
      await refreshAll()
    } catch (err) {
      toast.error('删除失败', err instanceof Error ? err.message : '请求失败')
    } finally {
      setDeleteLoading(false)
    }
  }

  // ---------- 抽屉 ----------
  const openDrawer = (script: SqlScript) => {
    setDrawerScript(script)
    setDrawerOpen(true)
    setSearchParams({ script: String(script.id) }, { replace: true })
  }
  const closeDrawer = () => {
    setDrawerOpen(false)
    setSearchParams({}, { replace: true })
  }

  // ---------- 列表 ----------
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return scripts
      .filter((s) => (kw ? s.name.toLowerCase().includes(kw) : true))
      .filter((s) => (typeFilter === 'all' ? true : s.sql_type === typeFilter))
      .filter(() => (statusFilter === 'parse_failed' ? false : true))
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
  }, [scripts, keyword, typeFilter, statusFilter])

  const columns: Column<SqlScript & Record<string, unknown>>[] = [
    {
      key: 'name',
      title: '脚本',
      render: (row) => (
        <span className="flex items-center gap-2">
          <FileCode2 className="size-3.5 shrink-0 text-slate-500" />
          <span className="font-mono text-[13px] text-slate-900">{row.name}</span>
        </span>
      ),
    },
    {
      key: 'sql_type',
      title: '类型',
      width: 72,
      render: (row) => (
        <span
          className={cn(
            'rounded px-1.5 py-px font-mono text-[11px] font-medium',
            row.sql_type === 'ddl' ? 'bg-slate-100 text-slate-600' : 'bg-primary-50 text-primary-700',
          )}
        >
          {row.sql_type === 'ddl' ? 'DDL' : 'ETL'}
        </span>
      ),
    },
    {
      key: 'lineage',
      title: '血缘',
      render: (row) => {
        const lin = lineageByScript.get(row.name)
        const target = row.target_table ?? lin?.targets.values().next().value
        return (
          <span className="flex items-center gap-2">
            <span className="font-mono text-xs text-slate-700">
              {lin ? `${lin.sources.size} → ${lin.targets.size}` : '0 → 0'}
            </span>
            {target && (
              <Link
                to={`/lineage?table=${encodeURIComponent(target)}`}
                onClick={(e) => e.stopPropagation()}
                className="text-xs text-primary-600 hover:underline underline-offset-4"
              >
                查看图
              </Link>
            )}
          </span>
        )
      },
    },
    {
      key: 'status',
      title: '状态',
      width: 96,
      render: () => <StatusBadge status="parsed" />,
    },
    {
      key: 'version',
      title: '版本',
      width: 84,
      render: (row) => (
        <span className="flex items-center gap-1">
          {row.version > 1 && <History className="size-3 text-slate-400" />}
          <span className="rounded bg-slate-100 px-1.5 py-px font-mono text-[11px] font-medium text-slate-600">
            v{row.version}
          </span>
        </span>
      ),
    },
    {
      key: 'owner',
      title: '提交人',
      render: () => (
        <span className="flex items-center gap-1.5">
          <Avatar name={user} size={24} />
          <span>{user}</span>
        </span>
      ),
    },
    {
      key: 'updated_at',
      title: '更新时间',
      render: (row) => (
        <span className="text-xs text-slate-500" title={formatDateTime(row.updated_at)}>
          {relativeTime(row.updated_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      width: 108,
      align: 'right',
      render: (row) => (
        <span className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon-sm" aria-label="版本历史" onClick={() => openDrawer(row)}>
            <History className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="重新解析"
            loading={reparsingId === row.id}
            onClick={() => void handleReparse(row)}
          >
            <RefreshCw className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="删除" onClick={() => setDeleting(row)}>
            <Trash2 className="size-3.5" />
          </Button>
        </span>
      ),
    },
  ]

  const hasFilter = keyword.trim() !== '' || typeFilter !== 'all' || statusFilter !== 'all'

  return (
    <div className="space-y-4">
      {/* ============ 区块一:提交 SQL 脚本 ============ */}
      <Section index={0}>
        <div className="grid grid-cols-12 gap-4">
          {/* 左:代码编辑器卡 */}
          <div className="col-span-12 xl:col-span-8">
            <div ref={editorWrapRef} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-card">
              <div className="flex h-12 items-center justify-between gap-3 border-b border-slate-100 px-4">
                <input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    setNameError('')
                  }}
                  placeholder="如 etl_dwd_trade_order_detail"
                  disabled={!!editing}
                  className="min-w-0 flex-1 border-b-2 border-transparent bg-transparent text-[15px] font-medium text-slate-900 outline-none transition-colors placeholder:font-normal placeholder:text-slate-400 focus:border-primary-600 disabled:text-slate-500"
                />
                {editing && (
                  <span className="flex shrink-0 items-center gap-1 rounded bg-pending-light px-1.5 py-0.5 text-[11px] font-medium text-pending">
                    编辑中 · v{editing.version} → v{editing.version + 1}
                    <button type="button" onClick={cancelEditing} aria-label="取消编辑" className="hover:text-slate-900">
                      <X className="size-3" />
                    </button>
                  </span>
                )}
                <span className="flex shrink-0 items-center gap-1 font-mono text-xs text-slate-400">
                  <Zap className="size-3" />
                  Spark SQL
                </span>
              </div>
              {nameError && <p className="border-b border-slate-100 px-4 py-1.5 text-xs text-danger">{nameError}</p>}
              <div
                onKeyDown={onEditorKeyDown}
                className={cn('transition-shadow duration-300', sqlFlash && 'ring-2 ring-inset ring-danger')}
              >
                <CodeEditor
                  value={sqlText}
                  onChange={(v) => {
                    setSqlText(v)
                    setSqlErrorMsg('')
                  }}
                  placeholder={PLACEHOLDER_SQL}
                  minHeight={360}
                  className="rounded-none border-0"
                />
              </div>
              {sqlErrorMsg && <p className="px-4 py-1.5 text-xs text-danger">{sqlErrorMsg}</p>}
            </div>
          </div>

          {/* 右:解析配置卡 */}
          <div className="col-span-12 xl:col-span-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-card">
              <h3 className="text-[15px] font-semibold text-slate-900">解析配置</h3>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="mb-1.5 block text-[13px] font-medium text-slate-700">方言</label>
                  <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
                    spark
                  </span>
                  <p className="mt-1 text-xs text-slate-500">由 sqlglot 解析引擎处理</p>
                </div>
                <div>
                  <label className="mb-1.5 block text-[13px] font-medium text-slate-700">脚本类型</label>
                  <select
                    value={scriptKind}
                    onChange={(e) => setScriptKind(e.target.value as 'auto' | 'ddl' | 'etl')}
                    className="h-8 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[13px] text-slate-900 outline-none transition-colors focus:border-primary-600 focus:ring-2 focus:ring-[rgba(13,148,136,0.30)]"
                  >
                    <option value="auto">自动判别(推荐)</option>
                    <option value="ddl">DDL 建表</option>
                    <option value="etl">ETL 查询</option>
                  </select>
                  <p className="mt-1 text-xs text-slate-500">CREATE 开头识别为 DDL,SELECT/INSERT 识别为 ETL</p>
                </div>
                {bareSelect && (
                  <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-slate-700">目标表名</label>
                    <input
                      value={targetTable}
                      onChange={(e) => setTargetTable(e.target.value)}
                      placeholder="dwd.dwd_xxx"
                      className="h-8 w-full rounded-md border border-slate-300 bg-white px-2.5 font-mono text-[13px] text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-primary-600 focus:ring-2 focus:ring-[rgba(13,148,136,0.30)]"
                    />
                    <p className="mt-1 text-xs text-slate-500">SELECT 语句需指定写入的目标表</p>
                  </div>
                )}
                <div>
                  <label className="mb-1.5 block text-[13px] font-medium text-slate-700">提交人</label>
                  <span className="flex items-center gap-1.5 text-[13px] text-slate-900">
                    <Avatar name={user} size={24} />
                    {user}
                  </span>
                </div>
                <div className="rounded-md bg-info-light p-2.5 text-xs leading-5 text-slate-600">
                  支持:CREATE TABLE / CTAS / CREATE VIEW / INSERT OVERWRITE|INTO / ALTER TABLE /
                  裸 SELECT(含 CTE、JOIN、UNION)。单条语句解析失败不会中断整体解析,将记入警告。
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                  <Button variant="secondary" onClick={handlePreview} loading={previewing} disabled={parsing}>
                    解析预览
                  </Button>
                  <Button onClick={() => void handleSubmit()} loading={parsing} disabled={previewing}>
                    <Zap className="size-3.5" />
                    {parsing ? '解析中…' : editing ? '保存新版本' : '提交解析'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ============ 区块二:解析结果(默认折叠) ============ */}
      <div ref={resultRef}>
        <AnimatePresence>
          {panelOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
              className="overflow-hidden"
            >
              <Section index={1} className="pb-0.5">
                <ParseResultPanel
                  loading={panelLoading}
                  mode={panelMode}
                  failed={panelData?.failed ?? false}
                  local={panelData?.local ?? null}
                  summary={panelData?.summary ?? null}
                  elapsedMs={panelData?.elapsed ?? null}
                />
              </Section>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ============ 区块三:脚本列表 ============ */}
      <Section index={2}>
        <div className="rounded-lg border border-slate-200 bg-white shadow-card">
          <div className="flex h-12 flex-wrap items-center gap-2 border-b border-slate-200 px-4">
            <h2 className="text-[15px] font-semibold text-slate-900">SQL 脚本</h2>
            <span className="rounded bg-slate-100 px-1 text-[11px] leading-4 text-slate-500">{scripts.length}</span>
            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="搜索脚本名…"
                  className="h-8 w-52 rounded-md border border-slate-300 bg-white pl-8 pr-2.5 text-[13px] outline-none transition-colors placeholder:text-slate-400 focus:border-primary-600 focus:ring-2 focus:ring-[rgba(13,148,136,0.30)]"
                />
              </div>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as 'all' | 'ddl' | 'etl')}
                className="h-8 rounded-md border border-slate-300 bg-white px-2 text-[13px] text-slate-700 outline-none focus:border-primary-600"
              >
                <option value="all">全部类型</option>
                <option value="ddl">DDL</option>
                <option value="etl">ETL</option>
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | 'parsed' | 'parse_failed')}
                className="h-8 rounded-md border border-slate-300 bg-white px-2 text-[13px] text-slate-700 outline-none focus:border-primary-600"
              >
                <option value="all">全部状态</option>
                <option value="parsed">已解析</option>
                <option value="parse_failed">解析失败</option>
              </select>
            </div>
          </div>
          <DataTable
            columns={columns}
            data={filtered as (SqlScript & Record<string, unknown>)[]}
            rowKey={(row) => row.id}
            loading={scriptsLoading}
            onRowClick={(row) => openDrawer(row)}
            emptyImage="/empty-table.svg"
            emptyTitle={scripts.length === 0 && !hasFilter ? '还没有 SQL 脚本' : '未找到匹配的脚本'}
            emptyDescription={
              scripts.length === 0 && !hasFilter
                ? '提交 DDL 与 ETL 语句,自动构建血缘'
                : '换个关键词,或检查筛选条件'
            }
            footer={
              hasFilter && filtered.length !== scripts.length
                ? `筛选出 ${filtered.length} 条 / 共 ${scripts.length} 条`
                : `共 ${filtered.length} 条`
            }
            className="rounded-none border-0 shadow-none"
          />
        </div>
      </Section>

      {/* 详情抽屉 */}
      <ScriptDrawer
        script={drawerScript}
        open={drawerOpen}
        onClose={closeDrawer}
        onEdit={handleEdit}
        onDelete={(s) => setDeleting(s)}
        lineage={
          drawerScript
            ? {
                sources: lineageByScript.get(drawerScript.name)?.sources.size ?? 0,
                targets: lineageByScript.get(drawerScript.name)?.targets.size ?? 0,
              }
            : undefined
        }
      />

      {/* 删除确认模态(非名称二次确认,仅系统/报表需要) */}
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        danger
        title="删除脚本"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button variant="danger" onClick={() => void handleDelete()} loading={deleteLoading}>
              确认删除
            </Button>
          </>
        }
      >
        {deleting && (
          <p className="text-[13px] leading-6 text-slate-700">
            确认删除脚本 <span className="font-mono font-medium text-slate-900">{deleting.name}</span>?
            删除将同时移除该脚本独占的{' '}
            <span className="font-mono font-medium text-danger">
              {lineageByScript.get(deleting.name)?.edgeCount ?? 0}
            </span>{' '}
            条血缘边,该操作不可撤销。
          </p>
        )}
      </Modal>
    </div>
  )
}
