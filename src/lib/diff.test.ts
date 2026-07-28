import { describe, expect, test } from 'bun:test'

import { incrementalDiffWindow, parseUnifiedDiff } from './diff'

describe('unified diff parsing', () => {
  test('tracks old and new line numbers', () => {
    const result = parseUnifiedDiff('@@ -2,2 +2,2 @@\n same\n-old\n+new')
    expect(result.lines.slice(1)).toEqual([
      { key: '1:c', kind: 'context', text: ' same', oldLine: 2, newLine: 2 },
      { key: '2:d', kind: 'deletion', text: '-old', oldLine: 3 },
      { key: '3:a', kind: 'addition', text: '+new', newLine: 3 },
    ])
  })

  test('returns incremental windows and reports bounds', () => {
    const patch = ['@@ -1 +1 @@', ...Array.from({ length: 20 }, (_, index) => ` line ${index}`)].join('\n')
    expect(incrementalDiffWindow(patch, 5, 3).lines).toHaveLength(3)
    expect(parseUnifiedDiff(patch, 4).limited).toBe(true)
  })
})
