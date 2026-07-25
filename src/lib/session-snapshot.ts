export type SessionTimelineItem = {
  id: string
  role: 'user' | 'assistant'
  createdAt: number
  createdLabel: string
  error?: string
  parts: Array<
    | { id: string; type: 'text'; text: string }
    | { id: string; type: 'tool'; name: string; status: string; title?: string }
    | { id: string; type: 'status'; label: string }
  >
}

export type SessionSnapshot = {
  id: string
  title: string
  directory: string
  items: SessionTimelineItem[]
  hasOlder: boolean
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
}
