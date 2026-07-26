import type { SessionSnapshot } from './session-snapshot'
import type { NormalizedGlobalEvent } from './live-store'

export function applyLiveSessionEvents(
  snapshot: SessionSnapshot,
  events: NormalizedGlobalEvent[],
): SessionSnapshot {
  if (!events.length) return snapshot
  let next: SessionSnapshot = {
    ...snapshot,
    removedMessageIds: [...snapshot.removedMessageIds],
    items: snapshot.items.map((item) => ({
      ...item,
      parts: item.parts.map((part) => ({ ...part })),
    })),
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
      if (!id || (role !== 'user' && role !== 'assistant')) continue
      const existing = next.items.find((item) => item.id === id)
      if (existing) {
        if (role === 'assistant' && info?.error) existing.error = 'Assistant response failed.'
      } else {
        const created = objectProperty(info, 'time')?.created
        const createdAt = typeof created === 'number' && Number.isFinite(created) &&
          created >= 0 && created <= 8_640_000_000_000_000 ? created : Date.now()
        next.items.push({
          id,
          role,
          createdAt,
          createdLabel: new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          parts: [],
        })
      }
      continue
    }
    if (event.type === 'message.removed') {
      const messageID = stringProperty(properties, 'messageID')
      if (messageID) {
        next.items = next.items.filter((item) => item.id !== messageID)
        if (!next.removedMessageIds.includes(messageID)) next.removedMessageIds.push(messageID)
      }
      continue
    }
    if (event.type === 'message.part.delta') {
      const messageID = stringProperty(properties, 'messageID')
      const partID = stringProperty(properties, 'partID')
      const delta = properties.delta
      if (!messageID || !partID || properties.field !== 'text' || typeof delta !== 'string') continue
      const message = next.items.find((item) => item.id === messageID)
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
      const message = next.items.find((item) => item.id === messageID)
      if (!message) continue
      const projected = projectPart(part)
      if (!projected) continue
      const index = message.parts.findIndex((item) => item.id === partID)
      if (index >= 0) message.parts[index] = projected
      else message.parts.push(projected)
      continue
    }
    if (event.type === 'message.part.removed') {
      const messageID = stringProperty(properties, 'messageID')
      const partID = stringProperty(properties, 'partID')
      const message = next.items.find((item) => item.id === messageID)
      if (message && partID) message.parts = message.parts.filter((item) => item.id !== partID)
    }
  }

  next.items.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  return next
}

function projectPart(part: Record<string, unknown>): SessionSnapshot['items'][number]['parts'][number] | undefined {
  const id = stringProperty(part, 'id')
  const type = stringProperty(part, 'type')
  if (!id || !type) return undefined
  if (type === 'text' && typeof part.text === 'string') {
    return {
      id,
      type: 'text',
      text: part.text.slice(0, 100_000),
      limited: part.text.length > 100_000,
    }
  }
  if (type === 'tool') {
    const state = objectProperty(part, 'state')
    const input = boundedJson(state?.input, 4_000)
    const output = typeof state?.output === 'string' ? state.output : undefined
    return {
      id,
      type: 'tool',
      name: typeof part.tool === 'string' ? part.tool.slice(0, 200) : 'Tool',
      status: typeof state?.status === 'string' ? state.status.slice(0, 100) : 'pending',
      outputLimited: false,
      ...(input ? { input } : {}),
      ...(output ? { output: output.slice(0, 16_000), outputLimited: output.length > 16_000 } : {}),
      ...(typeof state?.error === 'string' ? { error: state.error.slice(0, 4_000) } : {}),
      ...(typeof state?.title === 'string' ? { title: state.title.slice(0, 500) } : {}),
    }
  }
  return undefined
}

function boundedJson(value: unknown, maximum: number) {
  try {
    const text = JSON.stringify(value, null, 2)
    return text.length > maximum ? `${text.slice(0, maximum)}...` : text
  } catch {
    return undefined
  }
}

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
