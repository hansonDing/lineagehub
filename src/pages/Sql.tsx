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
  FolderInput,
  History,
  RefreshCw,
  Search,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { BatchImportResponse, GraphResponse, SqlScript, SqlScriptDetail } from '@/lib/api'
import {
  ApiError,
  batchImport,
  deleteScript,
  getLineageOverview,
  getScript,
  listScripts,
  listTables,
  parseScript,
  updateScript,
} from '@/lib/api'
import { formatChangeId, formatDateTime, relativeTime } from '@/lib/format'
import { useT } from '@/lib/i18n'
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

/** 批量导入汇总 chip(结果视图顶部统计) */
function ImportSummaryChip({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'slate' | 'success' | 'warning' | 'danger' | 'primary'
}) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    success: 'bg-success-light text-success',
    warning: 'bg-sqlwarn-light text-sqlwarn',
    danger: 'bg-danger-light text-danger',
    primary: 'bg-primary-50 text-primary-700',
  } as const
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded px-2 text-xs', tones[tone])}>
      {label}
      <span className="font-mono font-semibold tabular-nums">{value}</span>
    </span>
  )
}

export default function Sql() {
  const { t } = useT()
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

  // ---------- 批量导入 ----------
  const [importOpen, setImportOpen] = useState(false)
  const [importDir, setImportDir] = useState('')
  const [importRecursive, setImportRecursive] = useState(true)
  const [importLoading, setImportLoading] = useState(false)
  const [importError, setImportError] = useState('')
  const [importResult, setImportResult] = useState<BatchImportResponse | null>(null)

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
      .catch(() => toast.error(t('sql.toast.loadFailed'), t('sql.toast.loadFailedDesc')))
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
      setSqlErrorMsg(t('sql.config.sqlRequired'))
      setSqlFlash(true)
      window.setTimeout(() => setSqlFlash(false), 300)
      return false
    }
    return true
  }

  const validate = (): boolean => {
    if (!validateSql()) return false
    if (!editing && !name.trim()) {
      setNameError(t('sql.config.nameRequired'))
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
        local: {
          ...local,
          warnings:
            res.warnings.length > 0
              ? res.warnings.map((text) => ({ text, code: 'generic' as const }))
              : local.warnings,
        },
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
          t('sql.toast.lineageChanged'),
          t('sql.toast.lineageChangedDesc', {
            id: formatChangeId(res.change_event_id),
            page: t('layout.nav.changes'),
          }),
        )
      } else if (res.edges_created === 0 && res.tables_created.length === 0) {
        toast.info(t('sql.toast.noChange'), t('sql.toast.noNewEdges'))
      } else {
        toast.success(
          t('sql.toast.parseDone'),
          t('sql.toast.parseDoneDesc', { tables: res.tables_created.length, edges: res.edges_created }),
        )
      }
      setEditing(null)
      await refreshAll()
    } catch (err) {
      setPanelOpen(false)
      toast.error(t('sql.toast.parseFailed'), err instanceof Error ? err.message : t('sql.toast.requestFailed'))
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
        toast.info(
          t('sql.toast.lineageChanged'),
          t('sql.toast.lineageChangedDescShort', { id: formatChangeId(res.change_event_id) }),
        )
      } else if (res.edges_created === 0) {
        toast.info(t('sql.toast.noChange'), t('sql.toast.noNewEdges'))
      } else {
        toast.success(t('sql.toast.parseDone'), t('sql.toast.parseDoneEdges', { edges: res.edges_created }))
      }
      await refreshAll()
    } catch (err) {
      toast.error(t('sql.toast.reparseFailed'), err instanceof Error ? err.message : t('sql.toast.requestFailed'))
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
      toast.success(t('sql.toast.deleted'), deleting.name)
      setDeleting(null)
      if (drawerScript?.id === deleting.id) setDrawerOpen(false)
      await refreshAll()
    } catch (err) {
      toast.error(t('sql.toast.deleteFailed'), err instanceof Error ? err.message : t('sql.toast.requestFailed'))
    } finally {
      setDeleteLoading(false)
    }
  }

  // ---------- 批量导入 ----------
  const openImport = () => {
    setImportError('')
    setImportResult(null)
    setImportLoading(false)
    setImportOpen(true)
  }

  const handleImport = async () => {
    const dir = importDir.trim()
    if (!dir) {
      setImportError(t('sql.import.dirRequired'))
      return
    }
    setImportLoading(true)
    setImportError('')
    try {
      const res = await batchImport({ dir_path: dir, recursive: importRecursive })
      setImportResult(res)
      toast.success(
        t('sql.import.toast.done'),
        t('sql.import.toast.doneDesc', {
          ok: res.summary.ok,
          warning: res.summary.warning,
          error: res.summary.error,
          edges: res.summary.edges_created,
        }),
      )
      // 导入落库后刷新脚本列表与血缘概览
      await refreshAll()
    } catch (err) {
      // 404 目录不存在等业务错误:表单内联红字,不关弹窗
      setImportResult(null)
      setImportError(err instanceof ApiError && err.message ? err.message : t('sql.import.toast.failed'))
    } finally {
      setImportLoading(false)
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
      title: t('sql.list.col.script'),
      render: (row) => (
        <span className="flex items-center gap-2">
          <FileCode2 className="size-3.5 shrink-0 text-slate-500" />
          <span className="font-mono text-[13px] text-slate-900">{row.name}</span>
        </span>
      ),
    },
    {
      key: 'sql_type',
      title: t('sql.list.col.type'),
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
      title: t('sql.list.col.lineage'),
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
                {t('sql.list.viewGraph')}
              </Link>
            )}
          </span>
        )
      },
    },
    {
      key: 'status',
      title: t('sql.list.col.status'),
      width: 96,
      render: () => <StatusBadge status="parsed" />,
    },
    {
      key: 'version',
      title: t('sql.list.col.version'),
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
      title: t('sql.list.col.owner'),
      render: () => (
        <span className="flex items-center gap-1.5">
          <Avatar name={user} size={24} />
          <span>{user}</span>
        </span>
      ),
    },
    {
      key: 'updated_at',
      title: t('sql.list.col.updatedAt'),
      render: (row) => (
        <span className="text-xs text-slate-500" title={formatDateTime(row.updated_at)}>
          {relativeTime(row.updated_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      title: t('sql.list.col.actions'),
      width: 108,
      align: 'right',
      render: (row) => (
        <span className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon-sm" aria-label={t('sql.list.versionHistory')} onClick={() => openDrawer(row)}>
            <History className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('sql.list.reparse')}
            loading={reparsingId === row.id}
            onClick={() => void handleReparse(row)}
          >
            <RefreshCw className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={t('common.button.delete')} onClick={() => setDeleting(row)}>
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
                  placeholder={t('sql.editor.namePlaceholder')}
                  disabled={!!editing}
                  className="min-w-0 flex-1 border-b-2 border-transparent bg-transparent text-[15px] font-medium text-slate-900 outline-none transition-colors placeholder:font-normal placeholder:text-slate-400 focus:border-primary-600 disabled:text-slate-500"
                />
                {editing && (
                  <span className="flex shrink-0 items-center gap-1 rounded bg-pending-light px-1.5 py-0.5 text-[11px] font-medium text-pending">
                    {t('sql.editor.editingBadge', { from: editing.version, to: editing.version + 1 })}
                    <button type="button" onClick={cancelEditing} aria-label={t('sql.editor.cancelEdit')} className="hover:text-slate-900">
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
                  placeholder={t('sql.editor.sqlPlaceholder')}
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
              <h3 className="text-[15px] font-semibold text-slate-900">{t('sql.config.title')}</h3>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="mb-1.5 block text-[13px] font-medium text-slate-700">{t('sql.config.dialect')}</label>
                  <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
                    spark
                  </span>
                  <p className="mt-1 text-xs text-slate-500">{t('sql.config.dialectHint')}</p>
                </div>
                <div>
                  <label className="mb-1.5 block text-[13px] font-medium text-slate-700">{t('sql.config.scriptType')}</label>
                  <select
                    value={scriptKind}
                    onChange={(e) => setScriptKind(e.target.value as 'auto' | 'ddl' | 'etl')}
                    className="h-8 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[13px] text-slate-900 outline-none transition-colors focus:border-primary-600 focus:ring-2 focus:ring-[rgba(13,148,136,0.30)]"
                  >
                    <option value="auto">{t('sql.config.typeAuto')}</option>
                    <option value="ddl">{t('sql.config.typeDdl')}</option>
                    <option value="etl">{t('sql.config.typeEtl')}</option>
                  </select>
                  <p className="mt-1 text-xs text-slate-500">{t('sql.config.typeHint')}</p>
                </div>
                {bareSelect && (
                  <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-slate-700">{t('sql.config.targetTable')}</label>
                    <input
                      value={targetTable}
                      onChange={(e) => setTargetTable(e.target.value)}
                      placeholder="dwd.dwd_xxx"
                      className="h-8 w-full rounded-md border border-slate-300 bg-white px-2.5 font-mono text-[13px] text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-primary-600 focus:ring-2 focus:ring-[rgba(13,148,136,0.30)]"
                    />
                    <p className="mt-1 text-xs text-slate-500">{t('sql.config.targetHint')}</p>
                  </div>
                )}
                <div>
                  <label className="mb-1.5 block text-[13px] font-medium text-slate-700">{t('sql.config.submitter')}</label>
                  <span className="flex items-center gap-1.5 text-[13px] text-slate-900">
                    <Avatar name={user} size={24} />
                    {user}
                  </span>
                </div>
                <div className="rounded-md bg-info-light p-2.5 text-xs leading-5 text-slate-600">
                  {t('sql.config.supported')}
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                  <Button variant="ghost" onClick={openImport} className="mr-auto" disabled={parsing || previewing}>
                    <FolderInput className="size-3.5" />
                    {t('sql.import.button')}
                  </Button>
                  <Button variant="secondary" onClick={handlePreview} loading={previewing} disabled={parsing}>
                    {t('sql.config.preview')}
                  </Button>
                  <Button onClick={() => void handleSubmit()} loading={parsing} disabled={previewing}>
                    <Zap className="size-3.5" />
                    {parsing
                      ? t('sql.config.parsing')
                      : editing
                        ? t('sql.config.saveVersion')
                        : t('sql.config.submit')}
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
          <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2 sm:py-0">
            <h2 className="text-[15px] font-semibold text-slate-900">{t('sql.list.title')}</h2>
            <span className="rounded bg-slate-100 px-1 text-[11px] leading-4 text-slate-500">{scripts.length}</span>
            <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
              <div className="relative min-w-0 flex-1 sm:flex-none">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder={t('sql.list.searchPlaceholder')}
                  className="h-8 w-full rounded-md border border-slate-300 bg-white pl-8 pr-2.5 text-[13px] outline-none transition-colors placeholder:text-slate-400 focus:border-primary-600 focus:ring-2 focus:ring-[rgba(13,148,136,0.30)] sm:w-52"
                />
              </div>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as 'all' | 'ddl' | 'etl')}
                className="h-8 rounded-md border border-slate-300 bg-white px-2 text-[13px] text-slate-700 outline-none focus:border-primary-600"
              >
                <option value="all">{t('sql.list.allTypes')}</option>
                <option value="ddl">DDL</option>
                <option value="etl">ETL</option>
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | 'parsed' | 'parse_failed')}
                className="h-8 rounded-md border border-slate-300 bg-white px-2 text-[13px] text-slate-700 outline-none focus:border-primary-600"
              >
                <option value="all">{t('sql.list.allStatus')}</option>
                <option value="parsed">{t('common.status.parsed')}</option>
                <option value="parse_failed">{t('common.status.parse_failed')}</option>
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
            emptyTitle={
              scripts.length === 0 && !hasFilter ? t('sql.list.empty.title') : t('sql.list.noMatch.title')
            }
            emptyDescription={
              scripts.length === 0 && !hasFilter ? t('sql.list.empty.desc') : t('sql.list.noMatch.desc')
            }
            footer={
              hasFilter && filtered.length !== scripts.length
                ? t('sql.list.filteredCount', { shown: filtered.length, total: scripts.length })
                : t('common.table.total', { count: filtered.length })
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

      {/* 批量导入模态:目录 + 递归 → 逐文件解析落库,结果汇总 + 明细 */}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        width={720}
        title={importResult ? t('sql.import.result.title') : t('sql.import.title')}
        footer={
          importResult ? (
            <>
              <Button variant="ghost" onClick={() => setImportResult(null)}>
                {t('sql.import.again')}
              </Button>
              <Button onClick={() => setImportOpen(false)}>{t('sql.import.done')}</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setImportOpen(false)}>
                {t('common.button.cancel')}
              </Button>
              <Button onClick={() => void handleImport()} loading={importLoading}>
                <FolderInput className="size-3.5" />
                {importLoading ? t('sql.import.importing') : t('sql.import.submit')}
              </Button>
            </>
          )
        }
      >
        {!importResult ? (
          /* ---------- 表单视图 ---------- */
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-slate-700">
                {t('sql.import.dir.label')}
              </label>
              <input
                value={importDir}
                onChange={(e) => {
                  setImportDir(e.target.value)
                  setImportError('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void handleImport()
                  }
                }}
                placeholder={t('sql.import.dir.placeholder')}
                autoFocus
                className={cn(
                  'h-8 w-full rounded-md border bg-white px-2.5 font-mono text-[13px] text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:ring-2 focus:ring-[rgba(13,148,136,0.30)]',
                  importError ? 'border-danger' : 'border-slate-300 focus:border-primary-600',
                )}
              />
              {importError ? (
                <p className="mt-1.5 text-xs text-danger">{importError}</p>
              ) : (
                <p className="mt-1.5 text-xs text-slate-500">{t('sql.import.dir.hint')}</p>
              )}
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-slate-700">
              <input
                type="checkbox"
                checked={importRecursive}
                onChange={(e) => setImportRecursive(e.target.checked)}
                className="size-3.5 accent-primary-700"
              />
              {t('sql.import.recursive')}
            </label>
          </div>
        ) : (
          /* ---------- 结果视图 ---------- */
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <ImportSummaryChip tone="slate" label={t('sql.import.summary.total')} value={importResult.summary.total} />
              <ImportSummaryChip tone="success" label={t('sql.import.summary.ok')} value={importResult.summary.ok} />
              <ImportSummaryChip tone="warning" label={t('sql.import.summary.warning')} value={importResult.summary.warning} />
              <ImportSummaryChip tone="danger" label={t('sql.import.summary.error')} value={importResult.summary.error} />
              <ImportSummaryChip tone="primary" label={t('sql.import.summary.edges')} value={importResult.summary.edges_created} />
            </div>
            {importResult.results.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-slate-500">{t('sql.import.empty')}</p>
            ) : (
              <div className="overflow-hidden rounded-md border border-slate-200">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="h-9 border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                      <th className="w-20 px-3">{t('sql.import.col.status')}</th>
                      <th className="px-3">{t('sql.import.col.file')}</th>
                      <th className="px-3">{t('sql.import.col.lineage')}</th>
                      <th className="w-16 px-3 text-right">{t('sql.import.col.edges')}</th>
                      <th className="w-40 px-3">{t('sql.import.col.message')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResult.results.map((r) => (
                      <tr
                        key={r.file}
                        className={cn(
                          'h-9 border-b border-slate-100 last:border-0',
                          r.status === 'error' && 'bg-danger-light/60',
                        )}
                      >
                        <td className="px-3">
                          {r.status === 'ok' && <StatusBadge status="parsed" label={t('sql.import.status.ok')} />}
                          {r.status === 'warning' && <StatusBadge status="warning" label={t('sql.import.status.warning')} />}
                          {r.status === 'error' && <StatusBadge status="parse_failed" label={t('sql.import.status.error')} />}
                        </td>
                        <td className="max-w-0 truncate px-3 font-mono text-xs text-slate-900" title={r.file}>
                          {r.file}
                        </td>
                        <td
                          className="max-w-0 truncate px-3 font-mono text-xs text-slate-700"
                          title={`${r.source_tables.join(', ')} → ${r.target_tables.join(', ')}`}
                        >
                          {r.source_tables.join(', ') || '—'} → {r.target_tables.join(', ') || '—'}
                        </td>
                        <td className="px-3 text-right font-mono text-xs tabular-nums text-slate-700">
                          {r.edges_created}
                        </td>
                        <td className="max-w-0 truncate px-3 text-xs">
                          {r.error ? (
                            <span className="text-danger" title={r.error}>
                              {r.error}
                            </span>
                          ) : r.warnings.length > 0 ? (
                            <span className="text-sqlwarn" title={r.warnings.join('\n')}>
                              {r.warnings.length} × {t('common.status.warning')}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* 删除确认模态(非名称二次确认,仅系统/报表需要) */}
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        danger
        title={t('sql.delete.title')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t('common.button.cancel')}
            </Button>
            <Button variant="danger" onClick={() => void handleDelete()} loading={deleteLoading}>
              {t('sql.delete.confirmButton')}
            </Button>
          </>
        }
      >
        {deleting && (
          <p className="text-[13px] leading-6 text-slate-700">
            {t('sql.delete.bodyPrefix')}{' '}
            <span className="font-mono font-medium text-slate-900">{deleting.name}</span>
            {t('sql.delete.bodyMiddle')}{' '}
            <span className="font-mono font-medium text-danger">
              {lineageByScript.get(deleting.name)?.edgeCount ?? 0}
            </span>{' '}
            {t('sql.delete.bodySuffix')}
          </p>
        )}
      </Modal>
    </div>
  )
}
