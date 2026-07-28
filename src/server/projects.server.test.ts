import { describe, expect, test } from 'bun:test'
import type { Project } from '@opencode-ai/sdk/v2/client'
import { browseDirectories, mutateWorktree, openProject, renameProject } from './projects.server'
import type { ServerConnection } from './connections.server'

const connection: ServerConnection = { key: 'server_test', label: 'Test', url: 'https://code.example' }
const project = { id: 'project_1', worktree: '/repo', sandboxes: [], time: { created: 1, updated: 1 } } satisfies Project

function client() {
  return {
    path: { get: async () => ({ data: { home: '/home/nova', directory: '/repo' } }) },
    file: { list: async () => ({ data: [{ name: 'repo', path: 'repo', absolute: '/home/nova/repo', type: 'directory' as const, ignored: false }, { name: 'ignored', path: 'ignored', absolute: '/ignored', type: 'directory' as const, ignored: true }] }) },
    project: { current: async () => ({ data: project }), update: async (input: { name?: string }) => ({ data: { ...project, name: input.name ?? '' } }) },
    worktree: {
      list: async () => ({ data: ['/repo-worktree'] }),
      create: async () => ({ data: { name: 'feature', directory: '/repo-feature' } }),
      reset: async () => ({ data: true }),
      remove: async () => ({ data: true }),
    },
  }
}

describe('project and worktree operations', () => {
  test('uses server-backed directory browsing and opens a selected project', async () => {
    const browse = await browseDirectories('server_test', undefined, connection, client())
    expect(browse.directories).toEqual([{ name: 'repo', directory: '/home/nova/repo' }])
    expect(await openProject('server_test', '/repo', connection, client())).toEqual({ projectID: 'project_1', directory: '/repo' })
  })

  test('updates project names and exposes worktree lifecycle', async () => {
    expect(await renameProject('server_test', 'project_1', 'New name', '#aabbcc', connection, client())).toEqual({ projectID: 'project_1', name: 'New name' })
    expect(await mutateWorktree('server_test', '/repo', 'list', undefined, connection, client())).toEqual({ directories: ['/repo-worktree'] })
    expect(await mutateWorktree('server_test', '/repo', 'create', 'feature', connection, client())).toEqual({ directory: '/repo-feature', orphaned: true })
    expect(await mutateWorktree('server_test', '/repo', 'reset', '/repo-feature', connection, client())).toEqual({ directory: '/repo-feature' })
    expect(await mutateWorktree('server_test', '/repo', 'remove', '/repo-feature', connection, client())).toEqual({ directory: '/repo-feature' })
  })

  test('enforces exact server identity and protects the primary worktree', async () => {
    await expect(openProject('server_other', '/repo', connection, client())).rejects.toThrow('Unknown server')
    await expect(renameProject('server_test', 'project_1', 'Name', 'red', connection, client())).rejects.toThrow('six-digit hex')
    await expect(mutateWorktree('server_test', '/repo', 'remove', '/repo', connection, client())).rejects.toThrow('non-primary')
  })
})
