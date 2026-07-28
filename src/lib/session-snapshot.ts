export type BoundedValue =
  | null
  | boolean
  | number
  | string
  | BoundedValue[]
  | { [key: string]: BoundedValue }

export type TokenUsage = {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  total: number
}

export type MessageMetadata = {
  parentID?: string | undefined
  agent?: string | undefined
  providerID?: string | undefined
  modelID?: string | undefined
  variant?: string | undefined
  mode?: string | undefined
  finish?: string | undefined
  completedAt?: number | undefined
  cost?: number | undefined
  tokens?: TokenUsage | undefined
  path?: { cwd: string; root: string } | undefined
  summary?: { title?: string | undefined; body?: string | undefined } | undefined
}

export type TimelineTextPart = {
  id: string
  type: 'text' | 'reasoning'
  text: string
  limited: boolean
  synthetic?: boolean | undefined
  startedAt?: number | undefined
  endedAt?: number | undefined
  metadata?: BoundedValue | undefined
}

export type TimelineToolPart = {
  id: string
  type: 'tool'
  callID?: string | undefined
  name: string
  status: 'pending' | 'running' | 'completed' | 'error' | string
  title?: string | undefined
  input?: BoundedValue | undefined
  raw?: string | undefined
  output?: string | undefined
  outputLimited: boolean
  error?: string | undefined
  metadata?: BoundedValue | undefined
  partMetadata?: BoundedValue | undefined
  startedAt?: number | undefined
  endedAt?: number | undefined
  attachments?: Array<{ id: string; filename?: string | undefined; mime: string; url?: string | undefined }> | undefined
}

export type TimelineFilePart = {
  id: string
  type: 'file'
  filename?: string | undefined
  mime: string
  url?: string | undefined
  source?: BoundedValue | undefined
}

export type TimelineStatusPart = {
  id: string
  type: 'status'
  kind: 'subtask' | 'retry' | 'compaction' | 'step-start' | 'step-finish' | 'patch' | 'agent' | 'snapshot' | string
  label: string
  detail?: string | undefined
  metadata?: BoundedValue | undefined
}

export type SessionTimelinePart = TimelineTextPart | TimelineToolPart | TimelineFilePart | TimelineStatusPart

export type SessionTimelineItem = {
  id: string
  role: 'user' | 'assistant'
  createdAt: number
  createdLabel: string
  error?: string | undefined
  errorName?: string | undefined
  metadata: MessageMetadata
  parts: SessionTimelinePart[]
}

export type SessionTurn = {
  id: string
  user: SessionTimelineItem
  assistants: SessionTimelineItem[]
  startedAt: number
  completedAt?: number | undefined
  cost: number
  tokens: TokenUsage
  status: 'working' | 'completed' | 'failed' | 'interrupted'
}

export type SessionHistoryPage = { items: SessionTimelineItem[]; cursor?: string; complete: boolean }
export type SessionFileDiff = { file: string; patch: string; limited: boolean }
export type SessionChange = {
  file: string
  status: string
  additions: number
  deletions: number
  patch?: string | undefined
  patchLimited: boolean
  patchOmitted: boolean
}

export type SessionContext = {
  providerID?: string | undefined
  modelID?: string | undefined
  agent?: string | undefined
  variant?: string | undefined
  tokens?: TokenUsage | undefined
  contextLimit?: number | undefined
  contextPercent?: number | undefined
  cost?: number | undefined
  createdAt: number
  updatedAt: number
  completedAt?: number | undefined
  freshness: 'current' | 'estimated' | 'unavailable'
}

export type SessionSnapshot = {
  id: string
  title: string
  directory: string
  parentID?: string
  children: Array<{ id: string; title: string }>
  childrenLimited: boolean
  shareUrl?: string
  sharingEnabled: boolean
  revertMessageID?: string
  revertUndoMessageID?: string
  revertedTurns: Array<{ id: string; label: string }>
  revertsLimited: boolean
  items: SessionTimelineItem[]
  turns: SessionTurn[]
  removedMessageIds: string[]
  hasOlder: boolean
  historyCursor?: string
  busy: boolean
  permission?: {
    id: string
    sessionID: string
    permission: string
    patterns: string[]
    always: string[]
    complete: boolean
  }
  question?: {
    id: string
    sessionID: string
    questions: Array<{
      header: string
      question: string
      options: Array<{ label: string; description: string }>
      multiple: boolean
      custom: boolean
    }>
    complete: boolean
  }
  requestsUnavailable: boolean
  todos: Array<{ content: string; status: string; priority: string }>
  todosLimited: boolean
  todosUnavailable: boolean
  changes: SessionChange[]
  changesLimited: boolean
  changesTotal: number
  changesAdditions: number
  changesDeletions: number
  changeMessageId?: string
  context: SessionContext
  branch?: string
  defaultBranch?: string
}

export const emptyTokens = (): TokenUsage => ({
  input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0,
})

export function projectTurns(items: SessionTimelineItem[], busy = false): SessionTurn[] {
  const turns: SessionTurn[] = []
  const turnsByID = new Map<string, SessionTurn>()
  for (const item of items) {
    if (item.role === 'user') {
      const turn: SessionTurn = { id: item.id, user: item, assistants: [], startedAt: item.createdAt, cost: 0, tokens: emptyTokens(), status: 'completed' }
      turns.push(turn)
      turnsByID.set(item.id, turn)
      continue
    }
    const turn = (item.metadata.parentID ? turnsByID.get(item.metadata.parentID) : undefined) ?? turns.at(-1)
    if (!turn) continue
    turn.assistants.push(item)
    turn.cost += item.metadata.cost ?? 0
    const tokens = item.metadata.tokens
    if (tokens) for (const key of Object.keys(turn.tokens) as Array<keyof TokenUsage>) turn.tokens[key] += tokens[key]
    turn.completedAt = item.metadata.completedAt
    if (item.errorName === 'MessageAbortedError') turn.status = 'interrupted'
    else if (item.error) turn.status = 'failed'
  }
  if (busy && turns.length) turns[turns.length - 1]!.status = 'working'
  return turns
}
