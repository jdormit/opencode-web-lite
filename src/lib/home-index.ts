export type HomeProject = {
  id: string
  name: string
  directory: string
}

export type HomeSession = {
  id: string
  title: string
  projectID: string
  directory: string
  updatedAt: number
  updatedLabel: string
  group: 'Today' | 'Yesterday' | 'Older'
}

export type HomeIndex = {
  projects: HomeProject[]
  sessions: HomeSession[]
  projectsLimited: boolean
  errors: { projects: boolean; sessions: boolean }
}
