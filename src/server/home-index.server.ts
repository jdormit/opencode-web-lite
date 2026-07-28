import type { Project, Session, SessionStatus } from '@opencode-ai/sdk/v2/client'

import type { HomeIndex, HomeIndexQuery } from '~/lib/home-index'
import {
  createSdkForConnection,
  resolveConnection,
  type ServerConnection,
} from './connections.server'
import { isOrphanedWorktree } from './projects.server'

type HomeClient = {
  project: {
    list(parameters?: undefined, options?: { signal?: AbortSignal }): Promise<{ data: Project[] | undefined }>
  }
  session: {
    list(parameters: {
      roots: true
      limit: number
      start?: number
      search?: string
      directory?: string
    }, options?: { signal?: AbortSignal }): Promise<{ data: Session[] | undefined }>
    status?(parameters?: undefined, options?: { signal?: AbortSignal }): Promise<{ data: Record<string, SessionStatus> | undefined }>
  }
}

const homeLimit = 64

export async function loadHomeIndex(
  serverKey: string,
  connection: ServerConnection = resolveConnection(serverKey),
  client: HomeClient = createSdkForConnection(connection),
  query: HomeIndexQuery = {},
): Promise<HomeIndex> {
  if (serverKey !== connection.key) throw new Error('Unknown server')
  const signal = AbortSignal.timeout(650)
  const limit = Math.min(64, Math.max(1, query.limit ?? 32))
  const start = Math.max(0, query.start ?? 0)
  const fetchLimit = Math.min(homeLimit, start + limit + 1)
  const [projectResult, sessionResult, statusResult] = await Promise.allSettled([
    client.project.list(undefined, { signal }),
    client.session.list({
      roots: true,
      limit: fetchLimit,
      ...(query.search ? { search: query.search } : {}),
    }, { signal }),
    client.session.status ? client.session.status(undefined, { signal }) : Promise.resolve({ data: {} }),
  ])
  const projectData = projectResult.status === 'fulfilled' ? projectResult.value.data : undefined
  const sessionData = sessionResult.status === 'fulfilled' ? sessionResult.value.data : undefined
  const statuses: Record<string, SessionStatus> = statusResult.status === 'fulfilled' ? statusResult.value.data ?? {} : {}
  const now = Date.now()
  const projects = (projectData ?? []).slice(0, homeLimit).map((project) => ({
    serverKey,
    serverLabel: connection.label,
    id: project.id,
    name: project.name?.trim() || directoryName(project.worktree),
    directory: project.worktree,
    status: 'idle' as 'idle' | 'working' | 'error',
    ...(project.icon?.color ? { iconColor: project.icon.color } : {}),
    worktrees: [project.worktree, ...project.sandboxes.filter((directory) => directory !== project.worktree)]
      .slice(0, 32)
       .map((directory) => ({ directory, current: directory === project.worktree, ...(isOrphanedWorktree(serverKey, project.worktree, directory) ? { orphaned: true } : {}) })),
  }))
  const projectByID = new Map(projects.map((project) => [project.id, project]))
  const filtered = (sessionData ?? [])
    .filter((session) => !session.parentID && !session.time.archived)
    .filter((session) => !query.projectID || session.projectID === query.projectID)
    .sort((left, right) => right.time.updated - left.time.updated)
  const sessions = filtered
    .slice(start, start + limit)
    .map((session) => ({
      serverKey,
      serverLabel: connection.label,
      id: session.id,
      title: session.title,
      projectID: session.projectID,
      directory: session.directory,
      updatedAt: session.time.updated,
      updatedLabel: relativeTime(session.time.updated, now),
      group: dateGroup(session.time.updated, now),
      projectName: projectByID.get(session.projectID)?.name ?? directoryName(session.directory),
      worktreeName: directoryName(session.directory),
      status: statuses[session.id]?.type === 'busy' ? 'working' as const : statuses[session.id]?.type === 'retry' ? 'retry' as const : 'idle' as const,
    }))

  for (const project of projects) {
    const projectSessions = sessions.filter((session) => session.projectID === project.id)
    project.status = projectSessions.some((session) => session.status === 'retry')
      ? 'error'
      : projectSessions.some((session) => session.status === 'working') ? 'working' : 'idle'
  }

  return {
    projects,
    sessions,
    projectsLimited: (projectData?.length ?? 0) > homeLimit,
    sessionsLimited: filtered.length > start + limit || (sessionData?.length ?? 0) === fetchLimit,
    ...(filtered.length > start + limit || (sessionData?.length ?? 0) === fetchLimit
      ? { nextStart: start + sessions.length }
      : {}),
    errors: {
      projects: projectData === undefined,
      sessions: sessionData === undefined,
    },
  }
}

export async function loadAllHomeIndices(query: HomeIndexQuery = {}): Promise<HomeIndex> {
  const { getConnectionRegistry } = await import('./connections.server')
  const registry = getConnectionRegistry()
  const start = Math.max(0, query.start ?? 0)
  const limit = Math.min(64, Math.max(1, query.limit ?? 32))
  const fetchLimit = Math.min(64, start + limit)
  const results = await Promise.all(registry.list().map((connection) =>
    loadHomeIndex(connection.key, connection, createSdkForConnection(connection), { ...query, start: 0, limit: fetchLimit }).catch((): HomeIndex => ({
      projects: [], sessions: [], projectsLimited: false, sessionsLimited: false,
      errors: { projects: true, sessions: true },
    }))))
  const allSessions = results.flatMap((result) => result.sessions).sort((a, b) => b.updatedAt - a.updatedAt)
  const sessions = allSessions.slice(start, start + limit)
  const sessionsLimited = allSessions.length > start + limit || results.some((result) => result.sessionsLimited)
  return {
    projects: results.flatMap((result) => result.projects),
    sessions,
    projectsLimited: results.some((result) => result.projectsLimited),
    sessionsLimited,
    ...(sessionsLimited ? { nextStart: start + sessions.length } : {}),
    errors: {
      projects: results.every((result) => result.errors.projects),
      sessions: results.every((result) => result.errors.sessions),
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
