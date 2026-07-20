/**
 * 删除确认模态(design.md §9.6:危险操作红标题;删除系统/报表需输入名称二次确认)
 */

import type { ReactNode } from 'react'
import { useState } from 'react'
import { Modal } from '@/components/common/Modal'
import { Button } from '@/components/ui/button'
import { TextInput } from './controls'

export interface ConfirmDeleteModalProps {
  open: boolean
  onClose: () => void
  title: string
  description: ReactNode
  /** 二次确认要求输入的名称;传入后必须完全匹配才能删除 */
  confirmName?: string
  onConfirm: () => void
  loading?: boolean
}

export function ConfirmDeleteModal({
  open,
  onClose,
  title,
  description,
  confirmName,
  onConfirm,
  loading,
}: ConfirmDeleteModalProps) {
  const [typed, setTyped] = useState('')
  // 打开时重置输入(渲染期派生重置,避免 effect 级联渲染)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setTyped('')
  }

  const needConfirm = !!confirmName
  const matched = !needConfirm || typed.trim() === confirmName

  return (
    <Modal
      open={open}
      onClose={onClose}
      danger
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={!matched} loading={loading}>
            确认删除
          </Button>
        </>
      }
    >
      <div className="text-[13px] leading-6 text-slate-700">{description}</div>
      {needConfirm && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs text-slate-500">
            请输入 <span className="font-medium text-slate-900">{confirmName}</span> 以确认删除
          </p>
          <TextInput
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={confirmName}
            autoFocus
          />
        </div>
      )}
    </Modal>
  )
}
