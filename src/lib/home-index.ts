export type HomeProject = {
  serverKey: string
  serverLabel: string
  id: string
  name: string
  directory: string
  status: 'idle' | 'working' | 'error'
  iconColor?: string
  worktrees: Array<{ directory: string; current: boolean; orphaned?: boolean }>
}

export type HomeSession = {
  serverKey: string
  serverLabel: string
  id: string
  title: string
  projectID: string
  directory: string
  updatedAt: number
  updatedLabel: string
  group: 'Today' | 'Yesterday' | 'Older'
  projectName: string
  worktreeName: string
  status: 'idle' | 'working' | 'retry'
}

export type HomeIndex = {
  projects: HomeProject[]
  sessions: HomeSession[]
  projectsLimited: boolean
  sessionsLimited: boolean
  nextStart?: number
  errors: { projects: boolean; sessions: boolean }
}

export type HomeIndexQuery = {
  search?: string
  projectID?: string
  start?: number
  limit?: number
}
