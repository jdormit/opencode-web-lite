import { describe, expect, test } from 'bun:test'
import type { Message, Part, Session } from '@opencode-ai/sdk/v2/client'

import type { ServerConnection } from './connections.server'
import { loadSessionHistoryPage, loadSessionSnapshot } from './session-snapshot.server'

const connection: ServerConnection = {
  key: 'server_test',
  label: 'Test',
  url: 'https://code.example',
}

describe('loadSessionSnapshot', () => {
  test('rejects a route scoped to a different server', async () => {
    const snapshot = await loadSessionSnapshot('server_other', 'ses_1', connection, {
      session: {
        get: async () => {
          throw new Error('must not fetch')
        },
        messages: async () => {
          throw new Error('must not fetch')
        },
      },
    })
    expect(snapshot).toBeUndefined()
  })

  test('loads a bounded public message view using session directory scope', async () => {
    const session = {
      id: 'ses_1',
      slug: 'one',
      projectID: 'project_1',
      directory: '/work/alpha',
      title: 'Fix the build',
      version: '1.18.4',
      time: { created: 1, updated: 2 },
    } satisfies Session
    let messageParameters: unknown
    const info = {
      id: 'msg_1',
      sessionID: 'ses_1',
      role: 'user',
      time: { created: 1 },
      agent: 'build',
      model: { providerID: 'provider', modelID: 'model' },
      summary: { diffs: [{ file: 'src/app.ts', additions: 2, deletions: 1, status: 'modified', patch: '@@ changed' }] },
    } satisfies Message
    const part = {
      id: 'part_1',
      sessionID: 'ses_1',
      messageID: 'msg_1',
      type: 'text',
      text: 'Please fix it',
    } satisfies Part
    const snapshot = await loadSessionSnapshot('server_test', 'ses_1', connection, {
      session: {
        get: async () => ({ data: session }),
        children: async () => ({
          data: [{ ...session, id: 'ses_child', parentID: 'ses_1' }],
        }),
        messages: async (parameters) => {
          messageParameters = parameters
          return {
            data: [{ info, parts: [part] }],
            response: new Response(null, { headers: { 'x-next-cursor': 'older_cursor' } }),
          }
        },
        todo: async () => ({
          data: [{ content: 'Verify the fix', status: 'pending', priority: 'high' }],
        }),
      },
      permission: {
        list: async () => ({
          data: [{
            id: 'per_1', sessionID: 'ses_child', permission: 'edit', patterns: ['file'],
            always: ['file'], metadata: {},
          }],
        }),
      },
    })

    expect(messageParameters).toEqual({
      sessionID: 'ses_1',
      directory: '/work/alpha',
      limit: 20,
    })
    expect(snapshot?.items[0]?.parts).toEqual([
      { id: 'part_1', type: 'text', text: 'Please fix it', limited: false },
    ])
    expect(snapshot?.permission?.sessionID).toBe('ses_child')
    expect(snapshot?.historyCursor).toBe('older_cursor')
    expect(snapshot?.hasOlder).toBe(true)
    expect(snapshot?.todos).toEqual([
      { content: 'Verify the fix', status: 'pending', priority: 'high' },
    ])
    expect(snapshot?.changes).toEqual([{
      file: 'src/app.ts', status: 'modified', additions: 2, deletions: 1,
      patch: '@@ changed', patchLimited: false, patchOmitted: false,
    }])
  })

  test('distinguishes missing sessions from upstream failures', async () => {
    const missing = await loadSessionSnapshot('server_test', 'ses_missing', connection, {
      session: {
        get: async () => ({
          data: undefined,
          response: new Response(null, { status: 404 }),
        }),
        messages: async () => ({ data: [] }),
      },
    })
    expect(missing).toBeUndefined()

    expect(
      loadSessionSnapshot('server_test', 'ses_failed', connection, {
        session: {
          get: async () => ({
            data: undefined,
            response: new Response(null, { status: 503 }),
          }),
          messages: async () => ({ data: [] }),
        },
      }),
    ).rejects.toThrow('could not be loaded')
  })

  test('loads older history with an opaque bounded cursor', async () => {
    const session = {
      id: 'ses_1', slug: 'one', projectID: 'project_1', directory: '/work/alpha',
      title: 'History', version: '1.18.4', time: { created: 1, updated: 2 },
    } satisfies Session
    const info = {
      id: 'msg_old', sessionID: 'ses_1', role: 'user', time: { created: 1 },
      agent: 'build', model: { providerID: 'provider', modelID: 'model' },
    } satisfies Message
    let parameters: unknown
    const page = await loadSessionHistoryPage('server_test', 'ses_1', 'opaque_cursor', 200, connection, {
      session: {
        get: async () => ({ data: session }),
        messages: async (value) => {
          parameters = value
          return {
            data: [{ info, parts: [] }],
            response: new Response(null, { headers: { 'x-next-cursor': 'next_cursor' } }),
          }
        },
      },
    })

    expect(parameters).toEqual({
      sessionID: 'ses_1', directory: '/work/alpha', limit: 200, before: 'opaque_cursor',
    })
    expect(page.items.map((item) => item.id)).toEqual(['msg_old'])
    expect(page.cursor).toBe('next_cursor')
    expect(page.complete).toBe(false)
  })
})
