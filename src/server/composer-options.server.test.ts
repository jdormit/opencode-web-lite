import { describe, expect, test } from 'bun:test'
import type { Agent, Project, Provider } from '@opencode-ai/sdk/v2/client'

import type { ServerConnection } from './connections.server'
import { loadComposerOptions } from './composer-options.server'

const connection: ServerConnection = {
  key: 'server_test',
  label: 'Test',
  url: 'https://code.example',
}

describe('loadComposerOptions', () => {
  test('preserves eligible agent order and connected non-deprecated models', async () => {
    const project = { id: 'p1', worktree: '/work/a', sandboxes: ['/work/sandbox'] } as Project
    const agents = [
      { name: 'plan', mode: 'primary', permission: [], options: {} },
      { name: 'helper', mode: 'subagent', permission: [], options: {} },
      { name: 'hidden', mode: 'all', hidden: true, permission: [], options: {} },
      { name: 'review', mode: 'all', permission: [], options: {} },
    ] as Agent[]
    const providers = [
      {
        id: 'provider',
        name: 'Provider',
        models: {
          current: { id: 'current', name: 'Current', status: 'active', variants: { fast: {} } },
          old: { id: 'old', name: 'Old', status: 'deprecated' },
        },
      },
      { id: 'offline', name: 'Offline', models: { model: { id: 'model', name: 'Model', status: 'active' } } },
    ] as unknown as Provider[]
    const options = await loadComposerOptions(
      'server_test',
      '/work/sandbox',
      connection,
      { project: { list: async () => ({ data: [project] }) } } as never,
      {
        project: { list: async () => ({ data: [project] }) },
        app: { agents: async () => ({ data: agents }) },
        provider: {
          list: async () => ({
            data: { all: providers, connected: ['provider'], default: { provider: 'current' } },
          }),
        },
      },
    )

    expect(options.agents.map(({ name }) => name)).toEqual(['plan', 'review'])
    expect(options.models).toEqual([
      {
        providerID: 'provider',
        providerName: 'Provider',
        modelID: 'current',
        name: 'Current',
        variants: ['fast'],
      },
    ])
    expect(options.defaultModel).toEqual({ providerID: 'provider', modelID: 'current' })
  })
})
