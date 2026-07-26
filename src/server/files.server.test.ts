import { describe, expect, test } from 'bun:test'
import type { Session } from '@opencode-ai/sdk/v2/client'

import type { ServerConnection } from './connections.server'
import { listSessionFiles, readSessionFile, searchSessionFiles } from './files.server'

const connection: ServerConnection = { key: 'server_test', label: 'Test', url: 'https://code.example' }
const session = {
  id: 'ses_1', slug: 'one', projectID: 'project_1', directory: '/work/alpha',
  title: 'Files', version: '1.18.4', time: { created: 1, updated: 2 },
} satisfies Session

function client() {
  return {
    session: { get: async () => ({ data: session }) },
    file: {
      list: async () => ({ data: [{ name: 'src', path: 'src', absolute: '/work/alpha/src', type: 'directory' as const, ignored: false }] }),
      read: async () => ({ data: { type: 'text' as const, content: 'line one\nline two' } }),
    },
    find: { files: async () => ({ data: ['src/app.ts', '../secret'] }) },
  }
}

describe('session files', () => {
  test('uses the authoritative session directory for lists', async () => {
    let parameters: unknown
    const value = await listSessionFiles('server_test', 'ses_1', '', connection, {
      ...client(), file: { ...client().file, list: async (input) => { parameters = input; return client().file.list() } },
    })
    expect(parameters).toEqual({ directory: '/work/alpha', path: '' })
    expect(value.entries).toEqual([{ name: 'src', path: 'src', type: 'directory', ignored: false }])
  })

  test('filters unsafe search paths and reads bounded text', async () => {
    const search = await searchSessionFiles('server_test', 'ses_1', 'app', connection, client())
    const preview = await readSessionFile('server_test', 'ses_1', 'src/app.ts', connection, client())
    expect(search.paths).toEqual(['src/app.ts'])
    expect(preview).toEqual({ path: 'src/app.ts', type: 'text', content: 'line one\nline two', limited: false })
  })

  test('rejects traversal before contacting OpenCode', async () => {
    expect(listSessionFiles('server_test', 'ses_1', '../secret', connection, client())).rejects.toThrow('Invalid file path')
  })
})
