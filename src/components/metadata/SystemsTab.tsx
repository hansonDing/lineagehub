/**
 * 业务系统标签页(metadata.md §2)
 * 工具条(搜索 + 类型筛选 + 新增系统)+ DataTable + 删除保护(被引用时不可删)
 */

import { useMemo, useState } from 'react'
import { AlertCircle, ArrowLeftRight, Copy, Pencil, Plus, Send, Server, Trash2 } from 'lucide-react'
import type { ReportListItem, System, SystemKind, TableListItem } from '@/lib/api'
import { deleteSystem } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { Avatar } from '@/components/common/Avatar'
import type { Column } from '@/components/common/DataTable'
import { DataTable } from '@/components/common/DataTable'
import { Modal } from '@/components/common/Modal'
import { toast } from '@/components/common/Toast'
import { Button } from '@/components/ui/button'
import { ConfirmDeleteModal } from './ConfirmDeleteModal'
import { SearchInput, SelectInput } from './controls'
import { systemCode } from './systemCode'
import { SystemModal } from './SystemModal'

type Row = System & Record<string, unknown>

function KindBadge({ kind }: { kind: SystemKind }) {
  const { t } = useT()
  if (kind === 'source') {
    return (
      <span className="inline-flex h-5 items-center gap-1 rounded bg-primary-50 px-1.5 text-[11px] font-medium text-primary-700">
        <Server className="size-3" />
        {t('metadata.systems.kind.source')}
      </span>
    )
  }
  if (kind === 'target') {
    return (
      <span
        className="inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] font-medium"
        style={{ backgroundColor: 'rgba(201,162,63,0.12)', color: '#92700F' }}
      >
        <Send className="size-3" />
        {t('metadata.systems.kind.target')}
      </span>
    )
  }
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded bg-slate-100 px-1.5 text-[11px] font-medium text-slate-600">
      <ArrowLeftRight className="size-3" />
      {t('metadata.systems.kind.both')}
    </span>
  )
}

export interface SystemsTabProps {
  systems: System[]
  tables: TableListItem[]
  reports: ReportListItem[]
  loading: boolean
  onRefresh: () => void
  onNavigateToTables: (systemId: number) => void
  onNavigateToReports: (systemId: number) => void
}

export function SystemsTab({
  systems,
  tables,
  reports,
  loading,
  onRefresh,
  onNavigateToTables,
  onNavigateToReports,
}: SystemsTabProps) {
  const { t } = useT()
  const [keyword, setKeyword] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | SystemKind>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<System | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<System | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const tableCountBySystem = useMemo(() => {
    const map = new Map<number, number>()
    for (const t of tables) {
      if (t.source_system_id !== null) map.set(t.source_system_id, (map.get(t.source_system_id) ?? 0) + 1)
    }
    return map
  }, [tables])

  const reportCountBySystem = useMemo(() => {
    const map = new Map<number, number>()
    for (const r of reports) map.set(r.target_system_id, (map.get(r.target_system_id) ?? 0) + 1)
    return map
  }, [reports])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return systems
      .filter((s) => (kindFilter === 'all' ? true : s.kind === kindFilter))
      .filter((s) =>
        kw ? s.name.toLowerCase().includes(kw) || s.owner.toLowerCase().includes(kw) : true,
      )
  }, [systems, keyword, kindFilter])

  const referencedCounts = (s: System) => ({
    tables: tableCountBySystem.get(s.id) ?? 0,
    reports: reportCountBySystem.get(s.id) ?? 0,
  })

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleteLoading(true)
    try {
      await deleteSystem(deleteTarget.id)
      toast.success(t('metadata.systems.toast.deleted'), deleteTarget.name)
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

  const copyContact = async (contact: string) => {
    try {
      await navigator.clipboard.writeText(contact)
      toast.success(t('metadata.systems.toast.copied'), contact)
    } catch {
      toast.error(t('metadata.systems.toast.copyFailed'), t('metadata.systems.toast.copyFailedDesc'))
    }
  }

  const columns: Column<Row>[] = [
    {
      key: 'name',
      title: t('metadata.systems.col.name'),
      render: (row) => (
        <span>
          <span className="block text-[13px] font-semibold text-slate-900">{row.name}</span>
          <span className="block font-mono text-[11px] text-slate-400">{systemCode(row.name, row.id)}</span>
        </span>
      ),
    },
    {
      key: 'kind',
      title: t('metadata.systems.col.kind'),
      width: 100,
      render: (row) => <KindBadge kind={row.kind} />,
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
      key: 'contact',
      title: t('metadata.field.contact'),
      render: (row) =>
        row.contact ? (
          <span className="group flex items-center gap-1">
            <span className="font-mono text-xs text-slate-500">{row.contact}</span>
            <button
              type="button"
              aria-label={t('metadata.systems.copyContact')}
              onClick={() => void copyContact(row.contact)}
              className="text-slate-300 opacity-0 transition-opacity duration-120 hover:text-slate-600 group-hover:opacity-100"
            >
              <Copy className="size-3" />
            </button>
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      key: 'tables',
      title: t('metadata.systems.col.tables'),
      width: 76,
      render: (row) => {
        const n = tableCountBySystem.get(row.id) ?? 0
        return (
          <button
            type="button"
            onClick={() => n > 0 && onNavigateToTables(row.id)}
            className={
              n > 0
                ? 'font-mono text-[13px] text-primary-600 hover:underline underline-offset-4'
                : 'font-mono text-[13px] text-slate-500'
            }
          >
            {n}
          </button>
        )
      },
    },
    {
      key: 'reports',
      title: t('metadata.systems.col.reports'),
      width: 84,
      render: (row) => {
        const n = reportCountBySystem.get(row.id) ?? 0
        return (
          <button
            type="button"
            onClick={() => n > 0 && onNavigateToReports(row.id)}
            className={
              n > 0
                ? 'font-mono text-[13px] text-primary-600 hover:underline underline-offset-4'
                : 'font-mono text-[13px] text-slate-500'
            }
          >
            {n}
          </button>
        )
      },
    },
    {
      key: 'description',
      title: t('metadata.field.description'),
      render: (row) => (
        <span className="block max-w-[220px] truncate text-xs text-slate-500" title={row.description}>
          {row.description || '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      title: t('metadata.field.actions'),
      width: 84,
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
          <Button variant="ghost" size="icon-sm" aria-label={t('common.button.delete')} onClick={() => setDeleteTarget(row)}>
            <Trash2 className="size-3.5" />
          </Button>
        </span>
      ),
    },
  ]

  const hasFilter = keyword.trim() !== '' || kindFilter !== 'all'
  const deletingRef = deleteTarget ? referencedCounts(deleteTarget) : null
  const isReferenced = !!deletingRef && (deletingRef.tables > 0 || deletingRef.reports > 0)

  return (
    <div>
      {/* 工具条 */}
      <div className="mb-3 flex items-center gap-2">
        <SearchInput value={keyword} onChange={setKeyword} placeholder={t('metadata.systems.searchPlaceholder')} className="w-60" />
        <SelectInput value={kindFilter} onChange={(e) => setKindFilter(e.target.value as 'all' | SystemKind)} className="w-32">
          <option value="all">{t('metadata.systems.filter.allKinds')}</option>
          <option value="source">{t('metadata.systems.kind.source')}</option>
          <option value="target">{t('metadata.systems.kind.target')}</option>
          <option value="both">{t('metadata.systems.kind.both')}</option>
        </SelectInput>
        <div className="ml-auto">
          <Button
            onClick={() => {
              setEditing(null)
              setModalOpen(true)
            }}
          >
            <Plus className="size-3.5" />
            {t('metadata.systems.add')}
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filtered as Row[]}
        rowKey={(row) => row.id}
        loading={loading}
        emptyImage="/empty-table.svg"
        emptyTitle={t('metadata.systems.empty.title')}
        emptyDescription={t('metadata.empty.filterDesc')}
        footer={
          hasFilter && filtered.length !== systems.length
            ? t('metadata.table.filteredTotal', { filtered: filtered.length, total: systems.length })
            : t('common.table.total', { count: filtered.length })
        }
      />

      <SystemModal open={modalOpen} onClose={() => setModalOpen(false)} editing={editing} onSaved={onRefresh} />

      {/* 被引用:不可删提示 */}
      <Modal
        open={!!deleteTarget && isReferenced}
        onClose={() => setDeleteTarget(null)}
        danger
        title={
          <span className="flex items-center gap-2">
            <AlertCircle className="size-4" />
            {t('metadata.systems.delete.blocked.title')}
          </span>
        }
        footer={<Button onClick={() => setDeleteTarget(null)}>{t('metadata.systems.delete.blocked.ok')}</Button>}
      >
        {deleteTarget && deletingRef && (
          <p className="text-[13px] leading-6 text-slate-700">
            {t('metadata.systems.delete.blocked.still')}{' '}
            <span className="font-mono font-medium text-danger">{deletingRef.tables}</span>{' '}
            {t('metadata.systems.delete.blocked.tables')} /{' '}
            <span className="font-mono font-medium text-danger">{deletingRef.reports}</span>{' '}
            {t('metadata.systems.delete.blocked.reports', { name: deleteTarget.name })}
          </p>
        )}
      </Modal>

      {/* 未引用:名称二次确认删除 */}
      <ConfirmDeleteModal
        open={!!deleteTarget && !isReferenced}
        onClose={() => setDeleteTarget(null)}
        title={t('metadata.systems.delete.title')}
        description={
          deleteTarget && (
            <>
              {t('metadata.systems.delete.confirmPre')}{' '}
              <span className="font-medium text-slate-900">{deleteTarget.name}</span>
              {t('metadata.systems.delete.confirmPost')}
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
