/**
 * 报表标签页(metadata.md §4)
 * 工具条(搜索 + 目标系统 + 状态)+ DataTable + 新增/编辑模态(ADS 基表搜索 Select、调度预设 chips)
 * 删除:名称二次确认;运行状态(运行中/已暂停)为前端演示态(localStorage 持久化)
 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { CalendarClock, Pencil, Play, Pause, Plus, Send, Trash2, X } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { Report, ReportListItem, System, TableListItem } from '@/lib/api'
import { createReport, deleteReport, updateReport } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { Avatar } from '@/components/common/Avatar'
import type { Column } from '@/components/common/DataTable'
import { DataTable } from '@/components/common/DataTable'
import { LayerBadge } from '@/components/common/LayerBadge'
import { Modal } from '@/components/common/Modal'
import { StatusBadge } from '@/components/common/StatusBadge'
import { toast } from '@/components/common/Toast'
import { Button } from '@/components/ui/button'
import { ConfirmDeleteModal } from './ConfirmDeleteModal'
import { FieldError, FieldHint, FieldLabel, SearchInput, SelectInput, TextArea, TextInput } from './controls'
import { layerOf } from '@/components/sql/parsePreview'

type Row = ReportListItem & Record<string, unknown>

const PAUSED_KEY = 'lineagehub:paused-report-ids'
const SCHEDULE_PRESET_KEYS = [
  'metadata.reports.schedule.preset1',
  'metadata.reports.schedule.preset2',
  'metadata.reports.schedule.preset3',
  'metadata.reports.schedule.preset4',
]

function loadPaused(): Set<number> {
  try {
    const raw = localStorage.getItem(PAUSED_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown[]
    return new Set(arr.filter((x): x is number => typeof x === 'number'))
  } catch {
    return new Set()
  }
}

export interface ReportsTabProps {
  reports: ReportListItem[]
  systems: System[]
  tables: TableListItem[]
  loading: boolean
  onRefresh: () => void
  deepLink: { systemId?: number } | null
  deepLinkNonce: number
}

export function ReportsTab({ reports, systems, tables, loading, onRefresh, deepLink, deepLinkNonce }: ReportsTabProps) {
  const { t } = useT()
  const [keyword, setKeyword] = useState('')
  const [systemFilter, setSystemFilter] = useState<'all' | number>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'paused'>('all')
  const [paused, setPaused] = useState<Set<number>>(() => loadPaused())
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ReportListItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ReportListItem | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  useEffect(() => {
    if (deepLink?.systemId !== undefined) setSystemFilter(deepLink.systemId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkNonce])

  const statusOf = (r: ReportListItem): 'running' | 'paused' => (paused.has(r.id) ? 'paused' : 'running')

  const togglePaused = (r: ReportListItem) => {
    const next = new Set(paused)
    if (next.has(r.id)) {
      next.delete(r.id)
      toast.success(t('metadata.reports.toast.resumed'), r.name)
    } else {
      next.add(r.id)
      toast.info(t('metadata.reports.toast.paused'), r.name)
    }
    setPaused(next)
    try {
      localStorage.setItem(PAUSED_KEY, JSON.stringify(Array.from(next)))
    } catch {
      // 忽略存储失败
    }
  }

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return reports
      .filter((r) => (kw ? r.name.toLowerCase().includes(kw) || r.owner.toLowerCase().includes(kw) : true))
      .filter((r) => (systemFilter === 'all' ? true : r.target_system_id === systemFilter))
      .filter((r) => (statusFilter === 'all' ? true : statusOf(r) === statusFilter))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports, keyword, systemFilter, statusFilter, paused])

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleteLoading(true)
    try {
      await deleteReport(deleteTarget.id)
      toast.success(t('metadata.reports.toast.deleted'), deleteTarget.name)
      setDeleteTarget(null)
      onRefresh()
    } catch (err) {
      toast.error(
        t('metadata.toast.deleteFailed'),
        err instanceof Error ? err.message : t('metadata.toast.requestFailed'),
      )
    } finally {
      setDeleteLoading(false)
    }
  }

  const columns: Column<Row>[] = [
    {
      key: 'name',
      title: t('metadata.reports.col.name'),
      render: (row) => (
        <span>
          <span className="block text-[13px] font-semibold text-slate-900">{row.name}</span>
          <span className="block max-w-[220px] truncate text-[11px] text-slate-400" title={row.description}>
            {row.description || '—'}
          </span>
        </span>
      ),
    },
    {
      key: 'table_name',
      title: t('metadata.reports.col.table'),
      render: (row) => (
        <span className="flex items-center gap-2">
          <LayerBadge layer={layerOf(row.table_name)} />
          <Link
            to={`/lineage?table=${encodeURIComponent(row.table_name)}`}
            className="font-mono text-[13px] text-primary-600 hover:underline underline-offset-4"
          >
            {row.table_name}
          </Link>
        </span>
      ),
    },
    {
      key: 'target_system_name',
      title: t('metadata.reports.col.target'),
      render: (row) => (
        <span className="flex items-center gap-1.5">
          <Send className="size-3 text-slate-400" />
          <span>{row.target_system_name}</span>
        </span>
      ),
    },
    {
      key: 'owner',
      title: t('metadata.field.owner'),
      render: (row) => (
        <span className="flex items-center gap-1.5">
          <Avatar name={row.owner || '?'} size={24} />
          <span>{row.owner || '—'}</span>
        </span>
      ),
    },
    {
      key: 'schedule',
      title: t('metadata.reports.col.schedule'),
      render: (row) => (
        <span className="flex items-center gap-1.5">
          <CalendarClock className="size-3 text-slate-400" />
          <span className="font-mono text-xs text-slate-700">{row.schedule || '—'}</span>
        </span>
      ),
    },
    {
      key: 'status',
      title: t('metadata.field.status'),
      width: 92,
      render: (row) => <StatusBadge status={statusOf(row)} />,
    },
    {
      key: 'actions',
      title: t('metadata.field.actions'),
      width: 116,
      align: 'right',
      render: (row) => (
        <span className="flex items-center justify-end gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('common.button.edit')}
            onClick={() => {
              setEditing(row)
              setModalOpen(true)
            }}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={statusOf(row) === 'running' ? t('metadata.reports.pause') : t('metadata.reports.resume')}
            onClick={() => togglePaused(row)}
          >
            {statusOf(row) === 'running' ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={t('common.button.delete')} onClick={() => setDeleteTarget(row)}>
            <Trash2 className="size-3.5" />
          </Button>
        </span>
      ),
    },
  ]

  const hasFilter = keyword.trim() !== '' || systemFilter !== 'all' || statusFilter !== 'all'
  const targetSystems = systems.filter((s) => s.kind === 'target' || s.kind === 'both')
  const adsTables = tables.filter((t) => t.layer === 'ads')

  return (
    <div>
      {/* 工具条 */}
      <div className="mb-3 flex items-center gap-2">
        <SearchInput value={keyword} onChange={setKeyword} placeholder={t('metadata.reports.searchPlaceholder')} className="w-60" />
        <SelectInput
          value={String(systemFilter)}
          onChange={(e) => setSystemFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          className="w-36"
        >
          <option value="all">{t('metadata.reports.filter.allTargets')}</option>
          {targetSystems.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectInput>
        <SelectInput
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'running' | 'paused')}
          className="w-28"
        >
          <option value="all">{t('metadata.reports.filter.allStatus')}</option>
          <option value="running">{t('common.status.running')}</option>
          <option value="paused">{t('common.status.paused')}</option>
        </SelectInput>
        <div className="ml-auto">
          <Button
            onClick={() => {
              setEditing(null)
              setModalOpen(true)
            }}
          >
            <Plus className="size-3.5" />
            {t('metadata.reports.add')}
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filtered as Row[]}
        rowKey={(row) => row.id}
        loading={loading}
        emptyImage="/empty-table.svg"
        emptyTitle={hasFilter ? t('metadata.reports.empty.title') : t('metadata.reports.empty.noneTitle')}
        emptyDescription={hasFilter ? t('metadata.empty.filterDesc') : t('metadata.reports.empty.noneDesc')}
        footer={
          hasFilter && filtered.length !== reports.length
            ? t('metadata.table.filteredTotal', { filtered: filtered.length, total: reports.length })
            : t('common.table.total', { count: filtered.length })
        }
      />

      <ReportModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editing={editing}
        adsTables={adsTables}
        targetSystems={targetSystems}
        onSaved={onRefresh}
      />

      <ConfirmDeleteModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={t('metadata.reports.delete.title')}
        description={
          deleteTarget && (
            <>
              {t('metadata.reports.delete.confirmPre')}
              <span className="font-medium text-slate-900">{deleteTarget.name}</span>
              {t('metadata.reports.delete.confirmPost')}
            </>
          )
        }
        confirmName={deleteTarget?.name}
        onConfirm={() => void handleDelete()}
        loading={deleteLoading}
      />
    </div>
  )
}

// ---------- 新增 / 编辑报表模态 ----------

function ReportModal({
  open,
  onClose,
  editing,
  adsTables,
  targetSystems,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  editing: ReportListItem | null
  adsTables: TableListItem[]
  targetSystems: System[]
  onSaved: () => void
}) {
  const { t } = useT()
  const [name, setName] = useState('')
  const [tableId, setTableId] = useState<number | null>(null)
  const [tableQuery, setTableQuery] = useState('')
  const [comboOpen, setComboOpen] = useState(false)
  const [targetSystemId, setTargetSystemId] = useState<number | null>(null)
  const [owner, setOwner] = useState('')
  const [ownerContact, setOwnerContact] = useState('')
  const [schedule, setSchedule] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [presetBump, setPresetBump] = useState(0)

  useEffect(() => {
    if (!open) return
    setName(editing?.name ?? '')
    setTableId(editing?.table_id ?? null)
    setTableQuery('')
    setComboOpen(false)
    setTargetSystemId(editing?.target_system_id ?? null)
    setOwner(editing?.owner ?? '')
    setOwnerContact(editing?.owner_contact ?? '')
    setSchedule(editing?.schedule ?? '')
    setDescription(editing?.description ?? '')
    setErrors({})
  }, [open, editing])

  const selectedTable = adsTables.find((t) => t.id === tableId) ?? null
  const filteredTables = useMemo(() => {
    const kw = tableQuery.trim().toLowerCase()
    return kw ? adsTables.filter((t) => t.name.toLowerCase().includes(kw)) : adsTables
  }, [adsTables, tableQuery])

  const handleSave = async () => {
    const next: Record<string, string> = {}
    if (!name.trim()) next.name = t('metadata.reports.modal.errorName')
    if (tableId === null) next.table = t('metadata.reports.modal.errorTable')
    if (targetSystemId === null) next.system = t('metadata.reports.modal.errorSystem')
    if (!owner.trim()) next.owner = t('metadata.reports.modal.errorOwner')
    if (!schedule.trim()) next.schedule = t('metadata.reports.modal.errorSchedule')
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setSaving(true)
    try {
      const payload: Omit<Report, 'id'> = {
        name: name.trim(),
        table_id: tableId as number,
        target_system_id: targetSystemId as number,
        owner: owner.trim(),
        owner_contact: ownerContact.trim(),
        schedule: schedule.trim(),
        description: description.trim(),
      }
      if (editing) {
        await updateReport(editing.id, payload)
      } else {
        await createReport(payload)
      }
      toast.success(t('metadata.reports.toast.saved'), t('metadata.reports.toast.savedDesc'))
      onSaved()
      onClose()
    } catch (err) {
      toast.error(
        t('metadata.toast.saveFailed'),
        err instanceof Error ? err.message : t('metadata.toast.retryLater'),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? t('metadata.reports.modal.editTitle', { name: editing.name }) : t('metadata.reports.add')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.button.cancel')}
          </Button>
          <Button onClick={() => void handleSave()} loading={saving}>
            {saving ? t('metadata.button.saving') : t('common.button.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <FieldLabel required>{t('metadata.reports.col.name')}</FieldLabel>
          <TextInput
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setErrors((p) => ({ ...p, name: '' }))
            }}
            placeholder={t('metadata.reports.modal.namePlaceholder')}
            error={!!errors.name}
          />
          <FieldError>{errors.name}</FieldError>
        </div>

        {/* 基表(搜索 Select,仅 ADS 层) */}
        <div>
          <FieldLabel required>{t('metadata.reports.col.table')}</FieldLabel>
          <div className="relative">
            <button
              type="button"
              onClick={() => setComboOpen((v) => !v)}
              className={cn(
                'flex h-8 w-full items-center gap-2 rounded-md border bg-white px-2.5 text-left text-[13px] outline-none transition-colors focus:ring-2 focus:ring-[rgba(13,148,136,0.30)]',
                errors.table ? 'border-danger' : 'border-slate-300 focus:border-primary-600',
              )}
            >
              {selectedTable ? (
                <>
                  <LayerBadge layer="ads" />
                  <span className="font-mono text-slate-900">{selectedTable.name}</span>
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={t('metadata.reports.modal.clearTable')}
                    onClick={(e) => {
                      e.stopPropagation()
                      setTableId(null)
                    }}
                    className="ml-auto rounded p-0.5 text-slate-400 hover:text-slate-900"
                  >
                    <X className="size-3" />
                  </span>
                </>
              ) : (
                <span className="text-slate-400">{t('metadata.reports.modal.tablePlaceholder')}</span>
              )}
            </button>
            {comboOpen && (
              <>
                <button type="button" aria-label={t('common.close')} className="fixed inset-0 z-10 cursor-default" onClick={() => setComboOpen(false)} />
                <div className="absolute inset-x-0 top-9 z-20 rounded-md border border-slate-200 bg-white py-1 shadow-overlay">
                  <div className="border-b border-slate-100 px-2 py-1">
                    <input
                      autoFocus
                      value={tableQuery}
                      onChange={(e) => setTableQuery(e.target.value)}
                      placeholder={t('metadata.reports.modal.tableFilter')}
                      className="h-7 w-full rounded border border-slate-200 bg-slate-50 px-2 font-mono text-xs outline-none focus:border-primary-600"
                    />
                  </div>
                  <div className="max-h-44 overflow-y-auto">
                    {filteredTables.length === 0 ? (
                      <p className="px-3 py-3 text-center text-xs text-slate-400">{t('metadata.reports.modal.noTable')}</p>
                    ) : (
                      filteredTables.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            setTableId(t.id)
                            setComboOpen(false)
                            setErrors((p) => ({ ...p, table: '' }))
                          }}
                          className={cn(
                            'flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-slate-50',
                            tableId === t.id && 'bg-primary-50',
                          )}
                        >
                          <LayerBadge layer="ads" />
                          <span className="font-mono text-[13px] text-slate-900">{t.name}</span>
                          <span className="ml-auto text-xs text-slate-400">{t.owner || '—'}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          <FieldError>{errors.table}</FieldError>
          <FieldHint>{t('metadata.reports.modal.tableHint')}</FieldHint>
        </div>

        <div>
          <FieldLabel required>{t('metadata.reports.col.target')}</FieldLabel>
          <SelectInput
            value={targetSystemId === null ? '' : String(targetSystemId)}
            onChange={(e) => {
              setTargetSystemId(e.target.value ? Number(e.target.value) : null)
              setErrors((p) => ({ ...p, system: '' }))
            }}
            className={errors.system ? 'border-danger' : undefined}
          >
            <option value="">{t('metadata.reports.modal.systemPlaceholder')}</option>
            {targetSystems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectInput>
          <FieldError>{errors.system}</FieldError>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel required>{t('metadata.reports.modal.owner')}</FieldLabel>
            <TextInput
              value={owner}
              onChange={(e) => {
                setOwner(e.target.value)
                setErrors((p) => ({ ...p, owner: '' }))
              }}
              placeholder={t('metadata.field.ownerPlaceholder')}
              error={!!errors.owner}
            />
            <FieldError>{errors.owner}</FieldError>
          </div>
          <div>
            <FieldLabel>{t('metadata.reports.modal.ownerContact')}</FieldLabel>
            <TextInput value={ownerContact} onChange={(e) => setOwnerContact(e.target.value)} placeholder={t('metadata.field.contactPlaceholder')} mono />
          </div>
        </div>

        <div>
          <FieldLabel required>{t('metadata.reports.col.schedule')}</FieldLabel>
          <motion.div
            key={presetBump}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
          >
            <TextInput
              value={schedule}
              onChange={(e) => {
                setSchedule(e.target.value)
                setErrors((p) => ({ ...p, schedule: '' }))
              }}
              placeholder={t('metadata.reports.modal.schedulePlaceholder')}
              error={!!errors.schedule}
            />
          </motion.div>
          <FieldError>{errors.schedule}</FieldError>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SCHEDULE_PRESET_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setSchedule(t(key))
                  setPresetBump((b) => b + 1)
                  setErrors((prev) => ({ ...prev, schedule: '' }))
                }}
                className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-500 transition-colors duration-120 hover:border-primary-600 hover:text-primary-700"
              >
                {t(key)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <FieldLabel>{t('metadata.field.description')}</FieldLabel>
          <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder={t('metadata.reports.modal.descPlaceholder')} />
        </div>
      </div>
    </Modal>
  )
}
