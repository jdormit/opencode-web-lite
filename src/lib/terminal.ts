import { writePersistentValue } from './persistence'

export type PtyInfo = {
  id: string
  title: string
  command: string
  args: string[]
  cwd: string
  status: 'running' | 'exited'
  pid: number
  exitCode?: number
}

export type SavedTerminal = {
  id: string
  title: string
  buffer?: string
  cursor?: number
  rows?: number
  cols?: number
  scrollY?: number
}

export type TerminalWorkspaceState = {
  version: 1
  active?: string
  terminals: SavedTerminal[]
  height: number
}

export const terminalHeights = [280, 360, 520] as const

const maximumBufferLength = 64 * 1024
const maximumWorkspaceBytes = 512 * 1024
const maximumTerminals = 8

export function terminalStorageKey(serverKey: string, directory: string) {
  return `opencode-web-lite:terminal:v1:${serverKey}:${hashText(directory)}`
}

export function readTerminalWorkspace(key: string): TerminalWorkspaceState {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) {
      throw new Error('unsupported')
    }
    const record = value as Partial<TerminalWorkspaceState>
    const terminals = Array.isArray(record.terminals)
      ? record.terminals.flatMap((item) => validSavedTerminal(item)).slice(0, maximumTerminals)
      : []
    const active =
      typeof record.active === 'string' && terminals.some((item) => item.id === record.active)
        ? record.active
        : undefined
    return {
      version: 1,
      terminals,
      height: validHeight(record.height),
      ...(active ? { active } : {}),
    }
  } catch {
    return { version: 1, terminals: [], height: 360 }
  }
}

/**
 * Writes bounded workspace state. When the browser rejects the full payload it
 * retries without serialized buffers so tabs, order, and layout still persist.
 */
export function writeTerminalWorkspace(key: string, value: TerminalWorkspaceState) {
  const bounded = boundWorkspace(value)
  try {
    if (writePersistentValue(localStorage, key, JSON.stringify(bounded), 'terminal')) return
    const withoutBuffers = {
      ...bounded,
      terminals: bounded.terminals.map(
        ({ buffer: _buffer, cursor: _cursor, scrollY: _scrollY, ...rest }) => rest,
      ),
    }
    writePersistentValue(localStorage, key, JSON.stringify(withoutBuffers), 'terminal')
  } catch {}
}

/**
 * Merges one terminal's recoverable state into stored state without depending on
 * React state that may already be unmounted. Stored titles and ordering win.
 */
export function persistTerminalSnapshot(
  key: string,
  id: string,
  snapshot: Omit<SavedTerminal, 'id' | 'title'>,
) {
  const current = readTerminalWorkspace(key)
  if (!current.terminals.some((item) => item.id === id)) return
  writeTerminalWorkspace(key, {
    ...current,
    terminals: current.terminals.map((item) =>
      item.id === id ? { ...item, ...validSnapshot(snapshot) } : item,
    ),
  })
}

export function reconcileTerminals(
  saved: SavedTerminal[],
  running: PtyInfo[],
): SavedTerminal[] {
  const live = new Map(
    running.filter((pty) => pty.status === 'running').map((pty) => [pty.id, pty]),
  )
  const terminals = saved.filter((item) => live.has(item.id))
  for (const pty of live.values()) {
    if (!terminals.some((item) => item.id === pty.id)) {
      terminals.push({ id: pty.id, title: pty.title })
    }
  }
  return terminals.slice(0, maximumTerminals)
}

export function nextTerminalTitle(terminals: SavedTerminal[]): string {
  const used = new Set(
    terminals.flatMap((item) => {
      const match = item.title.match(/^Terminal (\d+)$/)
      return match ? [Number(match[1])] : []
    }),
  )
  let number = 1
  while (used.has(number)) number += 1
  return `Terminal ${number}`
}

export function decodeTerminalMetadata(value: ArrayBuffer): number | undefined {
  const bytes = new Uint8Array(value)
  if (bytes.length < 2 || bytes[0] !== 0) return undefined
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(1)))
    if (!parsed || typeof parsed !== 'object' || !('cursor' in parsed)) return undefined
    const cursor = (parsed as { cursor: unknown }).cursor
    return Number.isSafeInteger(cursor) && Number(cursor) >= 0 ? Number(cursor) : undefined
  } catch {
    return undefined
  }
}

export function isPtyInfo(value: unknown): value is PtyInfo {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<PtyInfo>
  return (
    typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    typeof item.command === 'string' &&
    Array.isArray(item.args) &&
    typeof item.cwd === 'string' &&
    (item.status === 'running' || item.status === 'exited') &&
    typeof item.pid === 'number'
  )
}

function boundWorkspace(value: TerminalWorkspaceState): TerminalWorkspaceState {
  const terminals = value.terminals.slice(0, maximumTerminals).map((item) => ({
    ...item,
    ...(item.buffer ? { buffer: item.buffer.slice(-maximumBufferLength) } : {}),
  }))

  let total = terminals.reduce((sum, item) => sum + (item.buffer?.length ?? 0), 0)
  for (let index = terminals.length - 1; index >= 0 && total > maximumWorkspaceBytes; index -= 1) {
    const item = terminals[index]
    if (!item?.buffer) continue
    total -= item.buffer.length
    delete item.buffer
  }

  return { ...value, terminals, height: validHeight(value.height) }
}

function validSnapshot(snapshot: Omit<SavedTerminal, 'id' | 'title'>) {
  return {
    ...(typeof snapshot.buffer === 'string'
      ? { buffer: snapshot.buffer.slice(-maximumBufferLength) }
      : {}),
    ...(isCount(snapshot.cursor) ? { cursor: Number(snapshot.cursor) } : {}),
    ...(isPositive(snapshot.rows) ? { rows: Number(snapshot.rows) } : {}),
    ...(isPositive(snapshot.cols) ? { cols: Number(snapshot.cols) } : {}),
    ...(isCount(snapshot.scrollY) ? { scrollY: Number(snapshot.scrollY) } : {}),
  }
}

function validSavedTerminal(value: unknown): SavedTerminal[] {
  if (!value || typeof value !== 'object') return []
  const item = value as Partial<SavedTerminal>
  if (typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.id)) return []
  if (typeof item.title !== 'string') return []
  return [
    {
      id: item.id,
      title: item.title.slice(0, 200),
      ...validSnapshot(item),
    },
  ]
}

function validHeight(value: unknown): number {
  const match = terminalHeights.find((height) => height === value)
  return match ?? 360
}

function isCount(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isPositive(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function hashText(value: string): string {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(36)
}
