import { describe, expect, test } from 'bun:test'

import { addHistory, historyNavigate, insertMention, parseStoredDraft, reconcileMentions } from './composer-state'

describe('composer state', () => {
  test('inserts a structured mention without losing surrounding text', () => {
    const result = insertMention('read @sr today', [], 5, 8, {
      id: 'file:src/index.ts', type: 'file', path: 'src/index.ts', label: '@src/index.ts',
    })
    expect(result.text).toBe('read @src/index.ts today')
    expect(result.mentions).toEqual([{ id: 'file:src/index.ts', type: 'file', path: 'src/index.ts', label: '@src/index.ts', start: 5, end: 18 }])
    expect(result.caret).toBe(18)
  })

  test('moves untouched mentions and drops edited mentions', () => {
    const mention = { id: 'a', type: 'agent' as const, name: 'review', label: '@review', start: 6, end: 13 }
    expect(reconcileMentions('hello @review', 'well hello @review', [mention])[0]).toMatchObject({ start: 11, end: 18 })
    expect(reconcileMentions('hello @review', 'hello @revise', [mention])).toEqual([])
  })

  test('keeps bounded separate history navigation and restores the draft', () => {
    const entries = addHistory(['older'], 'new')
    const up = historyNavigate(entries, -1, 'draft', 'up')!
    expect(up.value).toBe('new')
    expect(historyNavigate(entries, up.index, 'draft', 'down')).toEqual({ value: 'draft', index: -1, saved: undefined })
    expect(Array.from({ length: 110 }, (_, index) => `${index}`).reduce(addHistory, [])).toHaveLength(100)
  })

  test('rejects stale persisted mention offsets', () => {
    expect(parseStoredDraft({ text: 'hello', mode: 'normal', mentions: [{ id: 'a', type: 'agent', name: 'review', label: '@review', start: 0, end: 7 }] })).toEqual({ text: 'hello', mode: 'normal', mentions: [], attachmentsOmitted: false })
  })
})
