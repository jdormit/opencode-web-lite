import { describe, expect, test } from 'bun:test'
import type { Project, Session } from '@opencode-ai/sdk/v2/client'

import type { ServerConnection } from './connections.server'
import { createSession } from './session-create.server'

const connection: ServerConnection = {
  key: 'server_test',
  label: 'Test',
  url: 'https://code.example',
}
const project = {
  id: 'project_1',
  worktree: '/work/alpha',
  time: { created: 1, updated: 2 },
  sandboxes: [],
} satisfies Project
const session = {
  id: 'ses_new',
  slug: 'new',
  projectID: project.id,
  directory: project.worktree,
  title: 'New session',
  version: '1.18.4',
  time: { created: 1, updated: 1 },
} satisfies Session

describe('createSession', () => {
  test('revalidates the project and creates a scoped session', async () => {
    let parameters: unknown
    const result = await createSession(
      { directory: '/work/alpha', title: ' Fix tests ' },
      connection,
      {
        project: { list: async () => ({ data: [project] }) },
        session: {
          create: async (input) => {
            parameters = input
            return { data: session }
          },
        },
      },
    )

    expect(parameters).toEqual({ directory: '/work/alpha', title: 'Fix tests' })
    expect(result).toEqual({ serverKey: 'server_test', sessionID: 'ses_new' })
  })

  test('rejects directories not returned by the server', async () => {
    expect(
      createSession({ directory: '/tmp/other', title: '' }, connection, {
        project: { list: async () => ({ data: [project] }) },
        session: { create: async () => ({ data: session }) },
      }),
    ).rejects.toThrow('no longer available')
  })
})
