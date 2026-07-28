import { describe, expect, test } from 'bun:test'
import type { Provider } from '@opencode-ai/sdk/v2/client'

import type { ServerConnection } from './connections.server'
import { listProviderSettings } from './provider-settings.server'

const connection: ServerConnection = { key: 'server_test', label: 'Test', url: 'https://code.example' }

describe('provider settings projection', () => {
  test('returns useful provider state without secret fields', async () => {
    const provider = {
      id: 'example', name: 'Example', source: 'api', env: [], key: 'must-not-leak',
      options: { apiKey: 'must-not-leak' }, models: { model: { id: 'model' } },
    } as unknown as Provider
    const result = await listProviderSettings('server_test', '/work', connection, {
      provider: {
        list: async () => ({ data: { all: [provider], connected: ['example'], default: {} } }),
        auth: async () => ({ data: { example: [{ type: 'oauth', label: 'Browser', prompts: [{ type: 'text', key: 'org', message: 'Organization' }] }] } }),
        oauth: { authorize: async () => ({}), callback: async () => ({}) },
      },
      auth: { set: async () => undefined, remove: async () => undefined },
      config: { get: async () => ({}), update: async () => undefined },
    })
    expect(result).toEqual([{
      id: 'example', name: 'Example', source: 'api', connected: true, disconnectable: true, modelCount: 1,
      methods: [{ index: 0, type: 'oauth', label: 'Browser', prompts: [{ type: 'text', key: 'org', message: 'Organization' }] }],
    }])
    expect(JSON.stringify(result)).not.toContain('must-not-leak')
  })
})
