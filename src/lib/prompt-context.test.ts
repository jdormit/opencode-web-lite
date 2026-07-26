import { describe, expect, test } from 'bun:test'
import { appendPromptContext } from './prompt-context'

describe('appendPromptContext', () => {
  test('appends context without truncating it', () => {
    expect(appendPromptContext('draft', 'context')).toEqual({ ok: true, value: 'draft\n\ncontext' })
  })
  test('rejects context and prompt overflow atomically', () => {
    expect(appendPromptContext('', 'x'.repeat(32_001))).toEqual({ ok: false, reason: 'context-limit' })
    expect(appendPromptContext('x'.repeat(90_000), 'y'.repeat(20_000))).toEqual({ ok: false, reason: 'prompt-limit' })
  })
})
