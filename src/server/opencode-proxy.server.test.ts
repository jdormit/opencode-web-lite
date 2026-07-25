import { describe, expect, test } from 'bun:test'

import type { ServerConnection } from './connections.server'
import { proxyOpenCodeRequest } from './opencode-proxy.server'

const connection: ServerConnection = {
  key: 'server_test',
  label: 'Test',
  url: 'https://code.example',
  username: 'nova',
  password: 'secret',
}

describe('proxyOpenCodeRequest', () => {
  test('forwards an allowed request with only server-held authorization', async () => {
    let upstreamUrl = ''
    let upstreamHeaders = new Headers()
    const response = await proxyOpenCodeRequest(
      new Request('http://127.0.0.1/api/opencode/session?directory=%2Frepo', {
        headers: {
          'Accept-Encoding': 'gzip',
          Authorization: 'Bearer browser-secret',
          Cookie: 'app=session',
          'X-Request-ID': 'request-1',
        },
      }),
      'session',
      {
        connection,
        fetch: async (input, init) => {
          upstreamUrl = String(input)
          upstreamHeaders = new Headers(init?.headers)
          return Response.json([{ id: 'ses_1' }])
        },
      },
    )

    expect(response.status).toBe(200)
    expect(upstreamUrl).toBe('https://code.example/session?directory=%2Frepo')
    expect(upstreamHeaders.get('authorization')).toStartWith('Basic ')
    expect(upstreamHeaders.get('authorization')).not.toContain('browser-secret')
    expect(upstreamHeaders.get('cookie')).toBeNull()
    expect(upstreamHeaders.get('accept-encoding')).toBeNull()
    expect(upstreamHeaders.get('x-request-id')).toBe('request-1')
  })

  test('rejects unknown roots, traversal, and cross-origin mutations', async () => {
    const fetcher = async () => {
      throw new Error('must not fetch')
    }
    const unknown = await proxyOpenCodeRequest(
      new Request('http://127.0.0.1/api/opencode/admin'),
      'admin',
      { connection, fetch: fetcher },
    )
    const traversal = await proxyOpenCodeRequest(
      new Request('http://127.0.0.1/api/opencode/session/../config'),
      'session/../config',
      { connection, fetch: fetcher },
    )
    const crossOrigin = await proxyOpenCodeRequest(
      new Request('http://127.0.0.1/api/opencode/session', {
        method: 'POST',
        headers: { Origin: 'https://attacker.example' },
      }),
      'session',
      { connection, fetch: fetcher },
    )

    expect(unknown.status).toBe(404)
    expect(traversal.status).toBe(404)
    expect(crossOrigin.status).toBe(403)
  })

  test('allows every v1 SDK route family needed by later workflows', async () => {
    for (const root of [
      'auth',
      'experimental',
      'formatter',
      'instance',
      'skill',
      'sync',
      'workspace',
    ]) {
      const response = await proxyOpenCodeRequest(
        new Request(`http://127.0.0.1/api/opencode/${root}`),
        root,
        { connection, fetch: async () => Response.json({ ok: true }) },
      )
      expect(response.status).toBe(200)
    }
  })

  test('streams events and removes unsafe upstream headers', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"ready"}\n\n'))
        controller.close()
      },
    })
    const response = await proxyOpenCodeRequest(
      new Request('http://127.0.0.1/api/opencode/global/event'),
      'global/event',
      {
        connection,
        fetch: async () =>
          new Response(body, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Content-Encoding': 'gzip',
              'Content-Length': '999',
              'Set-Cookie': 'upstream=secret',
              'WWW-Authenticate': 'Basic realm="OpenCode"',
            },
          }),
      },
    )

    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('content-encoding')).toBeNull()
    expect(response.headers.get('content-length')).toBeNull()
    expect(response.headers.get('www-authenticate')).toBeNull()
    expect(response.headers.get('x-accel-buffering')).toBe('no')
    expect(await response.text()).toContain('"type":"ready"')
  })

  test('preserves encoded slashes in upstream path parameters', async () => {
    let upstreamPath = ''
    const response = await proxyOpenCodeRequest(
      new Request('http://127.0.0.1/api/opencode/mcp/server%2Fname/connect'),
      'mcp/server/name/connect',
      {
        connection,
        fetch: async (input) => {
          upstreamPath = new URL(String(input)).pathname
          return Response.json({ ok: true })
        },
      },
    )

    expect(response.status).toBe(200)
    expect(upstreamPath).toBe('/mcp/server%2Fname/connect')
  })

  test('rejects upstream redirects', async () => {
    const response = await proxyOpenCodeRequest(
      new Request('http://127.0.0.1/api/opencode/session'),
      'session',
      {
        connection,
        fetch: async () =>
          new Response(null, {
            status: 302,
            headers: { Location: 'https://attacker.example' },
          }),
      },
    )

    expect(response.status).toBe(502)
    expect(response.headers.get('location')).toBeNull()
  })
})
