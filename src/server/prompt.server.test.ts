import { describe, expect, test } from 'bun:test'
import type { Session } from '@opencode-ai/sdk/v2/client'

import type { ServerConnection } from './connections.server'
import { sendPrompt, stopSession } from './prompt.server'

const connection: ServerConnection = {
  key: 'server_test', label: 'Test', url: 'https://code.example',
}
const session = {
  id: 'ses_1', slug: 'one', projectID: 'p1', directory: '/work/a', title: 'One',
  version: '1.18.4', time: { created: 1, updated: 1 },
} satisfies Session
const options = {
  agents: [{ name: 'build' }],
  models: [{ providerID: 'provider', providerName: 'Provider', modelID: 'model', name: 'Model', variants: ['fast'] }],
}

describe('prompt mutations', () => {
  test('submits validated text with explicit selection and directory scope', async () => {
    let parameters: unknown
    await sendPrompt(
      {
        serverKey: 'server_test', sessionID: 'ses_1', messageID: 'msg_12345678901234567890123456', text: ' hello ', agent: 'build',
        providerID: 'provider', modelID: 'model', variant: 'fast',
      },
      connection,
      {
        session: {
          get: async () => ({ data: session }),
          message: async () => ({ data: undefined, response: new Response(null, { status: 404 }) }),
          promptAsync: async (input) => { parameters = input },
          abort: async () => undefined,
        },
      },
      options,
    )

    expect(parameters).toEqual({
      sessionID: 'ses_1', messageID: 'msg_12345678901234567890123456', directory: '/work/a', agent: 'build',
      model: { providerID: 'provider', modelID: 'model' }, variant: 'fast',
      parts: [{ type: 'text', text: ' hello ' }],
    })
  })

  test('uses authoritative session directory when stopping', async () => {
    let parameters: unknown
    await stopSession(
      { serverKey: 'server_test', sessionID: 'ses_1' },
      connection,
      {
        session: {
          get: async () => ({ data: session }),
          message: async () => ({ data: undefined, response: new Response(null, { status: 404 }) }),
          promptAsync: async () => undefined,
          abort: async (input) => { parameters = input },
        },
      },
    )
    expect(parameters).toEqual({ sessionID: 'ses_1', directory: '/work/a' })
  })

  test('does not resubmit an existing client message ID', async () => {
    let submitted = false
    const result = await sendPrompt(
      {
        serverKey: 'server_test', sessionID: 'ses_1', messageID: 'msg_12345678901234567890123456',
        text: 'hello', agent: 'build', providerID: 'provider', modelID: 'model', variant: '',
      },
      connection,
      {
        session: {
          get: async () => ({ data: session }),
          message: async () => ({ data: { info: { id: 'msg_12345678901234567890123456' } } }),
          promptAsync: async () => { submitted = true },
          abort: async () => undefined,
        },
      },
      options,
    )
    expect(result.existing).toBeTrue()
    expect(submitted).toBeFalse()
  })

  test('does not submit when absence cannot be verified', async () => {
    expect(
      sendPrompt(
        {
          serverKey: 'server_test', sessionID: 'ses_1', messageID: 'msg_12345678901234567890123456',
          text: 'hello', agent: 'build', providerID: 'provider', modelID: 'model', variant: '',
        },
        connection,
        {
          session: {
            get: async () => ({ data: session }),
            message: async () => ({ data: undefined, response: new Response(null, { status: 503 }) }),
            promptAsync: async () => undefined,
            abort: async () => undefined,
          },
        },
        options,
      ),
    ).rejects.toThrow('could not be verified')
  })

  test('dispatches structured file, agent, and attachment parts after authoritative validation', async () => {
    let parameters: unknown
    await sendPrompt({
      serverKey: 'server_test', sessionID: 'ses_1', messageID: 'msg_12345678901234567890123456',
      mode: 'prompt', text: 'check @src/a.ts with @review', agent: 'build', providerID: 'provider', modelID: 'model', variant: '',
      parts: [
        { type: 'text', text: 'check @src/a.ts with @review' },
        { type: 'project-file', path: 'src/a.ts', label: '@src/a.ts', start: 6, end: 15 },
        { type: 'agent', name: 'review', label: '@review', start: 21, end: 28 },
        { type: 'attachment', mime: 'text/plain', filename: 'notes.txt', url: 'data:text/plain;base64,aGk=', size: 2 },
      ],
    }, connection, { session: {
      get: async () => ({ data: session }),
      message: async () => ({ data: undefined, response: new Response(null, { status: 404 }) }),
      promptAsync: async (input) => { parameters = input }, abort: async () => undefined,
    } }, {
      ...options,
      mentionAgents: [{ name: 'review' }], commands: [], directory: '/work/a',
      models: [{ ...options.models[0]!, capabilities: { image: false, pdf: false, reasoning: false, attachment: true } }],
    })
    expect((parameters as { parts: unknown[] }).parts).toEqual([
      { type: 'text', text: 'check @src/a.ts with @review' },
      { type: 'file', mime: 'text/plain', filename: 'a.ts', url: 'file:///work/a/src/a.ts', source: { type: 'file', path: '/work/a/src/a.ts', text: { value: '@src/a.ts', start: 6, end: 15 } } },
      { type: 'agent', name: 'review', source: { value: '@review', start: 21, end: 28 } },
      { type: 'file', mime: 'text/plain', filename: 'notes.txt', url: 'data:text/plain;base64,aGk=' },
    ])
  })

  test('uses dedicated command and shell dispatch', async () => {
    const calls: string[] = []
    const client = { session: {
      get: async () => ({ data: session }), message: async () => ({ data: undefined, response: new Response(null, { status: 404 }) }),
      promptAsync: async () => undefined, abort: async () => undefined,
      command: async () => { calls.push('command') }, shell: async () => { calls.push('shell') },
    } }
    const fullOptions = { ...options, mentionAgents: [], commands: [{ name: 'review', source: 'command' as const, hints: [] }], directory: '/work/a' }
    await sendPrompt({ serverKey: 'server_test', sessionID: 'ses_1', messageID: 'msg_12345678901234567890123456', mode: 'command', command: 'review', text: '', agent: 'build', providerID: 'provider', modelID: 'model', variant: '', parts: [{ type: 'text', text: '' }] }, connection, client, fullOptions)
    await sendPrompt({ serverKey: 'server_test', sessionID: 'ses_1', messageID: 'msg_22345678901234567890123456', mode: 'shell', text: 'pwd', agent: 'build', providerID: 'provider', modelID: 'model', variant: '', parts: [{ type: 'text', text: 'pwd' }] }, connection, client, fullOptions)
    expect(calls).toEqual(['command', 'shell'])
  })
})
