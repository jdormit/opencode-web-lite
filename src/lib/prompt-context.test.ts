import { describe, expect, test } from 'bun:test'
import { addPromptContext, buildPromptText, parsePromptContexts, promptContextID, promptContextLocked, setPromptContextLock } from './prompt-context'

const context = { id: 'ctx_1', type: 'file' as const, label: 'src/app.ts:1-2', text: 'file context' }

describe('prompt contexts', () => {
  test('adds, replaces, and serializes bounded context items', () => {
    expect(addPromptContext([], context)).toEqual({ ok: true, value: [context] })
    expect(addPromptContext([context], { ...context, text: 'updated' })).toEqual({
      ok: true, value: [{ ...context, text: 'updated' }],
    })
    expect(buildPromptText('draft', [context])).toBe('draft\n\nfile context')
  })

  test('rejects malformed and oversized context atomically', () => {
    expect(addPromptContext([], { ...context, text: 'x'.repeat(32_001) })).toEqual({ ok: false, reason: 'context-limit' })
    expect(buildPromptText('x'.repeat(90_000), [{ ...context, text: 'y'.repeat(20_000) }])).toBeUndefined()
    expect(parsePromptContexts([{ secret: true }, context])).toEqual([context])
  })

  test('deduplicates persisted IDs and exposes deterministic source IDs', () => {
    expect(parsePromptContexts([context, { ...context, text: 'latest' }])).toEqual([{ ...context, text: 'latest' }])
    expect(promptContextID('file', 'src/app.ts')).toBe(promptContextID('file', 'src/app.ts'))
    setPromptContextLock('draft', true)
    expect(promptContextLocked('draft')).toBe(true)
    setPromptContextLock('draft', false)
    expect(promptContextLocked('draft')).toBe(false)
  })
})
