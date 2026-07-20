/**
 * 变更事件详情抽屉(changes.md §3.2,720px 宽)
 * 状态步进器 / 变更内容(diff 视图 + 全文)/ 影响分析分节 / 审批任务表 / 底部状态信息条
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, BarChart3, CheckCircle2, Info, Send, XCircle } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { ReportListItem, System, TableListItem } from '@/lib/api'
import { getChange, listReports, listSystems, listTables } from '@/lib/api'
import { formatChangeId, formatDateTime, relativeTime } from '@/lib/format'
import { Avatar } from '@/components/common/Avatar'
import { CodeEditor } from '@/components/common/CodeEditor'
import { Drawer } from '@/components/common/Drawer'
import { LayerBadge } from '@/components/common/LayerBadge'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Tabs } from '@/components/common/Tabs'
import { APPROVALS_REFRESH_EVENT } from '@/components/Layout'
import type { ChangeDetailReal } from './types'
import { changeTitle, isDiffEmpty, lineDiff } from './types'
import { ApprovalStateIcon, ChangeDiffView, RoleBadge, StatusStepper } from './shared'

function SectionShell({
  index,
  title,
  children,
}: {
  index: number
  title: string
  children: React.ReactNode
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
      className="mb-5"
    >
      <h3 className="mb-2 border-b border-slate-100 pb-2 text-xs font-medium text-slate-500">
        {title}
      </h3>
      {children}
    </motion.section>
  )
}

export function ChangeDetailDrawer({
  changeId,
  onClose,
}: {
  changeId: number | null
  onClose: () => void
}) {
  const [detail, setDetail] = useState<ChangeDetailReal | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [contentTab, setContentTab] = useState('diff')
  // 关闭动画期间保留上一次的事件 id,避免标题闪变 #CHG-0000
  const lastId = useRef(0)
  if (changeId !== null) lastId.current = changeId
  // 影响对象富化(负责人 / 基表 / 目标系统 / 分层)
  const [reportsMap, setReportsMap] = useState<Map<number, ReportListItem>>(new Map())
  const [systemsMap, setSystemsMap] = useState<Map<number, System>>(new Map())
  const [tablesMap, setTablesMap] = useState<Map<number, TableListItem>>(new Map())

  const load = useCallback(async (id: number) => {
    setLoading(true)
    setError(false)
    try {
      const d = (await getChange(id)) as unknown as ChangeDetailReal
      setDetail(d)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (changeId === null) return
    setDetail(null)
    setContentTab('diff')
    void load(changeId)
  }, [changeId, load])

  // 富化数据只拉一次
  useEffect(() => {
    if (changeId === null) return
    if (reportsMap.size === 0) {
      listReports()
        .then((rs) => setReportsMap(new Map(rs.map((r) => [r.id, r]))))
        .catch(() => {})
    }
    if (systemsMap.size === 0) {
      listSystems()
        .then((ss) => setSystemsMap(new Map(ss.map((s) => [s.id, s]))))
        .catch(() => {})
    }
    if (tablesMap.size === 0) {
      listTables()
        .then((ts) => setTablesMap(new Map(ts.map((t) => [t.id, t]))))
        .catch(() => {})
    }
  }, [changeId, reportsMap.size, systemsMap.size, tablesMap.size])

  // 审批操作后(收件箱)同步刷新打开的抽屉
  useEffect(() => {
    if (changeId === null) return
    const handler = () => void load(changeId)
    window.addEventListener(APPROVALS_REFRESH_EVENT, handler)
    return () => window.removeEventListener(APPROVALS_REFRESH_EVENT, handler)
  }, [changeId, load])

  const event = detail?.event
  const diffLines = useMemo(
    () => (event ? lineDiff(event.old_text ?? '', event.new_text ?? '') : []),
    [event],
  )

  const footer = event ? (
    event.status === 'pending' ? (
      <div className="flex w-full items-center justify-start gap-2 text-xs text-info">
        <Info className="size-3.5 shrink-0" />
        全员通过后变更自动生效(
        {event.change_type === 'ddl_change' ? 'DDL 替换表字段' : 'SQL 更新脚本与血缘边'})
      </div>
    ) : event.status === 'approved' ? (
      <div className="flex w-full items-center justify-start gap-2 text-xs text-success">
        <CheckCircle2 className="size-3.5 shrink-0" />
        变更已于 {formatDateTime(event.resolved_at)} 生效
      </div>
    ) : (
      <div className="flex w-full items-center justify-start gap-2 text-xs text-danger">
        <XCircle className="size-3.5 shrink-0" />
        变更已于 {formatDateTime(event.resolved_at)} 被驳回
      </div>
    )
  ) : undefined

  return (
    <Drawer
      open={changeId !== null}
      onClose={onClose}
      width={720}
      title={
        <span className="flex items-center gap-2">
          <span className="font-mono">{formatChangeId(lastId.current)}</span>
          {event && <StatusBadge status={event.status === 'approved' ? 'effective' : event.status} />}
        </span>
      }
      footer={footer}
    >
      {loading ? (
        <div className="space-y-4">
          {[64, 180, 220].map((h, i) => (
            <div key={i} className="animate-pulse-soft rounded-md bg-slate-100" style={{ height: h }} />
          ))}
        </div>
      ) : error ? (
        <div className="flex items-center justify-center gap-2 py-20 text-xs text-danger">
          <AlertCircle className="size-3.5" />
          详情加载失败
          <button
            type="button"
            onClick={() => changeId !== null && void load(changeId)}
            className="text-primary-600 hover:underline"
          >
            重试
          </button>
        </div>
      ) : detail && event ? (
        <div>
          {/* 副行:标题 + 发起人 / 时间 / 变更对象 */}
          <div className="mb-4">
            <p className="text-sm font-semibold text-slate-900">
              {changeTitle(event.change_type, event.object_name, detail.diff)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {event.submitted_by} 发起
              {' · '}
              <span title={formatDateTime(event.created_at)}>{relativeTime(event.created_at)}</span>
              {' · '}
              变更对象 <span className="font-mono">{event.object_name}</span>
            </p>
          </div>

          {/* 状态步进器 */}
          <SectionShell index={0} title="状态">
            <StatusStepper status={event.status} />
          </SectionShell>

          {/* 变更内容 */}
          <SectionShell index={1} title="变更内容">
            <Tabs
              className="mb-3"
              items={[
                { key: 'diff', label: '差异 diff' },
                {
                  key: 'full',
                  label: event.change_type === 'ddl_change' ? '新 DDL 全文' : '新 SQL 全文',
                },
              ]}
              value={contentTab}
              onChange={setContentTab}
            />
            {contentTab === 'diff' ? (
              <div className="space-y-3">
                {!isDiffEmpty(detail.diff) && (
                  <ChangeDiffView type={event.change_type} diff={detail.diff} />
                )}
                <CodeEditor value={event.new_text ?? ''} diffLines={diffLines} minHeight={200} readOnly />
              </div>
            ) : (
              <CodeEditor value={event.new_text ?? ''} readOnly minHeight={240} />
            )}
          </SectionShell>

          {/* 影响分析 */}
          <SectionShell index={2} title={`受影响报表 ${detail.impacted_reports.length}`}>
            {detail.impacted_reports.length === 0 ? (
              <p className="text-xs text-slate-400">无受影响报表</p>
            ) : (
              <ul className="space-y-1.5">
                {detail.impacted_reports.map((r) => {
                  const full = reportsMap.get(r.id)
                  return (
                    <li key={r.id} className="flex items-center gap-2 text-[13px]">
                      <BarChart3 className="size-3.5 shrink-0 text-slate-400" />
                      <span className="font-semibold text-slate-900">{r.name}</span>
                      {full && (
                        <>
                          <span className="font-mono text-xs text-slate-400">{full.table_name}</span>
                          <span className="text-xs text-slate-400">→ {full.target_system_name}</span>
                        </>
                      )}
                      {full && (
                        <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
                          <Avatar name={full.owner} size={24} />
                          {full.owner}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </SectionShell>

          <SectionShell index={3} title={`受影响下游系统 ${detail.impacted_systems.length}`}>
            {detail.impacted_systems.length === 0 ? (
              <p className="text-xs text-slate-400">无受影响下游系统</p>
            ) : (
              <ul className="space-y-1.5">
                {detail.impacted_systems.map((s) => {
                  const full = systemsMap.get(s.id)
                  return (
                    <li key={s.id} className="flex items-center gap-2 text-[13px]">
                      <Send className="size-3.5 shrink-0 text-slate-400" />
                      <span className="font-semibold text-slate-900">{s.name}</span>
                      {full && (
                        <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
                          <Avatar name={full.owner} size={24} />
                          {full.owner}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </SectionShell>

          <SectionShell index={4} title={`受影响中间表 ${detail.impacted_tables.length}`}>
            {detail.impacted_tables.length === 0 ? (
              <p className="text-xs text-slate-400">无受影响中间表</p>
            ) : (
              <ul className="space-y-1.5">
                {detail.impacted_tables.map((t) => {
                  const full = tablesMap.get(t.id)
                  return (
                    <li key={t.id} className="flex items-center gap-2 text-[13px]">
                      {full && <LayerBadge layer={full.layer} />}
                      <span className="font-mono text-slate-900">{t.name}</span>
                      {full && (
                        <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
                          <Avatar name={full.owner} size={24} />
                          {full.owner}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </SectionShell>

          {/* 审批任务 */}
          <SectionShell index={5} title={`审批任务 ${detail.approvals.length}`}>
            <div className="overflow-hidden rounded-md border border-slate-200">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="h-8 border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                    <th className="px-3">审批人</th>
                    <th className="px-3">角色</th>
                    <th className="px-3">关联对象</th>
                    <th className="px-3">状态</th>
                    <th className="px-3">评论</th>
                    <th className="px-3">决定时间</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.approvals.map((a) => (
                    <tr key={a.id} className="h-10 border-b border-slate-100 text-[13px] last:border-b-0">
                      <td className="px-3">
                        <span className="flex items-center gap-1.5">
                          <Avatar name={a.approver_name} size={24} />
                          <span className="font-medium text-slate-900">{a.approver_name}</span>
                        </span>
                      </td>
                      <td className="px-3">
                        <RoleBadge role={a.approver_role} />
                      </td>
                      <td className="max-w-[140px] truncate px-3 font-mono text-xs text-slate-500" title={a.target_name}>
                        {a.target_name}
                      </td>
                      <td className="px-3">
                        <span className="flex items-center gap-1 text-xs">
                          <ApprovalStateIcon status={a.status} />
                          <span
                            className={cn(
                              a.status === 'approved'
                                ? 'text-success'
                                : a.status === 'rejected'
                                  ? 'text-danger'
                                  : 'text-pending',
                            )}
                          >
                            {a.status === 'approved' ? '已通过' : a.status === 'rejected' ? '已驳回' : '待审批'}
                          </span>
                        </span>
                      </td>
                      <td className="max-w-[120px] truncate px-3 text-xs text-slate-500" title={a.comment ?? undefined}>
                        {a.comment ? `「${a.comment}」` : '—'}
                      </td>
                      <td className="px-3 text-xs text-slate-500">
                        <span title={formatDateTime(a.decided_at)}>{relativeTime(a.decided_at)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionShell>
        </div>
      ) : null}
    </Drawer>
  )
}
