import type { Project, Session } from '@opencode-ai/sdk/v2/client'

import type { HomeIndex } from '~/lib/home-index'
import {
  createSdkForConnection,
  resolveConnection,
  type ServerConnection,
} from './connections.server'

type HomeClient = {
  project: {
    list(parameters?: undefined, options?: { signal?: AbortSignal }): Promise<{ data: Project[] | undefined }>
  }
  session: {
    list(parameters: {
      roots: true
      limit: number
    }, options?: { signal?: AbortSignal }): Promise<{ data: Session[] | undefined }>
  }
}

const homeLimit = 64

export async function loadHomeIndex(
  serverKey: string,
  connection: ServerConnection = resolveConnection(serverKey),
  client: HomeClient = createSdkForConnection(connection),
): Promise<HomeIndex> {
  if (serverKey !== connection.key) throw new Error('Unknown server')
  const signal = AbortSignal.timeout(650)
  const [projectResult, sessionResult] = await Promise.allSettled([
    client.project.list(undefined, { signal }),
    client.session.list({ roots: true, limit: homeLimit }, { signal }),
  ])
  const projectData = projectResult.status === 'fulfilled' ? projectResult.value.data : undefined
  const sessionData = sessionResult.status === 'fulfilled' ? sessionResult.value.data : undefined
  const now = Date.now()
  const projects = (projectData ?? []).slice(0, homeLimit).map((project) => ({
    id: project.id,
    name: project.name?.trim() || directoryName(project.worktree),
    directory: project.worktree,
    worktrees: [project.worktree, ...project.sandboxes.filter((directory) => directory !== project.worktree)]
      .slice(0, 32)
      .map((directory) => ({ directory, current: directory === project.worktree })),
  }))
  const sessions = (sessionData ?? [])
    .filter((session) => !session.parentID && !session.time.archived)
    .sort((left, right) => right.time.updated - left.time.updated)
    .slice(0, homeLimit)
    .map((session) => ({
      id: session.id,
      title: session.title,
      projectID: session.projectID,
      directory: session.directory,
      updatedAt: session.time.updated,
      updatedLabel: relativeTime(session.time.updated, now),
      group: dateGroup(session.time.updated, now),
    }))

  return {
    projects,
    sessions,
    projectsLimited: (projectData?.length ?? 0) > homeLimit,
    errors: {
      projects: projectData === undefined,
      sessions: sessionData === undefined,
    },
  }
}

function directoryName(directory: string): string {
  const normalized = directory.replaceAll('\\', '/').replace(/\/$/, '')
  return normalized.split('/').at(-1) || directory
}

function dateGroup(value: number, now: number): 'Today' | 'Yesterday' | 'Older' {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (value >= today.getTime()) return 'Today'
  if (value >= yesterday.getTime()) return 'Yesterday'
  return 'Older'
}

function relativeTime(value: number, now: number): string {
  const elapsed = Math.max(0, now - value)
  const formatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })
  if (elapsed < 3_600_000)
    return formatter.format(-Math.max(1, Math.round(elapsed / 60_000)), 'minute')
  if (elapsed < 86_400_000)
    return formatter.format(-Math.round(elapsed / 3_600_000), 'hour')
  return formatter.format(-Math.round(elapsed / 86_400_000), 'day')
}
