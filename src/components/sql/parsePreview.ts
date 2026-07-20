/**
 * 本地轻量 SQL 解析(best-effort)
 * 用途:
 *  1. 「解析预览」——不落库,即时给出解析结果(目标表/源表/警告);
 *  2. 解析结果明细展示——语句类型徽标、来源行号、列级映射(后端 ParseResponse 不含这些展示字段)。
 * 口径与后端 sqlglot 解析一致:CREATE TABLE / CTAS / CREATE VIEW / INSERT OVERWRITE|INTO /
 * ALTER TABLE / 裸 SELECT(含 CTE、JOIN、UNION);库表名小写规范化,缺库名归 default;
 * 单条语句解析失败不中断整体解析,记入 warnings。
 */

import type { TableLayer } from '@/lib/api'
import { getLang, translate } from '@/lib/i18n'

export type StatementType = 'CREATE' | 'CTAS' | 'INSERT' | 'SELECT' | 'ALTER' | 'UNKNOWN'

/** 解析警告:文案按生成时语言翻译;code 供结果面板匹配建议文案(backend 警告为 generic) */
export interface ParseWarning {
  text: string
  code: 'no_target' | 'unparseable' | 'syntax' | 'generic'
}

export interface LocalStatement {
  type: StatementType
  target: string | null
  sources: string[]
  /** 1-based 起止行 */
  lineStart: number
  lineEnd: number
}

export interface ColumnMapping {
  /** 目标列名 */
  target: string
  /** 源列(o.order_id 形式,多源逗号分隔;空数组展示 —) */
  sources: string[]
  /** 表达式原文(非简单列引用时),用于「表达式」徽标 */
  expression: string | null
}

export interface LocalParseResult {
  statements: LocalStatement[]
  targets: string[]
  sources: string[]
  columnMappings: ColumnMapping[]
  warnings: ParseWarning[]
  /** 整体失败(没有任何可解析语句) */
  failed: boolean
}

/** 库表名规范化:小写、去反引号,缺库名归 default(与后端 normalize_table_name 一致) */
export function normalizeTableName(name: string): string {
  const cleaned = (name || '').trim().replace(/`/g, '').toLowerCase()
  if (!cleaned) return ''
  const parts = cleaned.split('.').filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return `default.${parts[0]}`
  return parts.slice(-2).join('.')
}

/** 从表名推断分层(库名前缀约定) */
export function layerOf(tableName: string): TableLayer {
  const prefix = tableName.split('.')[0] as TableLayer
  return ['ods', 'dim', 'dwd', 'dws', 'ads'].includes(prefix) ? prefix : 'other'
}

/** 注释与字符串遮蔽(保留换行与字符位置),用于安全地做关键字扫描 */
function maskSql(sql: string): string {
  const out = sql.split('')
  let i = 0
  const n = sql.length
  while (i < n) {
    const c = sql[i]
    const next = sql[i + 1]
    if (c === '-' && next === '-') {
      // 行注释
      while (i < n && sql[i] !== '\n') {
        out[i] = ' '
        i++
      }
    } else if (c === '/' && next === '*') {
      out[i] = ' '
      out[i + 1] = ' '
      i += 2
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) {
        if (sql[i] !== '\n') out[i] = ' '
        i++
      }
      if (i < n) {
        out[i] = ' '
        out[i + 1] = ' '
        i += 2
      }
    } else if (c === "'") {
      out[i] = ' '
      i++
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out[i] = ' '
          out[i + 1] = ' '
          i += 2
          continue
        }
        if (sql[i] === "'") {
          out[i] = ' '
          i++
          break
        }
        if (sql[i] !== '\n') out[i] = ' '
        i++
      }
    } else {
      i++
    }
  }
  return out.join('')
}

interface RawStatement {
  text: string
  lineStart: number
  lineEnd: number
}

/** 按顶层分号切分语句,并记录起止行号 */
function splitStatements(masked: string): RawStatement[] {
  const result: RawStatement[] = []
  let depth = 0
  let start = 0
  let line = 1
  let startLine = 1
  for (let i = 0; i <= masked.length; i++) {
    const c = masked[i]
    if (c === '\n') line++
    if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    if (i === masked.length || (c === ';' && depth === 0)) {
      const text = masked.slice(start, i)
      if (text.trim()) {
        // 前导空白中的换行计入起始行
        const leadWs = /^\s*/.exec(text)?.[0] ?? ''
        const leadLines = (leadWs.match(/\n/g) || []).length
        result.push({ text, lineStart: startLine + leadLines, lineEnd: line })
      }
      start = i + 1
      startLine = line
    }
  }
  return result
}

const TABLE_REF = '[A-Za-z_`][\\w$`]*(?:\\.[A-Za-z_`][\\w$`]*)*'

/** 提取 WITH 后的 CTE 别名列表(在同一语句的单行化文本上) */
function extractCteNames(flat: string): string[] {
  const names: string[] = []
  const m = /^\s*with\s+/i.exec(flat)
  if (!m) return names
  const re = /\s*,?\s*([A-Za-z_]\w*)\s+as\s*\(/gi
  re.lastIndex = m[0].length
  let match: RegExpExecArray | null
  while ((match = re.exec(flat)) !== null) {
    names.push(match[1].toLowerCase())
    // 跳过该 CTE 的平衡括号体
    let depth = 1
    let i = re.lastIndex
    while (i < flat.length && depth > 0) {
      if (flat[i] === '(') depth++
      else if (flat[i] === ')') depth--
      i++
    }
    re.lastIndex = i
    // 下一个 CTE 必须以逗号衔接,否则 CTE 段结束
    if (/^\s*,/.exec(flat.slice(i)) === null) break
  }
  return names
}

/** 扫描语句中的源表引用(FROM / JOIN,含逗号连接的表,排除子查询左括号与 CTE 名) */
function scanSourceTables(flat: string, cteNames: string[], target: string | null): string[] {
  const sources: string[] = []
  const add = (raw: string) => {
    const name = normalizeTableName(raw)
    if (!name) return
    const short = name.split('.').pop() ?? name
    if (cteNames.includes(short)) return
    if (target && name === target) return
    if (!sources.includes(name)) sources.push(name)
  }
  const re = new RegExp(`\\b(?:from|join)\\s+(?!\\s*\\()(${TABLE_REF})`, 'gi')
  let match: RegExpExecArray | null
  while ((match = re.exec(flat)) !== null) {
    add(match[1])
    // 逗号连接的表:FROM a, b, c
    let rest = flat.slice(re.lastIndex)
    for (;;) {
      const cont = new RegExp(`^\\s*(?:as\\s+)?[A-Za-z_]\\w*\\s*,\\s*(${TABLE_REF})`, 'i').exec(rest)
      if (!cont) break
      add(cont[1])
      rest = rest.slice(cont[0].length)
    }
  }
  return sources
}

/** 顶层关键字定位(忽略括号内的同名关键字) */
function topLevelIndexOf(flat: string, keyword: RegExp, fromIndex: number): number {
  let depth = 0
  for (let i = fromIndex; i < flat.length; i++) {
    const c = flat[i]
    if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0) {
      const m = keyword.exec(flat.slice(i))
      if (m && m.index === 0) return i
    }
  }
  return -1
}

/** 拆分顶层逗号(SELECT 列表) */
function splitTopLevelCommas(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/** 列级映射 best-effort:解析最外层 SELECT 列表 */
function extractColumnMappings(flat: string, fromPos: number): ColumnMapping[] {
  const selPos = topLevelIndexOf(flat, /^select\b/i, fromPos)
  if (selPos < 0) return []
  const fromKeywordPos = topLevelIndexOf(flat, /^from\b/i, selPos)
  const listText = fromKeywordPos > 0 ? flat.slice(selPos + 6, fromKeywordPos) : flat.slice(selPos + 6)
  const mappings: ColumnMapping[] = []
  const seen = new Set<string>()
  for (const rawItem of splitTopLevelCommas(listText)) {
    let item = rawItem.trim().replace(/^distinct\s+/i, '')
    if (!item || item === '*') continue
    let alias: string | null = null
    const asMatch = /^(.*?)\s+as\s+([`A-Za-z_][\w$`]*)$/i.exec(item)
    if (asMatch) {
      item = asMatch[1].trim()
      alias = asMatch[2].replace(/`/g, '').toLowerCase()
    }
    const plainRef = /^([A-Za-z_`][\w$`]*)(?:\.([A-Za-z_`][\w$`]*))?$/.exec(item)
    if (!alias && plainRef) {
      // 简单列引用:o.order_id / order_id
      const col = (plainRef[2] ?? plainRef[1]).replace(/`/g, '').toLowerCase()
      const src = plainRef[2]
        ? `${plainRef[1]}.${plainRef[2]}`.replace(/`/g, '').toLowerCase()
        : col
      if (!seen.has(col)) {
        seen.add(col)
        mappings.push({ target: col, sources: [src], expression: null })
      }
    } else if (alias) {
      // 表达式 + 别名:sum(o.amount) as gmv
      const refs = Array.from(item.matchAll(/([A-Za-z_]\w*)\.([A-Za-z_]\w*)/g)).map((m) =>
        `${m[1]}.${m[2]}`.toLowerCase(),
      )
      const uniqRefs = refs.filter((r, i) => refs.indexOf(r) === i)
      if (!seen.has(alias)) {
        seen.add(alias)
        mappings.push({
          target: alias,
          sources: uniqRefs,
          expression: plainRef ? null : item.length > 72 ? `${item.slice(0, 72)}…` : item,
        })
      }
    }
    // 无名表达式跳过(与 sqlglot best-effort 口径一致:解析不出不报错)
  }
  return mappings
}

/** 裸 SELECT 判定(用于解析配置面板展示目标表输入框) */
export function isBareSelect(sql: string): boolean {
  const flat = maskSql(sql).replace(/\s+/g, ' ').trimStart().toLowerCase()
  return /^(select|with)\b/.test(flat) && !/^insert\b/.test(flat)
}

/** 本地解析入口 */
export function parseSqlLocally(sql: string, targetTable?: string): LocalParseResult {
  const masked = maskSql(sql)
  const rawStatements = splitStatements(masked)
  const statements: LocalStatement[] = []
  const warnings: ParseWarning[] = []
  const lang = getLang()
  const warn = (key: string, code: ParseWarning['code'], line?: number) =>
    warnings.push({ text: translate(lang, key, line != null ? { line } : undefined), code })
  const targets: string[] = []
  const sources: string[] = []
  const columnMappings: ColumnMapping[] = []
  const seenMapping = new Set<string>()
  const providedTarget = targetTable ? normalizeTableName(targetTable) : null

  const addTarget = (t: string | null) => {
    if (t && !targets.includes(t)) targets.push(t)
  }
  const addSources = (list: string[]) => {
    for (const s of list) if (!sources.includes(s)) sources.push(s)
  }

  for (const raw of rawStatements) {
    const flat = raw.text.replace(/\s+/g, ' ').trim()
    const head = /^(create|insert|alter|select|with)/i.exec(flat)?.[1]?.toLowerCase() ?? ''
    let type: StatementType = 'UNKNOWN'
    let target: string | null = null
    let stmtSources: string[] = []
    let mappingFrom = 0

    if (head === 'create') {
      const m = new RegExp(
        `\\bcreate\\s+(?:or\\s+replace\\s+)?(?:temp(?:orary)?\\s+)?(?:table|view)\\s+(?:if\\s+not\\s+exists\\s+)?(${TABLE_REF})`,
        'i',
      ).exec(flat)
      if (m) {
        target = normalizeTableName(m[1])
        const isCtas = /\bas\s*(?:\(?\s*select|\(?\s*with)/i.test(flat.slice(m.index + m[0].length))
        type = isCtas ? 'CTAS' : 'CREATE'
        mappingFrom = m.index + m[0].length
      }
    } else if (head === 'insert') {
      const m = new RegExp(`\\binsert\\s+(?:overwrite|into)\\s+(?:table\\s+)?(${TABLE_REF})`, 'i').exec(flat)
      if (m) {
        target = normalizeTableName(m[1])
        type = 'INSERT'
        mappingFrom = m.index + m[0].length
      }
    } else if (head === 'alter') {
      const m = new RegExp(`\\balter\\s+table\\s+(${TABLE_REF})`, 'i').exec(flat)
      if (m) {
        target = normalizeTableName(m[1])
        type = 'ALTER'
      }
    } else if (head === 'select' || head === 'with') {
      type = 'SELECT'
      target = providedTarget
      if (head === 'with') {
        // WITH 可前导 INSERT(WITH cte AS (...) INSERT OVERWRITE ...):主语句为顶层 INSERT
        const insPos = topLevelIndexOf(flat, /^insert\b/i, 0)
        const selPos = topLevelIndexOf(flat, /^select\b/i, 0)
        if (insPos >= 0 && (selPos < 0 || insPos < selPos)) {
          const m = new RegExp(`\\binsert\\s+(?:overwrite|into)\\s+(?:table\\s+)?(${TABLE_REF})`, 'i').exec(
            flat.slice(insPos),
          )
          if (m) {
            target = normalizeTableName(m[1])
            type = 'INSERT'
            mappingFrom = insPos + m[0].length
          }
        }
      }
      if (type === 'SELECT' && !target) {
        warn('sql.warn.bareSelectNoTarget', 'no_target', raw.lineStart)
      }
    }

    if (type === 'UNKNOWN' || (!target && (head === 'create' || head === 'insert' || head === 'alter'))) {
      warn('sql.warn.unparseable', 'unparseable', raw.lineStart)
      statements.push({ type: 'UNKNOWN', target: null, sources: [], lineStart: raw.lineStart, lineEnd: raw.lineEnd })
      continue
    }

    if (type === 'CTAS' || type === 'INSERT' || type === 'SELECT') {
      const cteNames = extractCteNames(flat)
      stmtSources = scanSourceTables(flat, cteNames, target)
      for (const mp of extractColumnMappings(flat, mappingFrom)) {
        if (!seenMapping.has(mp.target)) {
          seenMapping.add(mp.target)
          columnMappings.push(mp)
        }
      }
    }

    addTarget(target)
    addSources(stmtSources)
    statements.push({ type, target, sources: stmtSources, lineStart: raw.lineStart, lineEnd: raw.lineEnd })
  }

  const failed = targets.length === 0 && sources.length === 0
  if (failed && warnings.length === 0) {
    warn('sql.warn.syntaxError', 'syntax')
  }

  return { statements, targets, sources, columnMappings, warnings, failed }
}
