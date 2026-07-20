/**
 * 发起变更(changes.md §4,两步流)
 * ① 录入变更:DDL 变更(选表 + 新 DDL)/ SQL 变更(选脚本 + 新 SQL)
 * ② 提交(POST /api/changes/ddl|sql)后展示影响分析结果:
 *    变更差异 / 受影响报表·系统·中间表 / 自动生成的审批人清单,提示「已通知 N 位负责人」
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  FileCode2,
  FileDiff,
  Info,
  Send,
  Table2,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import type { SqlScript, TableListItem } from '@/lib/api'
import {
  getScript,
  listScripts,
  listTables,
  submitDdlChange,
  submitSqlChange,
} from '@/lib/api'
import { formatChangeId } from '@/lib/format'
import { getLang, translate, useT } from '@/lib/i18n'
import { Avatar } from '@/components/common/Avatar'
import { CodeEditor } from '@/components/common/CodeEditor'
import { LayerBadge } from '@/components/common/LayerBadge'
import { toast } from '@/components/common/Toast'
import { notifyApprovalsChanged } from '@/components/Layout'
import { useUser } from '@/hooks/useUser'
import { Button } from '@/components/ui/button'
import type { ChangeDetailReal } from './types'
import { isDiffEmpty } from './types'
import { ChangeDiffView, ImpactChips, RoleBadge, SearchSelect } from './shared'

const ENTRANCE = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
}

function CardShell({
  index,
  icon: Icon,
  title,
  hint,
  children,
  footer,
}: {
  index: number
  icon: typeof FileDiff
  title: string
  hint: string
  children: React.ReactNode
  footer: React.ReactNode
}) {
  return (
    <motion.div
      initial={ENTRANCE.initial}
      animate={ENTRANCE.animate}
      transition={{ ...ENTRANCE.transition, delay: index * 0.06 }}
      className="flex flex-col rounded-lg border border-slate-200 bg-white shadow-card"
    >
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <Icon className="size-4 text-slate-500" />
        <h3 className="text-[15px] font-semibold text-slate-900">{title}</h3>
        <span className="ml-auto text-xs text-slate-400">{hint}</span>
      </div>
      <div className="flex-1 space-y-3 p-4">{children}</div>
      <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-3">
        {footer}
      </div>
    </motion.div>
  )
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="mb-1 block text-[13px] font-medium text-slate-700">
      {children}
      {required && <span className="ml-0.5 text-danger">*</span>}
    </label>
  )
}

export function CreateTab({ onSubmitted }: { onSubmitted: (changeId: number) => void }) {
  const { t } = useT()
  const { user } = useUser()
  const [tables, setTables] = useState<TableListItem[]>([])
  const [scripts, setScripts] = useState<SqlScript[]>([])
  const [metaError, setMetaError] = useState(false)

  // 卡 A:DDL 变更
  const [tableId, setTableId] = useState('')
  const [ddl, setDdl] = useState('')
  const [ddlSubmitting, setDdlSubmitting] = useState(false)
  const [ddlError, setDdlError] = useState('')

  // 卡 B:SQL 变更
  const [scriptId, setScriptId] = useState('')
  const [sql, setSql] = useState('')
  const [sqlLoading, setSqlLoading] = useState(false)
  const [sqlSubmitting, setSqlSubmitting] = useState(false)
  const [sqlError, setSqlError] = useState('')

  // 第②步:提交后的影响分析结果
  const [result, setResult] = useState<ChangeDetailReal | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  const loadMeta = () => {
    setMetaError(false)
    Promise.all([listTables(), listScripts()])
      .then(([ts, ss]) => {
        setTables(ts)
        setScripts(ss)
      })
      .catch(() => setMetaError(true))
  }

  useEffect(() => {
    loadMeta()
  }, [])

  // 选中脚本后载入当前版本 SQL(基于当前版本修改)
  useEffect(() => {
    if (!scriptId) {
      setSql('')
      return
    }
    setSqlLoading(true)
    getScript(Number(scriptId))
      .then((s) => setSql(s.sql_text))
      .catch(() => setSqlError(translate(getLang(), 'changes.create.sql.loadFailed')))
      .finally(() => setSqlLoading(false))
  }, [scriptId])

  const tableOptions = useMemo(
    () =>
      tables.map((t) => ({
        value: String(t.id),
        label: t.name,
        trailing: <LayerBadge layer={t.layer} />,
      })),
    [tables],
  )

  const scriptOptions = useMemo(
    () =>
      scripts.map((s) => ({
        value: String(s.id),
        label: s.name,
        trailing: (
          <span className="rounded bg-slate-100 px-1.5 font-mono text-[11px] leading-4 text-slate-500">
            v{s.version}
          </span>
        ),
      })),
    [scripts],
  )

  const handleResult = (detail: ChangeDetailReal) => {
    setResult(detail)
    notifyApprovalsChanged()
    const approvers = new Set(detail.approvals.map((a) => a.approver_name))
    toast.success(
      t('changes.create.toast.submitted', { id: formatChangeId(detail.event.id) }),
      t('changes.create.toast.notified', { count: approvers.size }),
    )
    // 展开后滚入视口
    window.setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
  }

  const submitDdl = async () => {
    if (!tableId || !ddl.trim() || ddlSubmitting) return
    setDdlSubmitting(true)
    setDdlError('')
    try {
      const detail = (await submitDdlChange({
        table_id: Number(tableId),
        new_ddl: ddl,
        submitted_by: user,
      })) as unknown as ChangeDetailReal
      handleResult(detail)
    } catch (e) {
      setDdlError(e instanceof Error ? e.message : t('changes.create.ddl.submitFailed'))
    } finally {
      setDdlSubmitting(false)
    }
  }

  const submitSql = async () => {
    if (!scriptId || !sql.trim() || sqlSubmitting) return
    setSqlSubmitting(true)
    setSqlError('')
    try {
      const detail = (await submitSqlChange({
        script_id: Number(scriptId),
        new_sql: sql,
        submitted_by: user,
      })) as unknown as ChangeDetailReal
      handleResult(detail)
    } catch (e) {
      setSqlError(e instanceof Error ? e.message : t('changes.create.sql.submitFailed'))
    } finally {
      setSqlSubmitting(false)
    }
  }

  const approvers = useMemo(() => {
    if (!result) return []
    const seen = new Set<string>()
    const list: { name: string; role: string }[] = []
    for (const a of result.approvals) {
      const key = `${a.approver_name}|${a.approver_role}`
      if (seen.has(key)) continue
      seen.add(key)
      list.push({ name: a.approver_name, role: a.approver_role })
    }
    return list
  }, [result])

  return (
    <div>
      {metaError && (
        <div className="mb-3 flex items-center gap-2 rounded-md bg-danger-light px-3 py-2 text-xs text-danger">
          <AlertCircle className="size-3.5" />
          {t('changes.create.meta.loadFailed')}
          <button type="button" onClick={loadMeta} className="font-medium text-primary-600 hover:underline">
            {t('common.button.retry')}
          </button>
        </div>
      )}

      {/* 第①步:录入变更 */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <CardShell
          index={0}
          icon={FileDiff}
          title={t('common.changeType.ddl_change')}
          hint={t('changes.create.ddl.hint')}
          footer={
            <Button
              variant="secondary"
              loading={ddlSubmitting}
              disabled={!tableId || !ddl.trim()}
              onClick={() => void submitDdl()}
            >
              {ddlSubmitting ? t('changes.create.parsing') : t('changes.create.submit')}
            </Button>
          }
        >
          <div>
            <FieldLabel required>{t('changes.create.ddl.selectTable')}</FieldLabel>
            <SearchSelect
              value={tableId}
              onChange={setTableId}
              options={tableOptions}
              placeholder={t('changes.create.ddl.tablePlaceholder')}
              searchPlaceholder={t('changes.create.ddl.tableSearch')}
            />
          </div>
          <div>
            <FieldLabel required>{t('changes.create.ddl.newDdl')}</FieldLabel>
            <CodeEditor
              value={ddl}
              onChange={setDdl}
              minHeight={220}
              placeholder={t('changes.create.ddl.editorPlaceholder')}
            />
          </div>
          {ddlError && (
            <p className="flex items-center gap-1.5 text-xs text-danger">
              <AlertCircle className="size-3.5" />
              {ddlError}
            </p>
          )}
        </CardShell>

        <CardShell
          index={1}
          icon={FileCode2}
          title={t('common.changeType.sql_change')}
          hint={t('changes.create.sql.hint')}
          footer={
            <Button
              variant="secondary"
              loading={sqlSubmitting}
              disabled={!scriptId || !sql.trim() || sqlLoading}
              onClick={() => void submitSql()}
            >
              {sqlSubmitting ? t('changes.create.parsing') : t('changes.create.submit')}
            </Button>
          }
        >
          <div>
            <FieldLabel required>{t('changes.create.sql.selectScript')}</FieldLabel>
            <SearchSelect
              value={scriptId}
              onChange={setScriptId}
              options={scriptOptions}
              placeholder={t('changes.create.sql.scriptPlaceholder')}
              searchPlaceholder={t('changes.create.sql.scriptSearch')}
            />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <FieldLabel required>{t('changes.create.sql.newSql')}</FieldLabel>
              {scriptId && <span className="text-xs text-slate-400">{t('changes.create.sql.loadedNote')}</span>}
            </div>
            {sqlLoading ? (
              <div className="h-[220px] animate-pulse-soft rounded-lg bg-slate-100" />
            ) : (
              <CodeEditor
                value={sql}
                onChange={setSql}
                minHeight={220}
                placeholder={t('changes.create.sql.editorPlaceholder')}
              />
            )}
          </div>
          {sqlError && (
            <p className="flex items-center gap-1.5 text-xs text-danger">
              <AlertCircle className="size-3.5" />
              {sqlError}
            </p>
          )}
        </CardShell>
      </div>

      {/* 第②步:影响分析(提交后展开) */}
      <AnimatePresence>
        {result && (
          <motion.div
            key={result.event.id}
            ref={resultRef}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="mt-4 rounded-lg border border-slate-200 bg-white shadow-card">
              {/* 头部 */}
              <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                <h3 className="text-[15px] font-semibold text-slate-900">{t('changes.impact.title')}</h3>
                <span className="rounded bg-slate-100 px-1.5 font-mono text-[11px] leading-4 text-slate-600">
                  {formatChangeId(result.event.id)}
                </span>
                <span className="text-xs text-slate-400">{t('changes.impact.subtitle')}</span>
              </div>

              <div className="space-y-4 p-4">
                {/* 成功条:已通知 N 位负责人 */}
                <div className="flex flex-wrap items-center gap-3 rounded-md bg-success-light px-3 py-2.5">
                  <CheckCircle2 className="size-4 shrink-0 text-success" />
                  <span className="text-[13px] font-medium text-success">
                    {t('changes.create.result.success', {
                      id: formatChangeId(result.event.id),
                      count: approvers.length,
                    })}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setResult(null)
                        setDdl('')
                        setSql('')
                        setTableId('')
                        setScriptId('')
                      }}
                    >
                      {t('changes.create.result.continue')}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => onSubmitted(result.event.id)}>
                      {t('changes.create.result.viewEvent')}
                    </Button>
                  </span>
                </div>

                {/* 影响面过大警告(不强制阻断) */}
                {result.impacted_reports.length > 10 && (
                  <div className="flex items-center gap-2 rounded-md bg-pending-light px-3 py-2 text-xs text-pending">
                    <AlertCircle className="size-3.5" />
                    {t('changes.create.result.tooMany', { count: result.impacted_reports.length })}
                  </div>
                )}

                <div className="grid grid-cols-12 gap-4">
                  {/* 变更差异区 */}
                  <div className="col-span-12 lg:col-span-5">
                    <h4 className="mb-2 text-xs font-medium text-slate-500">{t('changes.diff.title')}</h4>
                    {isDiffEmpty(result.diff) ? (
                      <p className="flex items-center gap-1.5 rounded-md bg-info-light px-3 py-2 text-xs text-info">
                        <Info className="size-3.5" />
                        {t('changes.create.result.noDiff')}
                      </p>
                    ) : (
                      <ChangeDiffView type={result.event.change_type} diff={result.diff} />
                    )}
                  </div>

                  {/* 受影响对象区 */}
                  <div className="col-span-12 lg:col-span-7">
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-xs font-medium text-slate-500">{t('changes.impact.objects')}</h4>
                      <ImpactChips
                        reports={result.impacted_reports.map((r) => r.name)}
                        systems={result.impacted_systems.map((s) => s.name)}
                        tables={result.impacted_tables.map((t) => t.name)}
                      />
                    </div>
                    <div className="space-y-3">
                      {[
                        {
                          icon: BarChart3,
                          label: t('changes.impact.reportsWithCount', { count: result.impacted_reports.length }),
                          names: result.impacted_reports.map((r) => r.name),
                          mono: false,
                        },
                        {
                          icon: Send,
                          label: t('changes.impact.systemsWithCount', { count: result.impacted_systems.length }),
                          names: result.impacted_systems.map((s) => s.name),
                          mono: false,
                        },
                        {
                          icon: Table2,
                          label: t('changes.impact.tablesWithCount', { count: result.impacted_tables.length }),
                          names: result.impacted_tables.map((tbl) => tbl.name),
                          mono: true,
                        },
                      ].map((section, i) => (
                        <motion.div
                          key={section.label}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.24, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
                        >
                          <p className="mb-1 flex items-center gap-1.5 text-xs text-slate-500">
                            <section.icon className="size-3.5" />
                            {section.label}
                          </p>
                          {section.names.length === 0 ? (
                            <p className="pl-5 text-xs text-slate-400">{t('changes.impact.none')}</p>
                          ) : (
                            <ul className="space-y-1 pl-5">
                              {section.names.map((name) => (
                                <li
                                  key={name}
                                  className={
                                    section.mono
                                      ? 'font-mono text-[13px] text-slate-900'
                                      : 'text-[13px] font-medium text-slate-900'
                                  }
                                >
                                  {name}
                                </li>
                              ))}
                            </ul>
                          )}
                        </motion.div>
                      ))}
                    </div>

                    {/* 审批人清单(自动生成) */}
                    <div className="mt-4">
                      <h4 className="mb-2 text-xs font-medium text-slate-500">
                        {t('changes.create.result.approvers')}
                      </h4>
                      {approvers.length === 0 ? (
                        <p className="text-xs text-slate-400">{t('changes.create.result.noApprovers')}</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {approvers.map((a, i) => (
                            <motion.span
                              key={`${a.name}-${a.role}`}
                              initial={{ opacity: 0, scale: 0.9 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ duration: 0.2, delay: i * 0.04 }}
                              className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-2.5"
                            >
                              <Avatar name={a.name} size={24} />
                              <span className="text-[13px] font-medium text-slate-900">{a.name}</span>
                              <RoleBadge role={a.role} />
                            </motion.span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
