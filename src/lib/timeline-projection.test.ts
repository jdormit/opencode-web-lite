import { describe, expect, test } from 'bun:test'

import { boundedValue, projectTimelineMessage, projectTimelinePart } from './timeline-projection'

describe('timeline projection', () => {
  test('preserves typed message and tool metadata', () => {
    const message = projectTimelineMessage({
      id: 'msg_1', role: 'assistant', time: { created: 1, completed: 2 }, parentID: 'msg_user',
      providerID: 'anthropic', modelID: 'claude', agent: 'build', cost: 0.25,
      tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 3, write: 1 } },
    }, [{
      id: 'part_1', type: 'tool', callID: 'call_1', tool: 'task',
      state: { status: 'completed', input: { description: 'Check' }, output: 'ok', title: 'Task', metadata: { sessionId: 'ses_child' }, time: { start: 1, end: 2 } },
    }])
    expect(message?.metadata.tokens?.total).toBe(21)
    expect(message?.metadata.parentID).toBe('msg_user')
    expect(message?.parts[0]).toMatchObject({ type: 'tool', callID: 'call_1', metadata: { sessionId: 'ses_child' } })
  })

  test('bounds nested values, output, and depth', () => {
    const part = projectTimelinePart({ id: 'part_1', type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'x' }, output: 'x'.repeat(70_000), title: 'Shell', metadata: {}, time: { start: 1, end: 2 } } })
    expect(part?.type === 'tool' && part.output?.length).toBe(64_000)
    expect(part?.type === 'tool' && part.outputLimited).toBe(true)
    expect(JSON.stringify(boundedValue({ value: 'x'.repeat(40_000) }))!.length).toBeLessThan(33_000)
  })
})
