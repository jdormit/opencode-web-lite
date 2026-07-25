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
})
