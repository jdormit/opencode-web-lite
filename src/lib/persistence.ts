export const persistenceLimits = {
  directoryStores: { entries: 30, idleMs: 20 * 60_000 },
  fileContent: { entries: 40, bytes: 20 * 1024 * 1024 },
  promptSessions: { entries: 20 },
  terminalWorkspaces: { entries: 20 },
  sessionUI: { entries: 50 },
  notifications: { entries: 500, ageMs: 30 * 24 * 60 * 60_000 },
} as const

export type PersistenceClass =
  | 'cache'
  | 'notification'
  | 'session-ui'
  | 'terminal'
  | 'draft'
  | 'preference'

export type PersistenceRecord = Readonly<{
  key: string
  class: PersistenceClass
  updatedAt: number
  bytes: number
}>

const evictionOrder: readonly PersistenceClass[] = [
  'cache',
  'notification',
  'session-ui',
  'terminal',
]

const registryKey = 'opencode-web-lite:persistence-registry:v2'
const classEntryLimits: Partial<Record<PersistenceClass, number>> = {
  cache: persistenceLimits.fileContent.entries,
  notification: persistenceLimits.notifications.entries,
  'session-ui': persistenceLimits.sessionUI.entries,
  terminal: persistenceLimits.terminalWorkspaces.entries,
  preference: 50,
}

export function selectPersistenceEvictions(
  records: readonly PersistenceRecord[],
  bytesNeeded: number,
): string[] {
  if (bytesNeeded <= 0) return []
  let recovered = 0
  const selected: string[] = []
  for (const kind of evictionOrder) {
    const candidates = records
      .filter((record) => record.class === kind)
      .sort((left, right) => left.updatedAt - right.updatedAt || left.key.localeCompare(right.key))
    for (const record of candidates) {
      selected.push(record.key)
      recovered += Math.max(0, record.bytes)
      if (recovered >= bytesNeeded) return selected
    }
  }
  return selected
}

type PersistenceEnvelope = Readonly<{
  version: 2
  records: PersistenceRecord[]
}>

export function migratePersistenceRegistry(value: unknown): PersistenceEnvelope {
  if (!value || typeof value !== 'object') return { version: 2, records: [] }
  const source = value as { version?: unknown; records?: unknown; entries?: unknown }
  const entries = source.version === 1 ? source.entries : source.records
  if (!Array.isArray(entries)) return { version: 2, records: [] }
  const records = entries.flatMap((entry): PersistenceRecord[] => {
    if (!entry || typeof entry !== 'object') return []
    const item = entry as Record<string, unknown>
    const kind = item.class ?? item.kind
    if (
      typeof item.key !== 'string' || item.key.length > 1_000 ||
      !isPersistenceClass(kind) ||
      !Number.isFinite(item.updatedAt) || !Number.isFinite(item.bytes)
    ) return []
    return [{
      key: item.key,
      class: kind,
      updatedAt: Math.max(0, Number(item.updatedAt)),
      bytes: Math.max(0, Number(item.bytes)),
    }]
  })
  return { version: 2, records: records.slice(0, 2_000) }
}

export function writePersistentValue(
  storage: Storage,
  key: string,
  value: string,
  kind: PersistenceClass,
  now = Date.now(),
): boolean {
  const existingRecords = readRegistry(storage)
  if (kind === 'draft') {
    const scope = draftScope(key)
    const scopes = new Set(existingRecords.filter((item) => item.class === 'draft').map((item) => draftScope(item.key)))
    if (!scopes.has(scope) && scopes.size >= persistenceLimits.promptSessions.entries) return false
  }
  let records = existingRecords.filter((record) => record.key !== key)
  const record: PersistenceRecord = {
    key,
    class: kind,
    updatedAt: now,
    bytes: new TextEncoder().encode(value).byteLength,
  }
  records.push(record)

  const limit = classEntryLimits[kind]
  if (limit !== undefined) {
    const excess = records.filter((item) => item.class === kind).length - limit
    if (excess > 0) {
      const removals = records
        .filter((item) => item.class === kind && item.key !== key)
        .sort((left, right) => left.updatedAt - right.updatedAt || left.key.localeCompare(right.key))
        .slice(0, excess)
        .map((item) => item.key)
      records = evict(storage, records, removals)
    }
  }

  if (kind === 'cache') {
    const cacheBytes = records.filter((item) => item.class === 'cache').reduce((total, item) => total + item.bytes, 0)
    records = evict(storage, records, selectPersistenceEvictions(
      records.filter((item) => item.key !== key),
      cacheBytes - persistenceLimits.fileContent.bytes,
    ))
  }

  try {
    storage.setItem(key, value)
  } catch (error) {
    if (!isQuotaExceeded(error)) return false
    for (const candidate of selectPersistenceEvictions(records.filter((item) => item.key !== key), Number.MAX_SAFE_INTEGER)) {
      records = evict(storage, records, [candidate])
      try {
        storage.setItem(key, value)
        return writeRegistry(storage, records)
      } catch (retryError) {
        if (!isQuotaExceeded(retryError)) return false
      }
    }
    return false
  }
  return writeRegistry(storage, records)
}

export function removePersistentValue(storage: Storage, key: string): void {
  try { storage.removeItem(key) } catch {}
  writeRegistry(storage, readRegistry(storage).filter((record) => record.key !== key))
}

function readRegistry(storage: Storage): PersistenceRecord[] {
  try {
    return migratePersistenceRegistry(JSON.parse(storage.getItem(registryKey) ?? 'null')).records
  } catch {
    return []
  }
}

function writeRegistry(storage: Storage, records: PersistenceRecord[]): boolean {
  try {
    storage.setItem(registryKey, JSON.stringify({ version: 2, records: records.slice(-2_000) }))
    return true
  } catch {
    return false
  }
}

function evict(storage: Storage, records: PersistenceRecord[], keys: readonly string[]): PersistenceRecord[] {
  const selected = new Set(keys)
  for (const key of selected) {
    try { storage.removeItem(key) } catch {}
  }
  return records.filter((record) => !selected.has(record.key))
}

function isQuotaExceeded(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
}

function isPersistenceClass(value: unknown): value is PersistenceClass {
  return ['cache', 'notification', 'session-ui', 'terminal', 'draft', 'preference'].includes(String(value))
}

function draftScope(key: string) {
  for (const prefix of ['opencode-web-lite:session-draft:v1:', 'opencode-web-lite:session-draft:v2:', 'opencode-web-lite:session-contexts:v1:']) {
    if (key.startsWith(prefix)) return `session:${key.slice(prefix.length)}`
  }
  const newSessionPrefix = 'opencode-web-lite:new-session-draft:v1:'
  if (key.startsWith(newSessionPrefix)) return `new:${key.slice(newSessionPrefix.length)}`
  return `key:${key}`
}
