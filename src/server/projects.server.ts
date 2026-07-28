import type { FileNode, Project, Worktree } from '@opencode-ai/sdk/v2/client'
import { createSdkForConnection, resolveConnection, type ServerConnection } from './connections.server'

type ProjectClient = {
  path: { get(input?: { directory?: string }, options?: { signal?: AbortSignal }): Promise<{ data: { home: string; directory: string } | undefined }> }
  file: { list(input: { directory: string; path: string }, options?: { signal?: AbortSignal }): Promise<{ data: FileNode[] | undefined }> }
  project: {
    current(input: { directory: string }, options?: { signal?: AbortSignal }): Promise<{ data: Project | undefined }>
    update(input: { projectID: string; name?: string; icon?: { color?: string } }, options?: { signal?: AbortSignal }): Promise<{ data: Project | undefined }>
  }
  worktree: {
    list(input: { directory: string }, options?: { signal?: AbortSignal }): Promise<{ data: string[] | undefined }>
    create(input: { directory: string; worktreeCreateInput?: { name?: string } }, options?: { signal?: AbortSignal }): Promise<{ data: Worktree | undefined }>
    reset(input: { directory: string; worktreeResetInput: { directory: string } }, options?: { signal?: AbortSignal }): Promise<{ data: boolean | undefined }>
    remove(input: { directory: string; worktreeRemoveInput: { directory: string } }, options?: { signal?: AbortSignal }): Promise<{ data: boolean | undefined }>
  }
}

const orphanedWorktrees = new Map<string, Set<string>>()

export async function browseDirectories(serverKey: string, directory?: string, connection: ServerConnection = resolveConnection(serverKey), client: ProjectClient = createSdkForConnection(connection)) {
  assertServer(serverKey, connection)
  const signal = AbortSignal.timeout(5_000)
  const paths = await client.path.get(undefined, { signal })
  const current = directory?.trim() || paths.data?.home || paths.data?.directory
  if (!current || current.length > 4_096) throw new Error('Directory is unavailable')
  const result = await client.file.list({ directory: current, path: '.' }, { signal })
  return {
    directory: current,
    home: paths.data?.home ?? current,
    directories: (result.data ?? []).filter((node) => node.type === 'directory' && !node.ignored).slice(0, 200).map((node) => ({ name: node.name, directory: node.absolute })),
  }
}

export async function openProject(serverKey: string, directory: string, connection: ServerConnection = resolveConnection(serverKey), client: ProjectClient = createSdkForConnection(connection)) {
  assertServer(serverKey, connection)
  const selected = directory.trim()
  if (!selected || selected.length > 4_096) throw new Error('Choose a valid directory')
  const result = await client.project.current({ directory: selected }, { signal: AbortSignal.timeout(5_000) })
  if (!result.data) throw new Error('The project could not be opened')
  return { projectID: result.data.id, directory: result.data.worktree }
}

export async function renameProject(serverKey: string, projectID: string, name: string, color?: string, connection: ServerConnection = resolveConnection(serverKey), client: ProjectClient = createSdkForConnection(connection)) {
  assertServer(serverKey, connection)
  const clean = name.trim()
  if (clean.length > 100) throw new Error('Project names must be 100 characters or fewer')
  const iconColor = color?.trim() ?? ''
  if (iconColor && !/^#[0-9a-fA-F]{6}$/.test(iconColor)) throw new Error('Project colors must use six-digit hex notation')
  const result = await client.project.update({ projectID, name: clean, icon: { color: iconColor } }, { signal: AbortSignal.timeout(5_000) })
  if (!result.data) throw new Error('The project could not be updated')
  return { projectID, name: result.data.name ?? '' }
}

export async function mutateWorktree(serverKey: string, projectDirectory: string, action: 'list' | 'create' | 'reset' | 'remove', value?: string, connection: ServerConnection = resolveConnection(serverKey), client: ProjectClient = createSdkForConnection(connection)) {
  assertServer(serverKey, connection)
  const directory = projectDirectory.trim()
  if (!directory || directory.length > 4_096) throw new Error('Invalid project directory')
  const signal = AbortSignal.timeout(30_000)
  if (action === 'list') {
    const result = await client.worktree.list({ directory }, { signal })
    return { directories: result.data ?? [] }
  }
  if (action === 'create') {
    const name = value?.trim()
    if (name && name.length > 100) throw new Error('Worktree names must be 100 characters or fewer')
    const result = await client.worktree.create({ directory, ...(name ? { worktreeCreateInput: { name } } : {}) }, { signal })
    if (!result.data) throw new Error('The worktree could not be created')
    const key = `${serverKey}\0${directory}`
    const orphans = orphanedWorktrees.get(key) ?? new Set<string>()
    orphans.add(result.data.directory)
    orphanedWorktrees.set(key, orphans)
    return { directory: result.data.directory, orphaned: true }
  }
  const target = value?.trim()
  if (!target || target === directory) throw new Error('Choose a non-primary worktree')
  const result = action === 'reset'
    ? await client.worktree.reset({ directory, worktreeResetInput: { directory: target } }, { signal })
    : await client.worktree.remove({ directory, worktreeRemoveInput: { directory: target } }, { signal })
  if (result.data !== true) throw new Error(`The worktree could not be ${action === 'reset' ? 'reset' : 'removed'}`)
  if (action === 'remove') orphanedWorktrees.get(`${serverKey}\0${directory}`)?.delete(target)
  return { directory: target }
}

export function isOrphanedWorktree(serverKey: string, projectDirectory: string, directory: string) {
  return orphanedWorktrees.get(`${serverKey}\0${projectDirectory}`)?.has(directory) ?? false
}

export function claimWorktree(serverKey: string, projectDirectory: string, directory: string) {
  orphanedWorktrees.get(`${serverKey}\0${projectDirectory}`)?.delete(directory)
}

function assertServer(serverKey: string, connection: ServerConnection) {
  if (serverKey !== connection.key) throw new Error('Unknown server')
}
