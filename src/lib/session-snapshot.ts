export type SessionTimelineItem = {
  id: string
  role: 'user' | 'assistant'
  createdAt: number
  createdLabel: string
  error?: string
  parts: Array<
    | { id: string; type: 'text'; text: string; limited: boolean }
    | {
        id: string
        type: 'tool'
        name: string
        status: string
        title?: string
        input?: string
        output?: string
        outputLimited: boolean
        error?: string
      }
    | { id: string; type: 'status'; label: string }
  >
}

export type SessionHistoryPage = {
  items: SessionTimelineItem[]
  cursor?: string
  complete: boolean
}

export type SessionFileDiff = { file: string; patch: string; limited: boolean }

export type SessionSnapshot = {
  id: string
  title: string
  directory: string
  items: SessionTimelineItem[]
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
  changes: Array<{
    file: string
    status: string
    additions: number
    deletions: number
    patch?: string
    patchLimited: boolean
    patchOmitted: boolean
  }>
  changesLimited: boolean
  changesTotal: number
  changesAdditions: number
  changesDeletions: number
  changeMessageId?: string
}
