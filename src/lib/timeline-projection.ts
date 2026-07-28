import type { BoundedValue, MessageMetadata, SessionTimelineItem, SessionTimelinePart, TimelineToolPart, TokenUsage } from './session-snapshot'

const TEXT_LIMIT = 100_000
const TOOL_OUTPUT_LIMIT = 64_000
const JSON_LIMIT = 32_000

export function projectTimelineMessage(info: Record<string, unknown>, parts: Array<Record<string, unknown>>): SessionTimelineItem | undefined {
  const id = stringValue(info.id, 500)
  if (!id || (info.role !== 'user' && info.role !== 'assistant')) return
  const createdAt = safeTime(objectValue(info.time)?.created)
  const error = objectValue(info.error)
  return {
    id,
    role: info.role,
    createdAt,
    createdLabel: formatTime(createdAt),
    ...(error ? { error: errorMessage(error), errorName: stringValue(error.name, 100) } : {}),
    metadata: projectMessageMetadata(info),
    parts: parts.flatMap((part) => {
      const projected = projectTimelinePart(part)
      return projected ? [projected] : []
    }),
  }
}

export function projectMessageMetadata(info: Record<string, unknown>): MessageMetadata {
  const time = objectValue(info.time)
  const model = objectValue(info.model)
  const path = objectValue(info.path)
  const summary = objectValue(info.summary)
  const tokens = projectTokens(info.tokens)
  return compact({
    parentID: stringValue(info.parentID, 500),
    agent: stringValue(info.agent, 200),
    providerID: stringValue(info.providerID, 300) ?? stringValue(model?.providerID, 300),
    modelID: stringValue(info.modelID, 300) ?? stringValue(model?.modelID, 300),
    variant: stringValue(info.variant, 200) ?? stringValue(model?.variant, 200),
    mode: stringValue(info.mode, 100),
    finish: stringValue(info.finish, 100),
    completedAt: optionalTime(time?.completed),
    cost: finiteNumber(info.cost),
    tokens,
    path: path ? { cwd: stringValue(path.cwd, 2_000) ?? '', root: stringValue(path.root, 2_000) ?? '' } : undefined,
    summary: summary ? compact({ title: stringValue(summary.title, 500), body: stringValue(summary.body, 4_000) }) : undefined,
  })
}

export function projectTimelinePart(part: Record<string, unknown>): SessionTimelinePart | undefined {
  const id = stringValue(part.id, 500)
  const type = stringValue(part.type, 100)
  if (!id || !type) return
  if ((type === 'text' || type === 'reasoning') && typeof part.text === 'string') {
    if (type === 'text' && (part.ignored || part.synthetic)) return
    const time = objectValue(part.time)
    return compact({
      id, type: type as 'text' | 'reasoning', text: part.text.slice(0, TEXT_LIMIT), limited: part.text.length > TEXT_LIMIT,
      synthetic: part.synthetic === true || undefined,
      startedAt: optionalTime(time?.start), endedAt: optionalTime(time?.end),
      metadata: boundedValue(part.metadata),
    })
  }
  if (type === 'tool') return projectToolPart(id, part)
  if (type === 'file') {
    return compact({
      id, type: 'file' as const, filename: stringValue(part.filename, 500), mime: stringValue(part.mime, 200) ?? 'application/octet-stream',
      url: safeResourceUrl(part.url), source: boundedValue(part.source),
    })
  }
  const labels: Record<string, string> = {
    subtask: 'Subtask', retry: 'Retrying response', compaction: 'Conversation compacted',
    'step-start': 'Turn started', 'step-finish': 'Turn finished', patch: 'Files changed',
    agent: 'Agent changed', snapshot: 'Snapshot created',
  }
  const detail = type === 'subtask' ? stringValue(part.description, 2_000)
    : type === 'retry' ? `Attempt ${finiteNumber(part.attempt) ?? ''}`.trim()
    : type === 'patch' && Array.isArray(part.files) ? part.files.slice(0, 100).filter((value): value is string => typeof value === 'string').join(', ').slice(0, 4_000)
    : type === 'agent' ? stringValue(part.name, 200) : undefined
  if (!labels[type]) return
  return { id, type: 'status', kind: type, label: labels[type], ...(detail ? { detail } : {}), metadata: boundedValue(part) }
}

function projectToolPart(id: string, part: Record<string, unknown>): TimelineToolPart {
  const state = objectValue(part.state) ?? {}
  const output = typeof state.output === 'string' ? state.output : undefined
  const time = objectValue(state.time)
  const attachments = Array.isArray(state.attachments) ? state.attachments.slice(0, 10).flatMap((value) => {
    const item = objectValue(value)
    const itemID = stringValue(item?.id, 500)
    if (!itemID) return []
    return [compact({ id: itemID, filename: stringValue(item?.filename, 500), mime: stringValue(item?.mime, 200) ?? 'application/octet-stream', url: safeResourceUrl(item?.url) })]
  }) : undefined
  return compact({
    id, type: 'tool' as const, callID: stringValue(part.callID, 500), name: stringValue(part.tool, 200) ?? 'tool',
    status: stringValue(state.status, 100) ?? 'pending', title: stringValue(state.title, 500),
    input: boundedValue(state.input), raw: stringValue(state.raw, 8_000),
    output: output?.slice(0, TOOL_OUTPUT_LIMIT), outputLimited: Boolean(output && output.length > TOOL_OUTPUT_LIMIT),
    error: stringValue(state.error, 16_000), metadata: boundedValue(state.metadata), partMetadata: boundedValue(part.metadata),
    startedAt: optionalTime(time?.start), endedAt: optionalTime(time?.end), attachments,
  })
}

export function projectTokens(value: unknown): TokenUsage | undefined {
  const tokens = objectValue(value)
  if (!tokens) return
  const cache = objectValue(tokens.cache)
  const result = {
    input: nonNegative(tokens.input), output: nonNegative(tokens.output), reasoning: nonNegative(tokens.reasoning),
    cacheRead: nonNegative(cache?.read), cacheWrite: nonNegative(cache?.write), total: nonNegative(tokens.total),
  }
  if (!result.total) result.total = result.input + result.output + result.reasoning + result.cacheRead + result.cacheWrite
  return result
}

export function boundedValue(value: unknown, maximum = JSON_LIMIT): BoundedValue | undefined {
  let budget = maximum
  const visit = (input: unknown, depth: number): BoundedValue | undefined => {
    if (budget <= 0 || depth > 8) return
    if (input === null || typeof input === 'boolean') return input
    if (typeof input === 'number') return Number.isFinite(input) ? input : undefined
    if (typeof input === 'string') { const next = input.slice(0, budget); budget -= next.length; return next }
    if (Array.isArray(input)) return input.slice(0, 100).flatMap((item) => { const next = visit(item, depth + 1); return next === undefined ? [] : [next] })
    if (!input || typeof input !== 'object') return
    const output: Record<string, BoundedValue> = {}
    for (const [key, item] of Object.entries(input as Record<string, unknown>).slice(0, 100)) {
      const next = visit(item, depth + 1)
      if (next !== undefined) output[key.slice(0, 200)] = next
    }
    return output
  }
  return visit(value, 0)
}

function errorMessage(error: Record<string, unknown>) {
  const data = objectValue(error.data)
  return stringValue(data?.message, 2_000) ?? stringValue(error.message, 2_000) ?? 'The assistant response failed.'
}

function safeResourceUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 16_000) return
  return /^(data:|https?:|file:)/.test(value) ? value : undefined
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function stringValue(value: unknown, maximum: number) { return typeof value === 'string' ? value.slice(0, maximum) : undefined }
function finiteNumber(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }
function nonNegative(value: unknown) { const number = finiteNumber(value); return number && number > 0 ? number : 0 }
function safeTime(value: unknown) { return optionalTime(value) ?? 0 }
function optionalTime(value: unknown) { const number = finiteNumber(value); return number !== undefined && number >= 0 && number <= 8_640_000_000_000_000 ? number : undefined }
function formatTime(value: number) { return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(value) }
function compact<T extends object>(value: T): T { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T }
