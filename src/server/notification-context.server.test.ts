import { describe, expect, test } from 'bun:test'
import type { Session } from '@opencode-ai/sdk/v2/client'
import type { ServerConnection } from './connections.server'
import { loadNotificationContext } from './notification-context.server'

const connection: ServerConnection = { key: 'server_test', label: 'Test', url: 'https://code.example' }
const session = {
  id: 'ses_1', slug: 'one', projectID: 'p1', directory: '/work', title: 'One',
  version: '1.18.4', time: { created: 1, updated: 1 },
} satisfies Session

describe('notification context', () => {
  test('distinguishes root and child sessions authoritatively', async () => {
    expect(await loadNotificationContext('server_test', 'ses_1', connection, {
      session: { get: async () => ({ data: session }) },
    })).toEqual({ root: true })
    expect(await loadNotificationContext('server_test', 'ses_child', connection, {
      session: { get: async () => ({ data: { ...session, id: 'ses_child', parentID: 'ses_1' } }) },
    })).toEqual({ root: false })
  })

  test('rejects a mismatched server before fetching', async () => {
    expect(loadNotificationContext('other', 'ses_1', connection, {
      session: { get: async () => { throw new Error('must not fetch') } },
    })).rejects.toThrow('Unknown server')
  })
})
