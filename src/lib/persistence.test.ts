import { describe, expect, test } from 'bun:test'

import { migratePersistenceRegistry, persistenceLimits, selectPersistenceEvictions, writePersistentValue } from './persistence'

describe('persistence policy', () => {
  test('keeps the SPEC limits in one registry', () => {
    expect(persistenceLimits.fileContent).toEqual({ entries: 40, bytes: 20 * 1024 * 1024 })
    expect(persistenceLimits.terminalWorkspaces.entries).toBe(20)
    expect(persistenceLimits.sessionUI.entries).toBe(50)
    expect(persistenceLimits.notifications.entries).toBe(500)
  })

  test('migrates v1 records and rejects malformed values', () => {
    expect(migratePersistenceRegistry({ version: 1, entries: [
      { key: 'old', kind: 'cache', updatedAt: 4, bytes: 12 },
      { key: 'secret', kind: 'credential', updatedAt: 1, bytes: 5 },
    ] })).toEqual({
      version: 2,
      records: [{ key: 'old', class: 'cache', updatedAt: 4, bytes: 12 }],
    })
    expect(migratePersistenceRegistry('broken')).toEqual({ version: 2, records: [] })
  })

  test('evicts LRU cache classes before protected authored state', () => {
    const records = [
      { key: 'draft', class: 'draft' as const, updatedAt: 0, bytes: 100 },
      { key: 'new-cache', class: 'cache' as const, updatedAt: 4, bytes: 20 },
      { key: 'old-cache', class: 'cache' as const, updatedAt: 1, bytes: 20 },
      { key: 'notice', class: 'notification' as const, updatedAt: 0, bytes: 20 },
    ]
    expect(selectPersistenceEvictions(records, 45)).toEqual(['old-cache', 'new-cache', 'notice'])
    expect(selectPersistenceEvictions(records, 1_000)).not.toContain('draft')
  })

  test('enforces class limits and evicts recoverable values on quota failures', () => {
    const values = new Map<string, string>()
    let fail = false
    const storage = {
      get length() { return values.size },
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => { values.delete(key) },
      setItem: (key: string, value: string) => {
        if (fail && key === 'draft') { fail = false; throw new DOMException('full', 'QuotaExceededError') }
        values.set(key, value)
      },
    } satisfies Storage
    for (let index = 0; index < 21; index += 1) {
      expect(writePersistentValue(storage, `terminal-${index}`, 'x', 'terminal', index)).toBeTrue()
    }
    expect(values.has('terminal-0')).toBeFalse()
    expect(values.has('terminal-20')).toBeTrue()
    fail = true
    expect(writePersistentValue(storage, 'draft', 'authored', 'draft', 30)).toBeTrue()
    expect(values.has('terminal-1')).toBeFalse()
    expect(values.get('draft')).toBe('authored')
  })

  test('rejects a twenty-first draft scope without evicting authored state', () => {
    const values = new Map<string, string>()
    const storage = {
      get length() { return values.size },
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => { values.delete(key) },
      setItem: (key: string, value: string) => { values.set(key, value) },
    } satisfies Storage
    for (let index = 0; index < 20; index += 1) {
      expect(writePersistentValue(storage, `opencode-web-lite:session-draft:v2:server:session_${index}`, 'draft', 'draft', index)).toBeTrue()
    }
    expect(writePersistentValue(storage, 'opencode-web-lite:session-contexts:v1:server:session_0', 'context', 'draft', 21)).toBeTrue()
    expect(writePersistentValue(storage, 'opencode-web-lite:session-draft:v2:server:session_20', 'new', 'draft', 22)).toBeFalse()
    expect(values.get('opencode-web-lite:session-draft:v2:server:session_0')).toBe('draft')
    expect(values.has('opencode-web-lite:session-draft:v2:server:session_20')).toBeFalse()
  })
})
