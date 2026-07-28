export type ComposerMode = 'normal' | 'shell'

export type ComposerMention =
  | { id: string; type: 'file'; path: string; label: string; start: number; end: number }
  | { id: string; type: 'agent'; name: string; label: string; start: number; end: number }

export type ComposerMentionInput =
  | { id: string; type: 'file'; path: string; label: string }
  | { id: string; type: 'agent'; name: string; label: string }

export type ComposerAttachment = {
  id: string
  file: File
  mime: string
  preview?: string
}

export type ComposerState = {
  text: string
  mode: ComposerMode
  mentions: ComposerMention[]
  attachments: ComposerAttachment[]
}

export type StoredComposerDraft = Pick<ComposerState, 'text' | 'mode' | 'mentions'> & {
  attachmentsOmitted?: boolean
}

export const COMPOSER_HISTORY_LIMIT = 100

export function parseStoredDraft(value: unknown): StoredComposerDraft | undefined {
  if (!value || typeof value !== 'object') return
  const item = value as Record<string, unknown>
  if (typeof item.text !== 'string' || item.text.length > 100_000) return
  const mode = item.mode === 'shell' ? 'shell' : 'normal'
  const mentions = parseMentions(item.mentions, item.text)
  return { text: item.text, mode, mentions, attachmentsOmitted: item.attachmentsOmitted === true }
}

export function parseMentions(value: unknown, text: string): ComposerMention[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 50).flatMap((raw): ComposerMention[] => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    if (typeof item.id !== 'string' || typeof item.label !== 'string' ||
      !Number.isInteger(item.start) || !Number.isInteger(item.end)) return []
    const start = item.start as number
    const end = item.end as number
    if (start < 0 || end <= start || end > text.length || text.slice(start, end) !== item.label) return []
    if (item.type === 'file' && typeof item.path === 'string' && validProjectPath(item.path))
      return [{ id: item.id, type: 'file', path: item.path, label: item.label, start, end }]
    if (item.type === 'agent' && typeof item.name === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(item.name))
      return [{ id: item.id, type: 'agent', name: item.name, label: item.label, start, end }]
    return []
  })
}

export function insertMention(
  text: string,
  mentions: ComposerMention[],
  triggerStart: number,
  caret: number,
  mention: ComposerMentionInput,
) {
  const label = mention.label
  const suffix = text[caret] === ' ' ? '' : ' '
  const nextText = text.slice(0, triggerStart) + label + suffix + text.slice(caret)
  const delta = label.length + suffix.length - (caret - triggerStart)
  const nextMentions = mentions.flatMap((item) => {
    if (item.end <= triggerStart) return [item]
    if (item.start >= caret) return [{ ...item, start: item.start + delta, end: item.end + delta }]
    return []
  })
  nextMentions.push({ ...mention, start: triggerStart, end: triggerStart + label.length } as ComposerMention)
  return { text: nextText, mentions: nextMentions, caret: triggerStart + label.length + suffix.length }
}

export function reconcileMentions(previous: string, next: string, mentions: ComposerMention[]) {
  if (previous === next) return mentions
  let prefix = 0
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1
  let oldSuffix = previous.length
  let newSuffix = next.length
  while (oldSuffix > prefix && newSuffix > prefix && previous[oldSuffix - 1] === next[newSuffix - 1]) {
    oldSuffix -= 1
    newSuffix -= 1
  }
  const delta = newSuffix - oldSuffix
  return mentions.flatMap((item) => {
    if (item.end <= prefix) return [item]
    if (item.start >= oldSuffix) return [{ ...item, start: item.start + delta, end: item.end + delta }]
    return []
  }).filter((item) => next.slice(item.start, item.end) === item.label)
}

export function historyNavigate(
  entries: string[], index: number, saved: string | undefined, direction: 'up' | 'down',
) {
  if (direction === 'up') {
    if (!entries.length || index >= entries.length - 1) return
    const next = index + 1
    return { value: entries[next]!, index: next, saved }
  }
  if (index < 0) return
  if (index === 0) return { value: saved ?? '', index: -1, saved: undefined }
  const next = index - 1
  return { value: entries[next]!, index: next, saved }
}

export function addHistory(entries: string[], value: string) {
  const normalized = value.trim()
  if (!normalized) return entries
  return [normalized, ...entries.filter((entry) => entry !== normalized)].slice(0, COMPOSER_HISTORY_LIMIT)
}

function validProjectPath(path: string) {
  return path.length > 0 && path.length <= 2_000 && !path.includes('\0') && !path.startsWith('/') &&
    !/^[A-Za-z]:[\\/]/.test(path) && !path.split(/[\\/]/).includes('..')
}
