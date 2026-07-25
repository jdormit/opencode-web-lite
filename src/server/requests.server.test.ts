import { describe, expect, test } from 'bun:test'
import type { PermissionRequest, Session } from '@opencode-ai/sdk/v2/client'
import type { ServerConnection } from './connections.server'
import { replyPermission } from './requests.server'

const connection: ServerConnection = { key: 'server_test', label: 'Test', url: 'https://code.example' }
const session = {
  id: 'ses_1', slug: 'one', projectID: 'p1', directory: '/authoritative', title: 'One',
  version: '1.18.4', time: { created: 1, updated: 1 },
} satisfies Session
const permission = {
  id: 'per_1', sessionID: 'ses_1', permission: 'edit', patterns: ['*'], always: ['*'], metadata: {},
} satisfies PermissionRequest

describe('request responses', () => {
  test('uses authoritative session directory and revalidates pending identity', async () => {
    let reply: unknown
    await replyPermission(
      {
        serverKey: 'server_test', sessionID: 'ses_1', directory: '/forged',
        requestID: 'per_1', reply: 'once',
      },
      connection,
      {
        session: { get: async () => ({ data: session }) },
        permission: {
          list: async (input) => {
            expect(input.directory).toBe('/authoritative')
            return { data: [permission] }
          },
          reply: async (input) => { reply = input },
        },
        question: {
          list: async () => ({ data: [] }), reply: async () => undefined, reject: async () => undefined,
        },
      },
    )
    expect(reply).toEqual({ requestID: 'per_1', directory: '/authoritative', reply: 'once' })
  })
})
