export type PromptContextItem = {
  id: string
  type: 'file' | 'diff'
  label: string
  text: string
}

const maximumItems = 20
const maximumContextCharacters = 32_000
const maximumPromptCharacters = 100_000
const lockedDrafts = new Set<string>()

export function parsePromptContexts(value: unknown): PromptContextItem[] {
  if (!Array.isArray(value)) return []
  const output: PromptContextItem[] = []
  let characters = 0
  for (const item of value) {
    if (!validContext(item)) continue
    characters += item.text.length
    if (characters > maximumContextCharacters || output.length >= maximumItems) break
    const existing = output.findIndex((candidate) => candidate.id === item.id)
    if (existing >= 0) output[existing] = item
    else output.push(item)
  }
  return output
}

export function addPromptContext(current: PromptContextItem[], value: unknown) {
  if (!validContext(value)) return { ok: false as const, reason: 'context-limit' as const }
  const withoutDuplicate = current.filter((item) => item.id !== value.id)
  const next = [...withoutDuplicate, value]
  if (next.length > maximumItems || next.reduce((sum, item) => sum + item.text.length, 0) > maximumContextCharacters) {
    return { ok: false as const, reason: 'context-limit' as const }
  }
  return { ok: true as const, value: next }
}

export function buildPromptText(text: string, contexts: PromptContextItem[]) {
  const context = contexts.map((item) => item.text).join('\n\n')
  const value = `${text}${text && context ? '\n\n' : ''}${context}`
  return value.length <= maximumPromptCharacters ? value : undefined
}

export function setPromptContextLock(key: string, locked: boolean) {
  if (locked) lockedDrafts.add(key)
  else lockedDrafts.delete(key)
}

export function promptContextLocked(key: string) { return lockedDrafts.has(key) }

export function promptContextID(type: PromptContextItem['type'], label: string) {
  let hash = 2166136261
  for (const character of `${type}:${label}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return `${type}_${(hash >>> 0).toString(36)}`
}

function validContext(value: unknown): value is PromptContextItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(item.id) &&
    (item.type === 'file' || item.type === 'diff') && typeof item.label === 'string' &&
    item.label.length > 0 && item.label.length <= 500 && typeof item.text === 'string' &&
    item.text.length > 0 && item.text.length <= maximumContextCharacters
}
