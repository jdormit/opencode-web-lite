import { describe, expect, test } from 'bun:test'

import type { SessionSnapshot } from './session-snapshot'
import { applyLiveSessionEvents } from './live-session'
import type { NormalizedGlobalEvent } from './live-store'

const snapshot: SessionSnapshot = {
  id: 'ses_1', title: 'Session', directory: '/work', children: [], childrenLimited: false,
  sharingEnabled: true, revertedTurns: [], revertsLimited: false,
  items: [], removedMessageIds: [], hasOlder: false,
  busy: false, requestsUnavailable: false, todos: [], todosLimited: false,
  todosUnavailable: false, changes: [], changesLimited: false, changesTotal: 0,
  changesAdditions: 0, changesDeletions: 0,
}

function event(type: string, properties: Record<string, unknown>, observedAt: number): NormalizedGlobalEvent {
  return { serverKey: 'server_1', directory: '/work', id: String(observedAt), type, properties, observedAt }
}

describe('applyLiveSessionEvents', () => {
  test('builds and streams a message without mutating loader data', () => {
    const result = applyLiveSessionEvents(snapshot, [
      event('message.updated', { sessionID: 'ses_1', info: { id: 'msg_1', role: 'assistant', time: { created: 1 } } }, 1),
      event('message.part.updated', { sessionID: 'ses_1', part: { id: 'part_1', messageID: 'msg_1', type: 'text', text: 'Hel' } }, 2),
      event('message.part.delta', { sessionID: 'ses_1', messageID: 'msg_1', partID: 'part_1', field: 'text', delta: 'lo' }, 3),
    ])
    expect(result.items[0]?.parts).toEqual([{ id: 'part_1', type: 'text', text: 'Hello', limited: false }])
    expect(snapshot.items).toEqual([])
  })

  test('updates status and bounded todos', () => {
    const result = applyLiveSessionEvents(snapshot, [
      event('session.status', { sessionID: 'ses_1', status: { type: 'busy' } }, 1),
      event('todo.updated', { sessionID: 'ses_1', todos: [{ content: 'Ship', status: 'pending', priority: 'high' }] }, 2),
    ])
    expect(result.busy).toBe(true)
    expect(result.todos).toEqual([{ content: 'Ship', status: 'pending', priority: 'high' }])
  })

  test('does not mutate loader parts or duplicate deltas across renders', () => {
    const loaded: SessionSnapshot = {
      ...snapshot,
      items: [{
        id: 'msg_1', role: 'assistant', createdAt: 1, createdLabel: 'now',
        parts: [{ id: 'part_1', type: 'text', text: 'Hi', limited: false }],
      }],
    }
    const events = [event('message.part.delta', {
      sessionID: 'ses_1', messageID: 'msg_1', partID: 'part_1', field: 'text', delta: '!',
    }, 1)]
    const first = applyLiveSessionEvents(loaded, events)
    const second = applyLiveSessionEvents(loaded, events)
    expect(first.items[0]?.parts[0]).toEqual({ id: 'part_1', type: 'text', text: 'Hi!', limited: false })
    expect(second.items[0]?.parts[0]).toEqual({ id: 'part_1', type: 'text', text: 'Hi!', limited: false })
    expect(loaded.items[0]?.parts[0]).toEqual({ id: 'part_1', type: 'text', text: 'Hi', limited: false })
  })

  test('does not discard a valid delta whose prefix matches loader text', () => {
    const loaded: SessionSnapshot = {
      ...snapshot,
      items: [{
        id: 'msg_1', role: 'assistant', createdAt: 1, createdLabel: 'now',
        parts: [{ id: 'part_1', type: 'text', text: 'foo', limited: false }],
      }],
    }
    const events = [event('message.part.delta', {
      sessionID: 'ses_1', messageID: 'msg_1', partID: 'part_1', field: 'text', delta: 'o bar',
    }, 1)]
    expect(applyLiveSessionEvents(loaded, events).items[0]?.parts[0]).toEqual({
      id: 'part_1', type: 'text', text: 'fooo bar', limited: false,
    })
  })

  test('records removed-message tombstones without mutating loader data', () => {
    const loaded: SessionSnapshot = {
      ...snapshot,
      items: [{ id: 'msg_1', role: 'user', createdAt: 1, createdLabel: 'now', parts: [] }],
    }
    const result = applyLiveSessionEvents(loaded, [
      event('message.removed', { sessionID: 'ses_1', messageID: 'msg_1' }, 1),
    ])
    expect(result.items).toEqual([])
    expect(result.removedMessageIds).toEqual(['msg_1'])
    expect(loaded.removedMessageIds).toEqual([])
  })
})
