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
        status: async () => ({ data: { newer: { type: 'busy' } } }),
      },
    })

    expect(parameters).toEqual({ roots: true, limit: 33 })
    expect(result.projects[0]?.name).toBe('alpha')
    expect(result.projects[0]?.status).toBe('working')
    expect(result.projects[0]?.worktrees).toEqual([{ directory: '/work/alpha', current: true }])
    expect(result.sessions.map(({ id }) => id)).toEqual(['newer', 'older'])
    expect(result.sessions[0]?.status).toBe('working')
    expect(result.sessions[0]?.projectName).toBe('alpha')
    expect(JSON.stringify(result)).not.toContain('sandboxes')
    expect(result.errors).toEqual({ projects: false, sessions: false })
  })

  test('passes bounded search and paging to the authoritative root index', async () => {
    let parameters: unknown
    const result = await loadHomeIndex('server_test', connection, {
      project: { list: async () => ({ data: [] }) },
      session: { list: async (input) => { parameters = input; return { data: [] } }, status: async () => ({ data: {} }) },
    }, { search: 'deploy', start: 32, limit: 32 })
    expect(parameters).toEqual({ roots: true, limit: 64, search: 'deploy' })
    expect(result.sessionsLimited).toBeFalse()
  })

  test('applies project filtering before the client page offset', async () => {
    const sessions = Array.from({ length: 6 }, (_, index) => ({
      id: `session_${index}`,
      slug: `session_${index}`,
      projectID: index % 2 ? 'other' : 'wanted',
      directory: '/work/alpha',
      title: `Session ${index}`,
      version: '1.18.4',
      time: { created: 1, updated: 100 - index },
    })) satisfies Session[]
    const result = await loadHomeIndex('server_test', connection, {
      project: { list: async () => ({ data: [] }) },
      session: { list: async () => ({ data: sessions }), status: async () => ({ data: {} }) },
    }, { projectID: 'wanted', start: 1, limit: 1 })
    expect(result.sessions.map((session) => session.id)).toEqual(['session_2'])
    expect(result.nextStart).toBe(2)
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
