/**
 * 行级文本 diff(LCS):生成 CodeEditor diffLines 所需的新增/删除/上下文行
 * 用于脚本版本对比视图(v{n} → v{n+1})
 */

import type { DiffLine } from '@/components/common/CodeEditor'

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.replace(/\r\n/g, '\n').split('\n')
  const b = newText.replace(/\r\n/g, '\n').split('\n')
  const n = a.length
  const m = b.length

  // LCS 动态规划(版本 SQL 量级 ≤ 数百行,O(n*m) 可接受)
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ text: b[j], state: 'context' })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ text: a[i], state: 'removed' })
      i++
    } else {
      lines.push({ text: b[j], state: 'added' })
      j++
    }
  }
  while (i < n) {
    lines.push({ text: a[i], state: 'removed' })
    i++
  }
  while (j < m) {
    lines.push({ text: b[j], state: 'added' })
    j++
  }
  return lines
}
