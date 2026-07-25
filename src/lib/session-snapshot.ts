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
}
