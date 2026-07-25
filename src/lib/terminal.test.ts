import { describe, expect, test } from 'bun:test'

import {
  decodeTerminalMetadata,
  isPtyInfo,
  nextTerminalTitle,
  persistTerminalSnapshot,
  readTerminalWorkspace,
  reconcileTerminals,
  terminalStorageKey,
  type PtyInfo,
  writeTerminalWorkspace,
} from './terminal'

function useMemoryStorage(failOver = Number.POSITIVE_INFINITY) {
  const entries = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (value.length > failOver) throw new Error('QuotaExceededError')
        entries.set(key, value)
      },
      removeItem: (key: string) => entries.delete(key),
    },
  })
  return entries
}

function pty(id: string, overrides: Partial<PtyInfo> = {}): PtyInfo {
  return {
    id,
    title: id,
    command: 'bash',
    args: [],
    cwd: '/work/alpha',
    status: 'running',
    pid: 42,
    ...overrides,
  }
}

function metadataFrame(payload: string, prefix = 0): ArrayBuffer {
  const body = new TextEncoder().encode(payload)
  const frame = new Uint8Array(body.length + 1)
  frame[0] = prefix
  frame.set(body, 1)
  return frame.buffer
}

describe('terminal protocol', () => {
  test('accepts only bounded cursor metadata frames', () => {
    expect(decodeTerminalMetadata(metadataFrame('{"cursor":42}'))).toBe(42)
    expect(decodeTerminalMetadata(metadataFrame('{"cursor":0}'))).toBe(0)
    expect(decodeTerminalMetadata(metadataFrame('{"cursor":-3}'))).toBeUndefined()
    expect(decodeTerminalMetadata(metadataFrame('{"cursor":1.5}'))).toBeUndefined()
    expect(decodeTerminalMetadata(metadataFrame('{"cursor":42}', 1))).toBeUndefined()
    expect(decodeTerminalMetadata(metadataFrame('not json'))).toBeUndefined()
  })

  test('validates PTY summaries', () => {
    expect(isPtyInfo(pty('pty_1'))).toBe(true)
    expect(isPtyInfo({ id: 'pty_1', status: 'running' })).toBe(false)
    expect(isPtyInfo(null)).toBe(false)
  })
})

describe('terminal workspace state', () => {
  test('scopes storage by server and directory', () => {
    expect(terminalStorageKey('server_a', '/work/alpha')).not.toBe(
      terminalStorageKey('server_b', '/work/alpha'),
    )
    expect(terminalStorageKey('server_a', '/work/alpha')).not.toBe(
      terminalStorageKey('server_a', '/work/beta'),
    )
  })

  test('drops missing terminals, keeps order, and adopts new ones', () => {
    const saved = [
      { id: 'pty_1', title: 'Terminal 1' },
      { id: 'pty_gone', title: 'Terminal 2' },
    ]
    const running = [pty('pty_1'), pty('pty_new', { title: 'Terminal 9' }), pty('pty_dead', { status: 'exited' })]

    expect(reconcileTerminals(saved, running)).toEqual([
      { id: 'pty_1', title: 'Terminal 1' },
      { id: 'pty_new', title: 'Terminal 9' },
    ])
  })

  test('names new terminals using the smallest unused number', () => {
    expect(nextTerminalTitle([])).toBe('Terminal 1')
    expect(nextTerminalTitle([{ id: 'a', title: 'Terminal 1' }, { id: 'b', title: 'Terminal 3' }])).toBe(
      'Terminal 2',
    )
    expect(nextTerminalTitle([{ id: 'a', title: 'Build logs' }])).toBe('Terminal 1')
  })
})

describe('terminal persistence', () => {
  test('merges recovery state without overwriting the stored title or order', () => {
    useMemoryStorage()
    const key = terminalStorageKey('server_a', '/work/alpha')
    writeTerminalWorkspace(key, {
      version: 1,
      height: 360,
      active: 'pty_2',
      terminals: [
        { id: 'pty_1', title: 'Renamed here' },
        { id: 'pty_2', title: 'Terminal 2' },
      ],
    })

    persistTerminalSnapshot(key, 'pty_1', { buffer: 'output', cursor: 12, rows: 30, cols: 100 })
    const stored = readTerminalWorkspace(key)

    expect(stored.terminals.map((item) => item.id)).toEqual(['pty_1', 'pty_2'])
    expect(stored.terminals[0]).toEqual({
      id: 'pty_1',
      title: 'Renamed here',
      buffer: 'output',
      cursor: 12,
      rows: 30,
      cols: 100,
    })
    expect(stored.active).toBe('pty_2')
  })

  test('ignores snapshots for terminals that are no longer open', () => {
    useMemoryStorage()
    const key = terminalStorageKey('server_a', '/work/alpha')
    writeTerminalWorkspace(key, { version: 1, height: 360, terminals: [{ id: 'pty_1', title: 'One' }] })

    persistTerminalSnapshot(key, 'pty_closed', { buffer: 'ghost' })

    expect(readTerminalWorkspace(key).terminals).toEqual([{ id: 'pty_1', title: 'One' }])
  })

  test('keeps layout when the browser rejects buffered output', () => {
    useMemoryStorage(400)
    const key = terminalStorageKey('server_a', '/work/alpha')

    writeTerminalWorkspace(key, {
      version: 1,
      height: 520,
      active: 'pty_1',
      terminals: [{
        id: 'pty_1',
        title: 'One',
        buffer: 'x'.repeat(1_000),
        cursor: 1_000,
        scrollY: 20,
      }],
    })
    const stored = readTerminalWorkspace(key)

    expect(stored.height).toBe(520)
    expect(stored.active).toBe('pty_1')
    expect(stored.terminals[0]?.buffer).toBeUndefined()
    expect(stored.terminals[0]?.cursor).toBeUndefined()
    expect(stored.terminals[0]?.scrollY).toBeUndefined()
  })

  test('rejects unusable persisted values', () => {
    useMemoryStorage()
    const key = terminalStorageKey('server_a', '/work/alpha')
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        height: 9_999,
        active: 'missing',
        terminals: [
          { id: 'bad id', title: 'Injected' },
          { id: 'pty_1', title: 'One', cursor: -5, rows: 0, scrollY: 2.5 },
        ],
      }),
    )

    const stored = readTerminalWorkspace(key)
    expect(stored.height).toBe(360)
    expect(stored.active).toBeUndefined()
    expect(stored.terminals).toEqual([{ id: 'pty_1', title: 'One' }])
  })
})
