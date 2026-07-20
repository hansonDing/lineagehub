/**
 * 新增 / 编辑业务系统模态(metadata.md §2.3)
 * 560px 表单:名称* / 英文代号(自动派生只读)/ 类型*(单选卡片行)/ 负责人* / 联系方式 / 描述
 */

import { useEffect, useState } from 'react'
import { ArrowLeftRight, Send, Server } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { System, SystemKind } from '@/lib/api'
import { createSystem, updateSystem } from '@/lib/api'
import { Modal } from '@/components/common/Modal'
import { toast } from '@/components/common/Toast'
import { Button } from '@/components/ui/button'
import { FieldError, FieldHint, FieldLabel, TextArea, TextInput } from './controls'
import { systemCode } from './systemCode'

const KIND_OPTIONS: { value: SystemKind; label: string; desc: string; icon: typeof Server }[] = [
  { value: 'source', label: '源系统', desc: '数据的来源', icon: Server },
  { value: 'target', label: '目标系统', desc: '报表的去向', icon: Send },
  { value: 'both', label: '双向', desc: '既作来源也作目标', icon: ArrowLeftRight },
]

export interface SystemModalProps {
  open: boolean
  onClose: () => void
  /** null = 新增;否则编辑该系统 */
  editing: System | null
  onSaved: () => void
}

export function SystemModal({ open, onClose, editing, onSaved }: SystemModalProps) {
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
    if (!name.trim()) next.name = '请填写系统名称'
    if (!owner.trim()) next.owner = '请填写负责人'
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
      toast.success('系统已保存', name.trim())
      onSaved()
      onClose()
    } catch (err) {
      toast.error('保存失败', err instanceof Error ? err.message : '请刷新后重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `编辑系统 · ${editing.name}` : '新增业务系统'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void handleSave()} loading={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <FieldLabel required>系统名称</FieldLabel>
          <TextInput
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setErrors((p) => ({ ...p, name: undefined }))
            }}
            placeholder="订单中心"
            error={!!errors.name}
          />
          <FieldError>{errors.name}</FieldError>
        </div>

        <div>
          <FieldLabel>英文代号</FieldLabel>
          <TextInput
            value={systemCode(name.trim())}
            placeholder="保存后自动生成"
            mono
            disabled
            readOnly
          />
          <FieldHint>根据系统名称自动派生,用于血缘与日志标识</FieldHint>
        </div>

        <div>
          <FieldLabel required>系统类型</FieldLabel>
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
                      {opt.label}
                    </span>
                    <span className="block truncate text-[11px] text-slate-400">{opt.desc}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <FieldLabel required>负责人</FieldLabel>
          <TextInput
            value={owner}
            onChange={(e) => {
              setOwner(e.target.value)
              setErrors((p) => ({ ...p, owner: undefined }))
            }}
            placeholder="赵六"
            error={!!errors.owner}
          />
          <FieldError>{errors.owner}</FieldError>
        </div>

        <div>
          <FieldLabel>联系方式</FieldLabel>
          <TextInput value={contact} onChange={(e) => setContact(e.target.value)} placeholder="邮箱或 IM" mono />
        </div>

        <div>
          <FieldLabel>描述</FieldLabel>
          <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="交易订单业务库" />
        </div>
      </div>
    </Modal>
  )
}
