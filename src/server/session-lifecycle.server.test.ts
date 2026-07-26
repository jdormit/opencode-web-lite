import { describe, expect, test } from 'bun:test'
import type { Session } from '@opencode-ai/sdk/v2/client'
import type { ServerConnection } from './connections.server'
import { mutateSessionLifecycle } from './session-lifecycle.server'

const connection: ServerConnection = { key: 'server_test', label: 'Test', url: 'https://code.example' }
const session = {
  id: 'ses_1', slug: 'one', projectID: 'p1', directory: '/authoritative', title: 'One',
  model: { id: 'model_1', providerID: 'provider_1' },
  version: '1.18.4', time: { created: 1, updated: 1 },
} satisfies Session

function client(overrides: Record<string, unknown> = {}) {
  return { session: {
    get: async () => ({ data: session }),
    update: async () => ({ data: session }),
    delete: async () => ({ data: true }),
    fork: async () => ({ data: { ...session, id: 'ses_fork' } }),
    share: async () => ({ data: { ...session, share: { url: 'https://share.example/one' } } }),
    unshare: async () => ({ data: session }),
    summarize: async () => ({ data: true }),
    revert: async () => ({ data: session }),
    unrevert: async () => ({ data: session }),
    ...overrides,
  } }
}

describe('session lifecycle', () => {
  test('uses the authoritative directory for mutations', async () => {
    let input: unknown
    await mutateSessionLifecycle('server_test', 'ses_1', 'rename', ' New title ', connection, client({
      update: async (value: unknown) => { input = value; return { data: session } },
    }))
    expect(input).toEqual({ sessionID: 'ses_1', directory: '/authoritative', title: 'New title' })
  })

  test('returns fork identity and share URL', async () => {
    let forkInput: unknown
    expect(await mutateSessionLifecycle('server_test', 'ses_1', 'fork', 'msg_1', connection, client({
      fork: async (value: unknown) => { forkInput = value; return { data: { ...session, id: 'ses_fork' } } },
    }))).toEqual({ sessionID: 'ses_fork' })
    expect(forkInput).toEqual({ sessionID: 'ses_1', directory: '/authoritative', messageID: 'msg_1' })
    expect(await mutateSessionLifecycle('server_test', 'ses_1', 'share', undefined, connection, client())).toEqual({ sessionID: 'ses_1', shareUrl: 'https://share.example/one' })
  })

  test('compacts with the authoritative session model', async () => {
    let input: unknown
    await mutateSessionLifecycle('server_test', 'ses_1', 'compact', undefined, connection, client({
      summarize: async (value: unknown) => { input = value; return { data: true } },
    }))
    expect(input).toEqual({
      sessionID: 'ses_1', directory: '/authoritative', providerID: 'provider_1', modelID: 'model_1',
    })
  })

  test('advances redo to a boundary or restores the remaining range', async () => {
    let reverted: unknown
    let restored = false
    const mock = client({
      revert: async (value: unknown) => { reverted = value; return { data: session } },
      unrevert: async () => { restored = true; return { data: session } },
    })
    await mutateSessionLifecycle('server_test', 'ses_1', 'redo', 'msg_2', connection, mock)
    expect(reverted).toEqual({ sessionID: 'ses_1', directory: '/authoritative', messageID: 'msg_2' })
    expect(restored).toBe(false)
    await mutateSessionLifecycle('server_test', 'ses_1', 'redo', undefined, connection, mock)
    expect(restored).toBe(true)
  })

  test('requires a bounded title and undo message', async () => {
    expect(mutateSessionLifecycle('server_test', 'ses_1', 'rename', ' ', connection, client())).rejects.toThrow('Invalid session title')
    expect(mutateSessionLifecycle('server_test', 'ses_1', 'undo', undefined, connection, client())).rejects.toThrow('message is required')
  })

  test('rejects a different server before fetching', async () => {
    expect(mutateSessionLifecycle('other', 'ses_1', 'delete', undefined, connection, client({
      get: async () => { throw new Error('must not fetch') },
    }))).rejects.toThrow('Unknown server')
  })
})
