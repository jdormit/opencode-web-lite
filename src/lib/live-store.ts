import { BoundedLru } from './bounded-lru'
import { parseDirectory } from './identity'

export type NormalizedGlobalEvent = {
  serverKey: string
  directory: string
  project?: string
  workspace?: string
  id: string
  type: string
  properties: Record<string, unknown>
  observedAt: number
}

export type LiveSnapshot = {
  revision: number
  latest: ReadonlyMap<string, NormalizedGlobalEvent>
}

export type ReconciliationTarget = { home: boolean; sessionId?: string }

export function reconciliationTarget(event: NormalizedGlobalEvent): ReconciliationTarget {
  const sessionId =
    stringProperty(event.properties, 'sessionID') ?? nestedInfoId(event.properties)
  if (
    event.type === 'project.updated' ||
    event.type === 'session.created' ||
    event.type === 'session.updated' ||
    event.type === 'session.deleted'
  ) {
    return { home: true, ...(sessionId ? { sessionId } : {}) }
  }
  if (
    event.type.startsWith('message.') ||
    event.type.startsWith('permission.') ||
    event.type.startsWith('question.') ||
    event.type === 'session.status' ||
    event.type === 'session.diff' ||
    event.type === 'session.error' ||
    event.type === 'session.compacted' ||
    event.type === 'session.idle' ||
    event.type === 'todo.updated'
  ) {
    return { home: false, ...(sessionId ? { sessionId } : {}) }
  }
  return { home: false }
}

export function normalizeGlobalEvent(
  serverKey: string,
  value: unknown,
  observedAt: number,
): NormalizedGlobalEvent | undefined {
  if (!value || typeof value !== 'object') return undefined
  const envelope = value as Record<string, unknown>
  const directory = parseDirectory(envelope.directory)
  const payload = envelope.payload
  if (!directory || !payload || typeof payload !== 'object') return undefined
  const event = payload as Record<string, unknown>
  if (
    typeof event.id !== 'string' ||
    !event.id ||
    event.id.length > 256 ||
    typeof event.type !== 'string' ||
    !event.type ||
    event.type.length > 128 ||
    !event.properties ||
    typeof event.properties !== 'object' ||
    Array.isArray(event.properties)
  ) {
    return undefined
  }
  const rawProperties = event.properties as Record<string, unknown>
  if (!validKnownProperties(event.type, rawProperties)) return undefined
  const properties = boundedProperties(event.type, rawProperties)
  if (!properties) return undefined
  return {
    serverKey,
    directory,
    id: event.id,
    type: event.type,
    properties,
    observedAt,
    ...(typeof envelope.project === 'string' && envelope.project.length <= 256
      ? { project: envelope.project }
      : {}),
    ...(typeof envelope.workspace === 'string' && envelope.workspace.length <= 256
      ? { workspace: envelope.workspace }
      : {}),
  }
}

export function coalesceGlobalEvents(events: NormalizedGlobalEvent[]) {
  const output: NormalizedGlobalEvent[] = []
  for (const event of events) {
    const previous = output.at(-1)
    if (previous && sameDeltaTarget(previous, event)) {
      const previousDelta = previous.properties.delta
      const nextDelta = event.properties.delta
      if (typeof previousDelta === 'string' && typeof nextDelta === 'string') {
        output[output.length - 1] = {
          ...event,
          properties: { ...event.properties, delta: previousDelta + nextDelta },
        }
        continue
      }
    }
    output.push(event)
  }
  return output
}

export class LiveStore {
  private revision = 0
  private snapshot: LiveSnapshot = { revision: 0, latest: new Map() }
  private readonly listeners = new Set<() => void>()
  private readonly recent = new BoundedLru<string, NormalizedGlobalEvent>(500, 20 * 60_000)
  private readonly overflowedSessions = new Set<string>()
  private readonly sessionJournal = new BoundedLru<string, NormalizedGlobalEvent[]>(
    20,
    20 * 60_000,
    Date.now,
    (sessionId) => this.overflowedSessions.add(sessionId),
  )
  private readonly maximumLatest = 500
  private latestBytes = 0

  constructor(readonly serverKey: string) {}

  getSnapshot = () => this.snapshot

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  apply(values: unknown[]) {
    const normalized = values.flatMap((value) => {
      this.revision += 1
      const event = normalizeGlobalEvent(this.serverKey, value, this.revision)
      return event ? [event] : []
    })
    const events = coalesceGlobalEvents(normalized)
    if (!events.length) return []

    const latest = new Map(this.snapshot.latest)
    for (const event of events) {
      const key = eventKey(event)
      const previous = latest.get(key)
      if (!previous || previous.observedAt < event.observedAt) {
        if (previous) this.latestBytes -= eventSize(previous)
        latest.delete(key)
        const merged = mergeLatest(previous, event)
        latest.set(key, merged)
        this.latestBytes += eventSize(merged)
      }
      this.recent.set(`${event.observedAt}:${event.id}`, event)
      const sessionId = eventSessionId(event)
      if (sessionId) {
        const journal = [...(this.sessionJournal.get(sessionId) ?? [])]
        const previousJournalEvent = journal.at(-1)
        if (previousJournalEvent && sameDeltaTarget(previousJournalEvent, event)) {
          journal[journal.length - 1] = {
            ...event,
            properties: {
              ...event.properties,
              delta: `${String(previousJournalEvent.properties.delta)}${String(event.properties.delta)}`,
            },
          }
        } else journal.push(event)
        let bytes = journal.reduce((total, item) => total + eventSize(item), 0)
        while (journal.length > 500 || bytes > 1024 * 1024) {
          const removed = journal.shift()
          if (!removed) break
          bytes -= eventSize(removed)
          this.overflowedSessions.add(sessionId)
        }
        this.sessionJournal.set(sessionId, journal)
      }
    }
    while (latest.size > this.maximumLatest) {
      const oldest = latest.keys().next().value
      if (oldest === undefined) break
      const removed = latest.get(oldest)
      if (removed) this.latestBytes -= eventSize(removed)
      latest.delete(oldest)
    }
    while (this.latestBytes > 4 * 1024 * 1024) {
      const oldest = latest.keys().next().value
      if (oldest === undefined) break
      const removed = latest.get(oldest)
      if (removed) this.latestBytes -= eventSize(removed)
      latest.delete(oldest)
    }
    this.snapshot = { revision: events.at(-1)!.observedAt, latest }
    for (const listener of this.listeners) listener()
    return events
  }

  eventsForSession(sessionId: string) {
    return this.sessionJournal.get(sessionId) ?? []
  }

  needsSessionReconciliation(sessionId: string) {
    return this.overflowedSessions.has(sessionId)
  }

  acknowledgeSessionReconciliation(sessionId: string) {
    this.overflowedSessions.delete(sessionId)
  }

  rebaseSession(sessionId: string, revision: number) {
    const retained = (this.sessionJournal.get(sessionId) ?? []).filter(
      (event) => event.observedAt > revision,
    )
    this.sessionJournal.set(sessionId, retained)
    this.overflowedSessions.delete(sessionId)
  }

  drainOverflowedSessions() {
    const sessions = [...this.overflowedSessions]
    this.overflowedSessions.clear()
    return sessions
  }

  isResponseCurrent(startedAtRevision: number) {
    return startedAtRevision >= this.snapshot.revision
  }
}

function sameDeltaTarget(previous: NormalizedGlobalEvent, next: NormalizedGlobalEvent) {
  return (
    previous.type === 'message.part.delta' &&
    next.type === previous.type &&
    next.directory === previous.directory &&
    next.properties.sessionID === previous.properties.sessionID &&
    next.properties.messageID === previous.properties.messageID &&
    next.properties.partID === previous.properties.partID &&
    next.properties.field === previous.properties.field
  )
}

function mergeLatest(
  previous: NormalizedGlobalEvent | undefined,
  event: NormalizedGlobalEvent,
) {
  if (!previous || !sameDeltaTarget(previous, event)) return event
  const previousDelta = previous.properties.delta
  const delta = event.properties.delta
  if (typeof previousDelta !== 'string' || typeof delta !== 'string') return event
  const combined = previousDelta + delta
  return {
    ...event,
    properties: {
      ...event.properties,
      delta: combined.length > 256 * 1024 ? combined.slice(-256 * 1024) : combined,
    },
  }
}

function eventKey(event: NormalizedGlobalEvent) {
  const properties = event.properties
  const identity =
    stringProperty(properties, 'partID') ??
    stringProperty(properties, 'messageID') ??
    stringProperty(properties, 'sessionID') ??
    stringProperty(properties, 'id') ??
    event.id
  return `${event.directory}:${event.type}:${identity}`
}

function eventSessionId(event: NormalizedGlobalEvent) {
  return stringProperty(event.properties, 'sessionID') ?? nestedInfoId(event.properties)
}

function eventSize(event: NormalizedGlobalEvent) {
  try {
    return JSON.stringify(event.properties).length + event.type.length + event.id.length + 64
  } catch {
    return 32 * 1024
  }
}

function stringProperty(value: Record<string, unknown> | undefined, key: string) {
  const property = value?.[key]
  return typeof property === 'string' ? property : undefined
}

function nestedInfoId(value: Record<string, unknown>) {
  const info = value.info
  if (!info || typeof info !== 'object') return undefined
  return stringProperty(info as Record<string, unknown>, 'id')
}

function validKnownProperties(type: string, properties: Record<string, unknown>) {
  const sessionID = stringProperty(properties, 'sessionID')
  if (type === 'message.part.delta') {
    return Boolean(
      sessionID &&
      stringProperty(properties, 'messageID') &&
      stringProperty(properties, 'partID') &&
      stringProperty(properties, 'field') &&
      typeof properties.delta === 'string' &&
      properties.delta.length <= 1024 * 1024,
    )
  }
  if (type === 'message.updated') {
    const info = objectProperty(properties, 'info')
    return Boolean(sessionID && stringProperty(info, 'id'))
  }
  if (type === 'message.removed') {
    return Boolean(sessionID && stringProperty(properties, 'messageID'))
  }
  if (type === 'message.part.updated') {
    const part = objectProperty(properties, 'part')
    return Boolean(
      sessionID &&
      stringProperty(part, 'id') &&
      stringProperty(part, 'messageID'),
    )
  }
  if (type === 'message.part.removed') {
    return Boolean(
      sessionID &&
      stringProperty(properties, 'messageID') &&
      stringProperty(properties, 'partID'),
    )
  }
  if (type.startsWith('message.') || type.startsWith('permission.') ||
      type.startsWith('question.') || type === 'todo.updated' ||
      type === 'session.status' || type === 'session.diff' ||
      type === 'session.error' || type === 'session.compacted' || type === 'session.idle') {
    return Boolean(sessionID)
  }
  if (type === 'session.created' || type === 'session.updated' || type === 'session.deleted') {
    return Boolean(sessionID ?? nestedInfoId(properties))
  }
  return true
}

function objectProperty(value: Record<string, unknown>, key: string) {
  const property = value[key]
  return property && typeof property === 'object' && !Array.isArray(property)
    ? property as Record<string, unknown>
    : undefined
}

function boundedProperties(type: string, properties: Record<string, unknown>) {
  let length = 0
  try {
    length = JSON.stringify(properties).length
  } catch {
    return undefined
  }
  if (length <= 32 * 1024) return properties
  const sessionID = stringProperty(properties, 'sessionID') ?? nestedInfoId(properties)
  return sessionID ? { sessionID, oversized: true, eventType: type } : undefined
}

const stores = new BoundedLru<string, LiveStore>(20, 20 * 60_000)

export function getLiveStore(serverKey: string) {
  const existing = stores.get(serverKey)
  if (existing) return existing
  const store = new LiveStore(serverKey)
  stores.set(serverKey, store)
  return store
}
