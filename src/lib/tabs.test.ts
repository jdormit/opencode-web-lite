import { describe, expect, test } from 'bun:test'

import { closeTab, MAX_CLOSED_TABS, MAX_TABS, openTab, reopenTab, reorderTab, type SessionTab, type TabState } from './tabs'

const tab = (id: string): SessionTab => ({ type: 'session', serverKey: 'server_1', sessionId: id, title: id })

describe('top-level tabs', () => {
  test('caps, deduplicates, and reorders tabs', () => {
    let state: TabState = { tabs: [], closed: [] }
    for (let index = 0; index < MAX_TABS + 5; index += 1) state = openTab(state, tab(`ses_${index}`))
    state = openTab(state, { ...tab('ses_6'), title: 'Updated' })
    expect(state.tabs).toHaveLength(MAX_TABS)
    expect(state.tabs.find((item) => item.type === 'session' && item.sessionId === 'ses_6')?.title).toBe('Updated')
    const key = 'session:server_1:ses_6'
    const moved = reorderTab(state, key, 1)
    expect(moved.tabs.findIndex((item) => item.type === 'session' && item.sessionId === 'ses_6')).toBe(state.tabs.findIndex((item) => item.type === 'session' && item.sessionId === 'ses_6') + 1)
  })

  test('selects right then left and reopens at the previous index', () => {
    const state = { tabs: [tab('one'), tab('two'), tab('three')], closed: [] }
    const closed = closeTab(state, 'session:server_1:two')
    expect(closed.next).toEqual(tab('three'))
    const reopened = reopenTab(closed.state)
    expect(reopened.state.tabs.map((item) => item.type === 'session' && item.sessionId)).toEqual(['one', 'two', 'three'])
  })

  test('retains only 25 recently closed session tabs', () => {
    let state: TabState = { tabs: [], closed: [] }
    for (let index = 0; index < 30; index += 1) {
      state = openTab(state, tab(String(index)))
      state = closeTab(state, `session:server_1:${index}`).state
    }
    expect(state.closed).toHaveLength(MAX_CLOSED_TABS)
  })
})
