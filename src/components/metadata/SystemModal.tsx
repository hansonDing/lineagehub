/**
 * 新增 / 编辑业务系统模态(metadata.md §2.3)
 * 560px 表单:名称* / 英文代号(自动派生只读)/ 类型*(单选卡片行)/ 负责人* / 联系方式 / 描述
 */

import { useEffect, useState } from 'react'
import { ArrowLeftRight, Send, Server } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { System, SystemKind } from '@/lib/api'
import { createSystem, updateSystem } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { Modal } from '@/components/common/Modal'
import { toast } from '@/components/common/Toast'
import { Button } from '@/components/ui/button'
import { FieldError, FieldHint, FieldLabel, TextArea, TextInput } from './controls'
import { systemCode } from './systemCode'

const KIND_OPTIONS: { value: SystemKind; labelKey: string; descKey: string; icon: typeof Server }[] = [
  { value: 'source', labelKey: 'metadata.systems.kind.source', descKey: 'metadata.systems.kind.sourceDesc', icon: Server },
  { value: 'target', labelKey: 'metadata.systems.kind.target', descKey: 'metadata.systems.kind.targetDesc', icon: Send },
  { value: 'both', labelKey: 'metadata.systems.kind.both', descKey: 'metadata.systems.kind.bothDesc', icon: ArrowLeftRight },
]

export interface SystemModalProps {
  open: boolean
  onClose: () => void
  /** null = 新增;否则编辑该系统 */
  editing: System | null
  onSaved: () => void
}

export function SystemModal({ open, onClose, editing, onSaved }: SystemModalProps) {
  const { t } = useT()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<SystemKind>('source')
  const [owner, setOwner] = useState('')
  const [contact, setContact] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<{ name?: string; owner?: string }>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(editing?.name ?? '')
    setKind(editing?.kind ?? 'source')
    setOwner(editing?.owner ?? '')
    setContact(editing?.contact ?? '')
    setDescription(editing?.description ?? '')
    setErrors({})
  }, [open, editing])

  const handleSave = async () => {
    const next: { name?: string; owner?: string } = {}
    if (!name.trim()) next.name = t('metadata.systems.modal.errorName')
    if (!owner.trim()) next.owner = t('metadata.field.errorOwner')
    setErrors(next)
    if (next.name || next.owner) return
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        kind,
        owner: owner.trim(),
        contact: contact.trim(),
        description: description.trim(),
      }
      if (editing) {
        await updateSystem(editing.id, payload)
      } else {
        await createSystem(payload)
      }
      toast.success(t('metadata.systems.toast.saved'), name.trim())
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
      title={editing ? t('metadata.systems.modal.editTitle', { name: editing.name }) : t('metadata.systems.modal.addTitle')}
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
          <FieldLabel required>{t('metadata.systems.col.name')}</FieldLabel>
          <TextInput
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setErrors((p) => ({ ...p, name: undefined }))
            }}
            placeholder={t('metadata.systems.modal.namePlaceholder')}
            error={!!errors.name}
          />
          <FieldError>{errors.name}</FieldError>
        </div>

        <div>
          <FieldLabel>{t('metadata.systems.modal.code')}</FieldLabel>
          <TextInput
            value={systemCode(name.trim())}
            placeholder={t('metadata.systems.modal.codePlaceholder')}
            mono
            disabled
            readOnly
          />
          <FieldHint>{t('metadata.systems.modal.codeHint')}</FieldHint>
        </div>

        <div>
          <FieldLabel required>{t('metadata.systems.modal.kind')}</FieldLabel>
          <div className="grid grid-cols-3 gap-2">
            {KIND_OPTIONS.map((opt) => {
              const active = kind === opt.value
              const Icon = opt.icon
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setKind(opt.value)}
                  className={cn(
                    'flex h-14 items-center gap-2 rounded-md border px-3 text-left transition-colors duration-150',
                    active ? 'border-primary-600 bg-primary-50' : 'border-slate-300 bg-white hover:bg-slate-50',
                  )}
                >
                  <Icon className={cn('size-4 shrink-0', active ? 'text-primary-700' : 'text-slate-400')} />
                  <span className="min-w-0">
                    <span className={cn('block text-[13px] font-medium', active ? 'text-primary-700' : 'text-slate-900')}>
                      {t(opt.labelKey)}
                    </span>
                    <span className="block truncate text-[11px] text-slate-400">{t(opt.descKey)}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <FieldLabel required>{t('metadata.field.owner')}</FieldLabel>
          <TextInput
            value={owner}
            onChange={(e) => {
              setOwner(e.target.value)
              setErrors((p) => ({ ...p, owner: undefined }))
            }}
            placeholder={t('metadata.systems.modal.ownerPlaceholder')}
            error={!!errors.owner}
          />
          <FieldError>{errors.owner}</FieldError>
        </div>

        <div>
          <FieldLabel>{t('metadata.field.contact')}</FieldLabel>
          <TextInput value={contact} onChange={(e) => setContact(e.target.value)} placeholder={t('metadata.field.contactPlaceholder')} mono />
        </div>

        <div>
          <FieldLabel>{t('metadata.field.description')}</FieldLabel>
          <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder={t('metadata.systems.modal.descPlaceholder')} />
        </div>
      </div>
    </Modal>
  )
}
