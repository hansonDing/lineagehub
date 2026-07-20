/**
 * 元数据配置页共享表单控件(metadata.md + design.md §9.8)
 * Label 13px 500 #334155,必填 * 红;输入高 32px 边框 #CBD5E1 圆角 6px;
 * focus:边框 #0D9488 + 2px 环 rgba(13,148,136,0.30);错误:边框 #DC2626 + 12px 红字
 */

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export function FieldLabel({ children, required, className }: { children: ReactNode; required?: boolean; className?: string }) {
  return (
    <label className={cn('mb-1.5 block text-[13px] font-medium text-slate-700', className)}>
      {children}
      {required && <span className="ml-0.5 text-danger">*</span>}
    </label>
  )
}

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null
  return <p className="mt-1 text-xs text-danger">{children}</p>
}

export function FieldHint({ children }: { children?: ReactNode }) {
  if (!children) return null
  return <p className="mt-1 text-xs text-slate-500">{children}</p>
}

const baseInput =
  'h-8 w-full rounded-md border bg-white px-2.5 text-[13px] text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:ring-2 focus:ring-[rgba(13,148,136,0.30)] disabled:bg-slate-50 disabled:text-slate-500'

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
  mono?: boolean
}

export function TextInput({ error, mono, className, ...props }: TextInputProps) {
  return (
    <input
      {...props}
      className={cn(
        baseInput,
        error ? 'border-danger focus:border-danger' : 'border-slate-300 focus:border-primary-600',
        mono && 'font-mono',
        className,
      )}
    />
  )
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean
  mono?: boolean
}

export function TextArea({ error, mono, className, ...props }: TextAreaProps) {
  return (
    <textarea
      {...props}
      className={cn(
        'w-full rounded-md border bg-white px-2.5 py-1.5 text-[13px] text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:ring-2 focus:ring-[rgba(13,148,136,0.30)]',
        error ? 'border-danger focus:border-danger' : 'border-slate-300 focus:border-primary-600',
        mono && 'font-mono',
        className,
      )}
    />
  )
}

export function SelectInput({ children, className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        baseInput,
        'border-slate-300 focus:border-primary-600',
        className,
      )}
    >
      {children}
    </select>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-md border border-slate-300 bg-white pl-8 pr-2.5 text-[13px] outline-none transition-colors placeholder:text-slate-400 focus:border-primary-600 focus:ring-2 focus:ring-[rgba(13,148,136,0.30)]"
      />
    </div>
  )
}
