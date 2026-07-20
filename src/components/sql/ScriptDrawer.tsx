/**
 * 脚本详情抽屉(sql.md §4)
 * 480px 浅色 Drawer:基本信息 → SQL 原文(只读深色 CodeEditor + 复制)→ 版本历史时间线 → 版本对比 diff 视图
 * 版本重建:后端仅留存当前版本原文;历史版本通过 sql_change 变更事件的 old_text/new_text 回推(仅血缘变化时产生)
 */

import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Copy } from 'lucide-react'
import { motion } from 'framer-motion'
import type { ChangeEventSummary, SqlScript, SqlScriptDetail } from '@/lib/api'
import { getScript, listChanges } from '@/lib/api'
import { formatDateTime, relativeTime } from '@/lib/format'
import { useT } from '@/lib/i18n'
import type { I18nVars } from '@/lib/i18n'
import { Avatar } from '@/components/common/Avatar'
import { CodeEditor } from '@/components/common/CodeEditor'
import type { DiffLine } from '@/components/common/CodeEditor'
import { Drawer, DrawerSection } from '@/components/common/Drawer'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/common/Toast'
import { useUser } from '@/hooks/useUser'
import { diffLines } from './lineDiff'

interface VersionEntry {
  v: number
  text: string | null
  time: string
  note: string
  current?: boolean
  diff?: { oldText: string; newText: string; fromV: number }
}

interface DiffView {
  fromV: number
  toV: number
  lines: DiffLine[]
}

export interface ScriptDrawerProps {
  script: SqlScript | null
  open: boolean
  onClose: () => void
  /** 编辑并重新解析:把 SQL 原文载入区块一编辑器 */
  onEdit: (detail: SqlScriptDetail) => void
  /** 删除脚本:由父级打开确认模态 */
  onDelete: (script: SqlScript) => void
  /** 血缘摘要(源/目标数,来自血缘图按脚本聚合) */
  lineage?: { sources: number; targets: number }
}

export function ScriptDrawer({ script, open, onClose, onEdit, onDelete, lineage }: ScriptDrawerProps) {
  const { t } = useT()
  const [detail, setDetail] = useState<SqlScriptDetail | null>(null)
  const handleLoaded = useCallback((d: SqlScriptDetail) => setDetail(d), [])

  const title = (
    <span className="flex items-center gap-2">
      <span className="font-mono">{script?.name ?? ''}</span>
      <StatusBadge status="parsed" />
      {script && (
        <span className="rounded bg-slate-100 px-1.5 py-px font-mono text-[11px] font-medium text-slate-600">
          v{script.version}
        </span>
      )}
    </span>
  )

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      footer={
        script && detail && detail.id === script.id ? (
          <>
            <Button variant="secondary" onClick={() => onEdit(detail)}>
              {t('sql.drawer.edit')}
            </Button>
            <Button variant="danger" onClick={() => onDelete(script)}>
              {t('sql.drawer.delete')}
            </Button>
          </>
        ) : undefined
      }
    >
      {script && (
        <DrawerBody key={script.id} script={script} lineage={lineage} onLoaded={handleLoaded} />
      )}
    </Drawer>
  )
}

/** 抽屉主体:按脚本 id 键控重挂载,保证切换脚本时状态复位 */
function DrawerBody({
  script,
  lineage,
  onLoaded,
}: {
  script: SqlScript
  lineage?: { sources: number; targets: number }
  onLoaded: (d: SqlScriptDetail) => void
}) {
  const { user } = useUser()
  const { t } = useT()
  const [detail, setDetail] = useState<SqlScriptDetail | null>(null)
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [diffView, setDiffView] = useState<DiffView | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([getScript(script.id), listChanges()])
      .then(([d, changes]) => {
        if (cancelled) return
        setDetail(d)
        setVersions(buildVersions(d, changes, t))
        setLoading(false)
        onLoaded(d)
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false)
          toast.error(t('sql.toast.loadFailed'), t('sql.drawer.loadFailedDesc'))
        }
      })
    return () => {
      cancelled = true
    }
  }, [script.id, onLoaded, t])

  const copySql = async () => {
    if (!detail) return
    try {
      await navigator.clipboard.writeText(detail.sql_text)
      toast.success(t('sql.toast.copied'), t('sql.drawer.copiedDesc'))
    } catch {
      toast.error(t('sql.toast.copyFailed'), t('sql.drawer.copyFailedDesc'))
    }
  }

  if (loading || !detail) {
    return (
      <div className="space-y-3">
        <div className="h-4 w-1/2 animate-pulse-soft rounded bg-slate-100" />
        <div className="h-32 w-full animate-pulse-soft rounded bg-slate-100" />
        <div className="h-4 w-1/3 animate-pulse-soft rounded bg-slate-100" />
      </div>
    )
  }

  if (diffView) {
    /* ---------- 版本对比视图 ---------- */
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
        <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDiffView(null)}
            className="flex items-center gap-1 text-xs text-primary-600 hover:underline underline-offset-4"
          >
            <ArrowLeft className="size-3" />
            {t('sql.drawer.backToHistory')}
          </button>
          <span className="ml-auto flex items-center gap-1.5 font-mono text-xs text-slate-500">
            <span className="rounded bg-slate-100 px-1.5 py-px font-medium text-slate-600">v{diffView.fromV}</span>
            →
            <span className="rounded bg-primary-50 px-1.5 py-px font-medium text-primary-700">v{diffView.toV}</span>
          </span>
        </div>
        <CodeEditor value="" diffLines={diffView.lines} minHeight={120} />
      </motion.div>
    )
  }

  return (
    <>
      {/* ---------- 基本信息 ---------- */}
      <DrawerSection title={t('sql.drawer.section.info')}>
        <dl className="space-y-2 text-[13px]">
          <div className="flex items-center justify-between">
            <dt className="text-slate-500">{t('sql.drawer.field.type')}</dt>
            <dd>
              <span
                className={
                  script.sql_type === 'ddl'
                    ? 'rounded bg-slate-100 px-1.5 py-px font-mono text-[11px] font-medium text-slate-600'
                    : 'rounded bg-primary-50 px-1.5 py-px font-mono text-[11px] font-medium text-primary-700'
                }
              >
                {script.sql_type === 'ddl' ? 'DDL' : 'ETL'}
              </span>
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-slate-500">{t('sql.drawer.field.submitter')}</dt>
            <dd className="flex items-center gap-1.5">
              <Avatar name={user} size={24} />
              <span>{user}</span>
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-slate-500">{t('sql.drawer.field.createdAt')}</dt>
            <dd className="font-mono text-xs text-slate-700">{formatDateTime(script.created_at)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-slate-500">{t('sql.drawer.field.lineageSummary')}</dt>
            <dd className="font-mono text-xs text-slate-700">
              {t('sql.drawer.lineageValue', { sources: lineage?.sources ?? 0, targets: lineage?.targets ?? 0 })}
            </dd>
          </div>
        </dl>
      </DrawerSection>

      {/* ---------- SQL 原文 ---------- */}
      <DrawerSection title={t('sql.drawer.section.sql')}>
        <div className="relative">
          <CodeEditor value={detail.sql_text} readOnly minHeight={84} className="max-h-60 text-xs" />
          <button
            type="button"
            onClick={() => void copySql()}
            aria-label={t('sql.drawer.copySql')}
            className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11px] text-slate-300 backdrop-blur transition-colors duration-120 hover:bg-white/20 hover:text-white"
          >
            <Copy className="size-3" />
            {t('sql.drawer.copy')}
          </button>
        </div>
      </DrawerSection>

      {/* ---------- 版本历史 ---------- */}
      <DrawerSection title={t('sql.drawer.section.versions')}>
        <div className="relative pl-4">
          <span className="absolute bottom-2 left-[5px] top-2 w-px bg-slate-200" aria-hidden />
          {versions.map((v, i) => (
            <motion.div
              key={v.v}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2, delay: Math.min(i, 15) * 0.03 }}
              className="relative mb-3 last:mb-0"
            >
              <span
                className="absolute -left-4 top-1 size-[11px] rounded-full border-2 border-white"
                style={{ backgroundColor: v.current ? '#16A34A' : '#CBD5E1' }}
                aria-hidden
              />
              <div className="flex items-center gap-2">
                <span
                  className={
                    v.current
                      ? 'rounded bg-primary-50 px-1.5 py-px font-mono text-[11px] font-medium text-primary-700'
                      : 'rounded bg-slate-100 px-1.5 py-px font-mono text-[11px] font-medium text-slate-600'
                  }
                >
                  v{v.v}
                </span>
                <span className="text-xs text-slate-500" title={formatDateTime(v.time)}>
                  {relativeTime(v.time)}
                </span>
                {v.diff && (
                  <button
                    type="button"
                    onClick={() =>
                      v.diff &&
                      setDiffView({ fromV: v.diff.fromV, toV: v.v, lines: diffLines(v.diff.oldText, v.diff.newText) })
                    }
                    className="ml-auto text-xs text-primary-600 hover:underline underline-offset-4"
                  >
                    {t('sql.drawer.compare', { version: v.diff.fromV })}
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-600">{v.note}</p>
            </motion.div>
          ))}
        </div>
      </DrawerSection>
    </>
  )
}

/** 由当前版本 + sql_change 事件回推版本时间线 */
function buildVersions(
  detail: SqlScriptDetail,
  changes: ChangeEventSummary[],
  t: (key: string, vars?: I18nVars) => string,
): VersionEntry[] {
  const events = changes
    .filter((c) => c.change_type === 'sql_change' && c.object_name === detail.name)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  const entries: VersionEntry[] = []
  entries.push({
    v: detail.version,
    text: detail.sql_text,
    time: detail.updated_at,
    note:
      events.length > 0
        ? t('sql.drawer.note.current')
        : detail.version > 1
          ? t('sql.drawer.note.currentNoHistory')
          : t('sql.drawer.note.initial'),
    current: true,
    diff:
      events.length > 0
        ? { oldText: events[0].old_text, newText: events[0].new_text, fromV: detail.version - 1 }
        : undefined,
  })

  for (let i = 0; i < events.length; i++) {
    const v = detail.version - 1 - i
    if (v < 1) break
    const older = events[i + 1]
    entries.push({
      v,
      text: events[i].old_text,
      time: events[i].created_at,
      note: events[i].diff_summary || t('sql.drawer.note.update'),
      diff: older ? { oldText: older.old_text, newText: events[i].old_text, fromV: v - 1 } : undefined,
    })
  }

  const reconstructed = events.length + 1
  if (detail.version > reconstructed) {
    entries.push({
      v: 1,
      text: null,
      time: detail.created_at,
      note: t('sql.drawer.note.initialNoText'),
    })
  }
  return entries
}
