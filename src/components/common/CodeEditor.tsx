import type { ReactNode } from 'react'
import { useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * CodeEditor SQL/DDL 代码编辑区(design.md §9.9)
 * 深色底 #0B1220,圆角 8px,边框 #1E293B;等宽 13px/21px;行号列宽 40px;
 * 语法高亮:关键字 #7DD3FC、表名 #5EEAD4、字符串 #FCD34D、注释 #64748B、函数 #C4B5FD;
 * 底部状态条高 28px;支持只读展示与 diff 行态(新增绿底 + / 删除红底 -)
 */

const KEYWORDS = new Set([
  'select', 'from', 'where', 'join', 'left', 'right', 'inner', 'outer', 'full', 'cross',
  'on', 'group', 'by', 'order', 'having', 'limit', 'insert', 'overwrite', 'into', 'table',
  'create', 'view', 'as', 'with', 'union', 'all', 'distinct', 'case', 'when', 'then', 'else',
  'end', 'and', 'or', 'not', 'null', 'is', 'in', 'exists', 'between', 'like', 'if', 'drop',
  'alter', 'add', 'columns', 'change', 'comment', 'partitioned', 'using', 'stored', 'location',
  'tblproperties', 'replace', 'asc', 'desc', 'lateral', 'explode', 'distribute', 'sort', 'cluster',
])

const FUNCTIONS = new Set([
  'count', 'sum', 'avg', 'max', 'min', 'coalesce', 'nvl', 'ifnull', 'cast', 'date_trunc',
  'date_format', 'to_date', 'datediff', 'date_add', 'date_sub', 'current_date', 'current_timestamp',
  'row_number', 'rank', 'dense_rank', 'lead', 'lag', 'concat', 'concat_ws', 'substr', 'substring',
  'trim', 'upper', 'lower', 'round', 'floor', 'ceil', 'abs', 'collect_set', 'collect_list',
  'first', 'last', 'approx_count_distinct', 'from_unixtime', 'unix_timestamp', 'split', 'get_json_object',
])

const TOKEN_RE =
  /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^'\\]|\\.)*')|(`[^`]*`)|(\b\d+(?:\.\d+)?\b)|([a-zA-Z_][\w$]*(?:\.[a-zA-Z_][\w$]*)+)|([a-zA-Z_][\w$]*)|(\s+|.)/g

/** SQL 轻量语法高亮 → React 节点数组 */
export function highlightSql(sql: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let match: RegExpExecArray | null
  let key = 0
  TOKEN_RE.lastIndex = 0
  while ((match = TOKEN_RE.exec(sql)) !== null) {
    const [text, comment, str, backtick, num, qualified, word, plain] = match
    if (comment) {
      nodes.push(<span key={key++} style={{ color: '#64748B' }}>{text}</span>)
    } else if (str || backtick) {
      nodes.push(<span key={key++} style={{ color: '#FCD34D' }}>{text}</span>)
    } else if (num) {
      nodes.push(<span key={key++} style={{ color: '#E2E8F0' }}>{text}</span>)
    } else if (qualified) {
      // db.table 形式 → 表名色
      nodes.push(<span key={key++} style={{ color: '#5EEAD4' }}>{text}</span>)
    } else if (word) {
      const lower = word.toLowerCase()
      if (KEYWORDS.has(lower)) {
        nodes.push(<span key={key++} style={{ color: '#7DD3FC' }}>{text}</span>)
      } else if (FUNCTIONS.has(lower)) {
        nodes.push(<span key={key++} style={{ color: '#C4B5FD' }}>{text}</span>)
      } else {
        nodes.push(<span key={key++} style={{ color: '#CBD5E1' }}>{text}</span>)
      }
    } else if (plain) {
      nodes.push(<span key={key++} style={{ color: '#93A4BC' }}>{text}</span>)
    }
  }
  return nodes
}

export type DiffLineState = 'added' | 'removed' | 'context'

export interface DiffLine {
  text: string
  state: DiffLineState
}

const LINE_HEIGHT = 21

function LineNumbers({ count, diff }: { count: number; diff?: DiffLine[] }) {
  return (
    <div
      aria-hidden
      className="w-10 shrink-0 select-none border-r border-[#1E293B] pr-2 text-right text-[#475569]"
      style={{ lineHeight: `${LINE_HEIGHT}px` }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-baseline justify-end gap-1 text-[13px]">
          {diff?.[i]?.state === 'added' && <span className="text-success">+</span>}
          {diff?.[i]?.state === 'removed' && <span className="text-danger">-</span>}
          <span>{i + 1}</span>
        </div>
      ))}
    </div>
  )
}

function StatusBar({ line, column }: { line: number; column: number }) {
  return (
    <div className="flex h-7 shrink-0 items-center justify-between rounded-b-lg border-t border-[#1E293B] bg-slate-900 px-3 text-[11px] text-slate-500">
      <span>Spark SQL · sqlglot 解析</span>
      <span className="font-mono">
        行 {line},列 {column} · UTF-8
      </span>
    </div>
  )
}

export interface CodeEditorProps {
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  /** diff 展示模式:行级新增/删除高亮(强制只读) */
  diffLines?: DiffLine[]
  placeholder?: string
  className?: string
  /** 编辑区最小高度 */
  minHeight?: number
}

export function CodeEditor({
  value,
  onChange,
  readOnly,
  diffLines,
  placeholder,
  className,
  minHeight = 160,
}: CodeEditorProps) {
  const preRef = useRef<HTMLPreElement>(null)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const isDiff = !!diffLines
  const isEditable = !readOnly && !isDiff && !!onChange

  const lines = useMemo(() => (isDiff ? diffLines : value.split('\n')), [isDiff, diffLines, value])
  const highlighted = useMemo(() => highlightSql(value), [value])

  const syncScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    if (preRef.current) {
      preRef.current.scrollTop = el.scrollTop
      preRef.current.scrollLeft = el.scrollLeft
    }
  }

  const updateCursor = (el: HTMLTextAreaElement) => {
    const pos = el.selectionStart ?? 0
    const before = el.value.slice(0, pos)
    const line = before.split('\n').length
    const column = pos - before.lastIndexOf('\n')
    setCursor({ line, column })
  }

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-lg border border-[#1E293B] bg-editor font-mono text-[13px]',
        className,
      )}
    >
      <div className="flex min-h-0 flex-1 overflow-auto" style={{ minHeight }}>
        <LineNumbers
          count={lines.length}
          diff={isDiff ? diffLines : undefined}
        />
        {isDiff ? (
          <pre className="flex-1 p-0 pl-3" style={{ lineHeight: `${LINE_HEIGHT}px` }}>
            {diffLines.map((line, i) => (
              <div
                key={i}
                style={{
                  backgroundColor:
                    line.state === 'added'
                      ? 'rgba(22,163,74,0.12)'
                      : line.state === 'removed'
                        ? 'rgba(220,38,38,0.12)'
                        : undefined,
                }}
                className="whitespace-pre-wrap pr-3"
              >
                {highlightSql(line.text)}
              </div>
            ))}
          </pre>
        ) : (
          <div className="relative flex-1">
            <pre
              ref={preRef}
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-all pl-3 pr-3"
              style={{ lineHeight: `${LINE_HEIGHT}px` }}
            >
              {highlighted}
              {'\n'}
            </pre>
            {isEditable ? (
              <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onScroll={syncScroll}
                onSelect={(e) => updateCursor(e.currentTarget)}
                onKeyUp={(e) => updateCursor(e.currentTarget)}
                onClick={(e) => updateCursor(e.currentTarget)}
                placeholder={placeholder}
                spellCheck={false}
                className="relative block h-full min-h-full w-full resize-none bg-transparent pl-3 pr-3 text-transparent caret-[#5EEAD4] outline-none placeholder:text-slate-500"
                style={{ lineHeight: `${LINE_HEIGHT}px`, minHeight }}
              />
            ) : (
              <pre
                className="relative whitespace-pre-wrap break-all pl-3 pr-3 text-[#CBD5E1]"
                style={{ lineHeight: `${LINE_HEIGHT}px` }}
              >
                {highlighted}
              </pre>
            )}
          </div>
        )}
      </div>
      <StatusBar line={cursor.line} column={cursor.column} />
    </div>
  )
}
