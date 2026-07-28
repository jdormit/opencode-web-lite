import { describe, expect, test } from 'bun:test'
import type { Config, Session } from '@opencode-ai/sdk/v2/client'

import type { ServerConnection } from './connections.server'
import { controlMcp, loadWorkspaceDiff, loadWorkspaceStatus } from './workspace.server'

const connection: ServerConnection = { key: 'server_test', label: 'Test', url: 'https://code.example' }
const session = { id: 'ses_1', slug: 'one', projectID: 'project', directory: '/work', title: 'Session', version: '1', time: { created: 1, updated: 2 } } satisfies Session

describe('workspace server APIs', () => {
  test('loads bounded MCP, LSP, and plugin status in session scope', async () => {
    const status = await loadWorkspaceStatus('server_test', 'ses_1', connection, {
      session: { get: async () => ({ data: session }) },
      mcp: {
        status: async (input) => { expect(input.directory).toBe('/work'); return { data: { docs: { status: 'needs_auth' } } } },
        connect: async () => ({ data: true }), disconnect: async () => ({ data: true }),
        auth: { start: async () => ({ data: { authorizationUrl: 'https://auth.example', oauthState: 'state' } }), callback: async () => ({ data: { status: 'connected' } }) },
      },
      lsp: { status: async () => ({ data: [{ id: 'ts', name: 'TypeScript', root: '/work', status: 'connected' }] }) },
      config: { get: async () => ({ data: { plugin: ['example-plugin'] } as Config }) },
    })
    expect(status.mcp).toEqual([{ name: 'docs', status: 'needs_auth' }])
    expect(status.lsp[0]?.name).toBe('TypeScript')
    expect(status.plugins).toEqual(['example-plugin'])
  })

  test('maps working scope to git and bounds detailed patches', async () => {
    let parameters: unknown
    const result = await loadWorkspaceDiff('server_test', 'ses_1', 'working', connection, {
      session: { get: async () => ({ data: session }) },
      vcs: { diff: async (input) => { parameters = input; return { data: [{ file: 'src/app.ts', status: 'modified', additions: 2, deletions: 1, patch: 'x'.repeat(300_000) }] } } },
    })
    expect(parameters).toEqual({ directory: '/work', mode: 'git', context: 3 })
    expect(result.changes[0]?.patch?.length).toBe(256 * 1024)
    expect(result.changes[0]?.patchLimited).toBe(true)
  })

  test('runs MCP controls against the session directory', async () => {
    let request: unknown
    await controlMcp('server_test', 'ses_1', 'docs', 'connect', connection, {
      session: { get: async () => ({ data: session }) },
      mcp: {
        status: async () => ({ data: {} }),
        connect: async (input) => { request = input; return { data: true } },
        disconnect: async () => ({ data: true }),
         auth: { start: async () => ({ data: { authorizationUrl: 'https://auth.example', oauthState: 'state' } }), callback: async () => ({ data: { status: 'connected' } }) },
      },
    })
    expect(request).toEqual({ name: 'docs', directory: '/work' })
  })

  test('returns a safe MCP OAuth URL for the browser-owned flow', async () => {
    const result = await controlMcp('server_test', 'ses_1', 'docs', 'authenticate', connection, {
      session: { get: async () => ({ data: session }) },
      mcp: {
        status: async () => ({ data: {} }), connect: async () => ({ data: true }), disconnect: async () => ({ data: true }),
        auth: { start: async () => ({ data: { authorizationUrl: 'https://auth.example/start', oauthState: 'state' } }), callback: async () => ({ data: { status: 'connected' } }) },
      },
    })
    expect(result.authorizationUrl).toBe('https://auth.example/start')
  })
})
