import { projectTurns, type SessionSnapshot } from './session-snapshot'
import type { NormalizedGlobalEvent } from './live-store'
import { projectMessageMetadata, projectTimelinePart } from './timeline-projection'

export function applyLiveSessionEvents(
  snapshot: SessionSnapshot,
  events: NormalizedGlobalEvent[],
): SessionSnapshot {
  if (!events.length) return snapshot
  const next: SessionSnapshot = { ...snapshot }
  let itemsChanged = false
  const mutableMessages = new Map<string, SessionSnapshot['items'][number]>()
  const ensureItems = () => {
    if (!itemsChanged) { next.items = [...next.items]; itemsChanged = true }
  }
  const mutableMessage = (id: string) => {
    const cached = mutableMessages.get(id)
    if (cached) return cached
    const index = next.items.findIndex((item) => item.id === id)
    if (index < 0) return undefined
    ensureItems()
    const current = next.items[index]!
    const mutable = {
      ...current,
      parts: current.parts.map((part) => ({ ...part })),
      metadata: { ...current.metadata, ...(current.metadata.tokens ? { tokens: { ...current.metadata.tokens } } : {}) },
    }
    next.items[index] = mutable
    mutableMessages.set(id, mutable)
    return mutable
  }

  for (const event of events) {
    const properties = event.properties
    if (event.type === 'session.status') {
      const status = properties.status
      next.busy = Boolean(status && typeof status === 'object' && (status as { type?: unknown }).type === 'busy')
      continue
    }
    if (event.type === 'session.updated') {
      const info = objectProperty(properties, 'info')
      if (typeof info?.title === 'string') next.title = info.title.slice(0, 500)
      continue
    }
    if (event.type === 'todo.updated' && Array.isArray(properties.todos)) {
      next.todos = properties.todos.slice(0, 20).flatMap((value) => {
        if (!value || typeof value !== 'object') return []
        const todo = value as Record<string, unknown>
        if (typeof todo.content !== 'string' || typeof todo.status !== 'string' || typeof todo.priority !== 'string') return []
        return [{ content: todo.content.slice(0, 2_000), status: todo.status.slice(0, 100), priority: todo.priority.slice(0, 100) }]
      })
      next.todosLimited = properties.todos.length > 20
      next.todosUnavailable = false
      continue
    }
    if (event.type === 'message.updated') {
      const info = objectProperty(properties, 'info')
      const id = stringProperty(info, 'id')
      const role = info?.role
      if (!info || !id || (role !== 'user' && role !== 'assistant')) continue
      const existing = mutableMessage(id)
      if (existing) {
        existing.metadata = projectMessageMetadata(info)
        if (role === 'assistant' && info?.error) existing.error = liveError(info.error)
      } else {
        const created = objectProperty(info, 'time')?.created
        const createdAt = typeof created === 'number' && Number.isFinite(created) &&
          created >= 0 && created <= 8_640_000_000_000_000 ? created : Date.now()
        ensureItems()
        next.items.push({
          id,
          role,
          createdAt,
          createdLabel: new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          metadata: projectMessageMetadata(info),
          parts: [],
        })
      }
      continue
    }
    if (event.type === 'message.removed') {
      const messageID = stringProperty(properties, 'messageID')
      if (messageID) {
        ensureItems()
        next.items = next.items.filter((item) => item.id !== messageID)
        if (!next.removedMessageIds.includes(messageID)) next.removedMessageIds = [...next.removedMessageIds, messageID]
      }
      continue
    }
    if (event.type === 'message.part.delta') {
      const messageID = stringProperty(properties, 'messageID')
      const partID = stringProperty(properties, 'partID')
      const delta = properties.delta
      if (!messageID || !partID || properties.field !== 'text' || typeof delta !== 'string') continue
      const message = messageID ? mutableMessage(messageID) : undefined
      if (!message) continue
      const part = message.parts.find((item) => item.id === partID)
      if (part?.type === 'text') part.text += delta
      else message.parts.push({ id: partID, type: 'text', text: delta, limited: false })
      const current = message.parts.find((item) => item.id === partID)
      if (current?.type === 'text' && current.text.length > 100_000) {
        current.text = current.text.slice(0, 100_000)
        current.limited = true
      }
      continue
    }
    if (event.type === 'message.part.updated') {
      const part = objectProperty(properties, 'part')
      if (!part) continue
      const messageID = stringProperty(part, 'messageID')
      const partID = stringProperty(part, 'id')
      if (!messageID || !partID) continue
      const message = mutableMessage(messageID)
      if (!message) continue
      const projected = projectTimelinePart(part)
      if (!projected) continue
      const index = message.parts.findIndex((item) => item.id === partID)
      if (index >= 0) message.parts[index] = projected
      else message.parts.push(projected)
      continue
    }
    if (event.type === 'message.part.removed') {
      const messageID = stringProperty(properties, 'messageID')
      const partID = stringProperty(properties, 'partID')
      const message = messageID ? mutableMessage(messageID) : undefined
      if (message && partID) message.parts = message.parts.filter((item) => item.id !== partID)
      continue
    }
    if (event.type === 'session.diff' && Array.isArray(properties.diff)) {
      const changes = properties.diff.slice(0, 40).flatMap((value) => {
        if (!value || typeof value !== 'object') return []
        const diff = value as Record<string, unknown>
        if (typeof diff.file !== 'string') return []
        const patch = typeof diff.patch === 'string' ? diff.patch : undefined
        return [{
          file: diff.file.slice(0, 2_000), status: typeof diff.status === 'string' ? diff.status.slice(0, 100) : 'modified',
          additions: finite(diff.additions), deletions: finite(diff.deletions),
          ...(patch ? { patch: patch.slice(0, 8_000) } : {}), patchLimited: Boolean(patch && patch.length > 8_000), patchOmitted: false,
        }]
      })
      next.changes = changes
      next.changesLimited = properties.diff.length > 40
      next.changesTotal = properties.diff.length
      next.changesAdditions = changes.reduce((sum, item) => sum + item.additions, 0)
      next.changesDeletions = changes.reduce((sum, item) => sum + item.deletions, 0)
    }
  }

  if (itemsChanged) next.items.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  next.turns = projectTurns(next.items, next.busy)
  const assistant = [...next.items].reverse().find((item) => item.role === 'assistant')
  if (assistant) next.context = {
    ...next.context,
    providerID: assistant.metadata.providerID,
    modelID: assistant.metadata.modelID,
    agent: assistant.metadata.agent,
    variant: assistant.metadata.variant,
    tokens: assistant.metadata.tokens,
    cost: assistant.metadata.cost,
    completedAt: assistant.metadata.completedAt,
    updatedAt: Math.max(next.context.updatedAt, assistant.metadata.completedAt ?? assistant.createdAt),
    freshness: 'current',
  }
  return next
}

function liveError(value: unknown) {
  const error = value && typeof value === 'object' ? value as Record<string, unknown> : undefined
  const data = error ? objectProperty(error, 'data') : undefined
  return typeof data?.message === 'string' ? data.message.slice(0, 2_000) : 'Assistant response failed.'
}

function finite(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : 0 }

function objectProperty(value: Record<string, unknown> | undefined, key: string) {
  const property = value?.[key]
  return property && typeof property === 'object' && !Array.isArray(property)
    ? property as Record<string, unknown>
    : undefined
}

function stringProperty(value: Record<string, unknown> | undefined, key: string) {
  const property = value?.[key]
  return typeof property === 'string' ? property : undefined
}
