import { describe, expect, test } from 'bun:test'

import type { Project, Session } from '@opencode-ai/sdk/v2/client'
import { loadHomeIndex } from './home-index.server'
import type { ServerConnection } from './connections.server'

const connection: ServerConnection = {
  key: 'server_test',
  label: 'Test',
  url: 'https://code.example',
}

describe('loadHomeIndex', () => {
  test('returns a bounded public root-session index ordered by update time', async () => {
    const projects = [
      {
        id: 'project_1',
        worktree: '/work/alpha',
        time: { created: 1, updated: 2 },
        sandboxes: [],
      },
    ] satisfies Project[]
    const session = (id: string, updated: number, extra: Partial<Session> = {}) =>
      ({
        id,
        slug: id,
        projectID: 'project_1',
        directory: '/work/alpha',
        title: `Session ${id}`,
        version: '1.18.4',
        time: { created: 1, updated },
        ...extra,
      }) satisfies Session
    let parameters: unknown
    const result = await loadHomeIndex('server_test', connection, {
      project: { list: async () => ({ data: projects }) },
      session: {
        list: async (input) => {
          parameters = input
          return {
            data: [
              session('older', 10),
              session('child', 30, { parentID: 'older' }),
              session('archived', 40, {
                time: { created: 1, updated: 40, archived: 40 },
              }),
              session('newer', 20),
            ],
          }
        },
      },
    })

    expect(parameters).toEqual({ roots: true, limit: 64 })
    expect(result.projects[0]?.name).toBe('alpha')
    expect(result.projects[0]?.worktrees).toEqual([{ directory: '/work/alpha', current: true }])
    expect(result.sessions.map(({ id }) => id)).toEqual(['newer', 'older'])
    expect(JSON.stringify(result)).not.toContain('sandboxes')
    expect(result.errors).toEqual({ projects: false, sessions: false })
  })

  test('preserves projects when the session request fails', async () => {
    const project = {
      id: 'project_1',
      worktree: '/work/alpha',
      time: { created: 1, updated: 2 },
      sandboxes: [],
    } satisfies Project
    const result = await loadHomeIndex('server_test', connection, {
      project: { list: async () => ({ data: [project] }) },
      session: { list: async () => Promise.reject(new Error('offline')) },
    })

    expect(result.projects).toHaveLength(1)
    expect(result.errors.sessions).toBeTrue()
  })
})
