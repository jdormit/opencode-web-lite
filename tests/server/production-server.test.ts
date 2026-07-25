import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { startProductionServer } from '../../server'

let server: Awaited<ReturnType<typeof startProductionServer>>
let upstream: ReturnType<typeof Bun.serve>
let origin: string
let terminalTokenAuthorized = false
let terminalSocketAuthorized = false
let terminalTicketConsumed = false
const previousNodeEnv = process.env.NODE_ENV
const previousServerUrl = process.env.OPENCODE_SERVER_URL
const previousServerPassword = process.env.OPENCODE_SERVER_PASSWORD

beforeAll(async () => {
  process.env.NODE_ENV = 'production'
  upstream = Bun.serve<{ kind: 'pty' }>({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      const url = new URL(request.url)
      if (url.pathname === '/global/health') {
        return Response.json({
          healthy: true,
          version: request.headers.get('authorization') ? 'authenticated' : 'missing-auth',
        })
      }
      if (request.method === 'POST' && url.pathname === '/pty/pty_test/connect-token') {
        terminalTokenAuthorized =
          request.headers.get('authorization')?.startsWith('Basic ') === true &&
          request.headers.get('x-opencode-ticket') === '1' &&
          url.searchParams.get('workspace') === 'workspace_test'
        if (!terminalTokenAuthorized) return new Response('Forbidden', { status: 403 })
        terminalTicketConsumed = false
        return Response.json({ ticket: 'one-use-ticket', expires_in: 30 })
      }
      if (url.pathname === '/pty/pty_test/connect') {
        terminalSocketAuthorized =
          url.searchParams.get('ticket') === 'one-use-ticket' &&
          url.searchParams.get('workspace') === 'workspace_test' &&
          request.headers.get('origin') === url.origin &&
          request.headers.get('authorization')?.startsWith('Basic ') === true
        if (!terminalSocketAuthorized || terminalTicketConsumed) {
          return new Response('Forbidden', { status: 403 })
        }
        terminalTicketConsumed = true
        return server.upgrade(request, { data: { kind: 'pty' } })
          ? undefined
          : new Response('Upgrade failed', { status: 400 })
      }
      return new Response('Not found', { status: 404 })
    },
    websocket: {
      open(socket) {
        socket.send('terminal-ready')
      },
      message(socket, message) {
        socket.send(`echo:${String(message)}`)
      },
    },
  })
  process.env.OPENCODE_SERVER_URL = `http://127.0.0.1:${upstream.port}`
  process.env.OPENCODE_SERVER_PASSWORD = 'server-secret'
  server = await startProductionServer({
    port: 0,
    enableWebSocketProbe: true,
    log: false,
  })
  origin = `http://127.0.0.1:${server.port}`
})

afterAll(() => {
  void server.stop(true)
  void upstream.stop(true)
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = previousNodeEnv
  if (previousServerUrl === undefined) delete process.env.OPENCODE_SERVER_URL
  else process.env.OPENCODE_SERVER_URL = previousServerUrl
  if (previousServerPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
  else process.env.OPENCODE_SERVER_PASSWORD = previousServerPassword
})

describe('production Bun host', () => {
  test('serves SSR HTML and built assets', async () => {
    const htmlResponse = await fetch(origin)
    const html = await htmlResponse.text()
    const assetPath = html.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1]

    expect(htmlResponse.status).toBe(200)
    expect(htmlResponse.headers.get('cache-control')).toBe('private, no-store')
    expect(htmlResponse.headers.get('content-security-policy')).toContain(
      "script-src 'self' 'nonce-",
    )
    expect(assetPath).toBeDefined()

    const assetResponse = await fetch(`${origin}${assetPath}`)
    expect(assetResponse.status).toBe(200)
    expect(assetResponse.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    )
    expect(assetResponse.headers.get('content-type')).toContain('javascript')

    const compressedResponse = await fetch(`${origin}${assetPath}`, {
      headers: { 'Accept-Encoding': 'gzip' },
    })
    expect(compressedResponse.headers.get('content-encoding')).toBe('gzip')
    expect(compressedResponse.headers.get('vary')).toBe('Accept-Encoding')

    const identityResponse = await fetch(`${origin}${assetPath}`, {
      headers: { 'Accept-Encoding': 'gzip;q=0' },
    })
    expect(identityResponse.headers.get('content-encoding')).toBeNull()
  })

  test('supports HEAD and conditional asset requests', async () => {
    const response = await fetch(origin)
    const html = await response.text()
    const assetPath = html.match(/href="(\/assets\/[^\"]+\.css)"/)?.[1]
    expect(assetPath).toBeDefined()

    const headResponse = await fetch(`${origin}${assetPath}`, { method: 'HEAD' })
    const etag = headResponse.headers.get('etag')
    expect(headResponse.status).toBe(200)
    expect(await headResponse.text()).toBe('')
    expect(etag).toBeTruthy()

    const cachedResponse = await fetch(`${origin}${assetPath}`, {
      headers: { 'If-None-Match': `"unrelated", ${etag ?? ''}` },
    })
    expect(cachedResponse.status).toBe(304)
  })

  test('performs a real Bun WebSocket upgrade', async () => {
    const message = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(
        origin.replace('http:', 'ws:') + '/__foundation/websocket',
      )
      const timeout = setTimeout(() => reject(new Error('Upgrade timed out')), 2_000)

      let received = ''
      socket.addEventListener('message', (event) => (received = String(event.data)))
      socket.addEventListener('close', () => {
        clearTimeout(timeout)
        resolve(received)
      })
      socket.addEventListener('error', () => {
        clearTimeout(timeout)
        reject(new Error('WebSocket upgrade failed'))
      })
    })

    expect(message).toBe('upgrade-ok')
  })

  test('bridges a ticket-authenticated terminal WebSocket', async () => {
    const tokenResponse = await fetch(
      `${origin}/api/opencode/pty/pty_test/connect-token?workspace=workspace_test`,
      {
        method: 'POST',
        headers: { Origin: origin, 'x-opencode-ticket': '1' },
      },
    )
    expect(tokenResponse.status).toBe(200)
    const token = await tokenResponse.json() as { ticket: string; expires_in: number }
    expect(token).toEqual({ ticket: 'one-use-ticket', expires_in: 30 })

    const messages = await new Promise<string[]>((resolve, reject) => {
      const WebSocketWithHeaders = WebSocket as unknown as new (
        url: string,
        init: { headers: Record<string, string> },
      ) => WebSocket
      const socket = new WebSocketWithHeaders(
        origin.replace('http:', 'ws:') +
          `/api/opencode/pty/pty_test/connect?workspace=workspace_test&ticket=${token.ticket}`,
        { headers: { Origin: origin } },
      )
      const received: string[] = []
      const timeout = setTimeout(() => reject(new Error('Terminal bridge timed out')), 2_000)
      socket.addEventListener('message', (event) => {
        received.push(String(event.data))
        if (received.length === 1) socket.send('pwd')
        if (received.length === 2) socket.close(1000, 'Test complete')
      })
      socket.addEventListener('close', () => {
        clearTimeout(timeout)
        resolve(received)
      })
      socket.addEventListener('error', () => {
        clearTimeout(timeout)
        reject(new Error('Terminal bridge failed'))
      })
    })

    expect(messages).toEqual(['terminal-ready', 'echo:pwd'])
    expect(terminalTokenAuthorized).toBe(true)
    expect(terminalSocketAuthorized).toBe(true)
  })

  test('rejects terminal WebSockets without the same-origin header', async () => {
    const response = await fetch(
      `${origin}/api/opencode/pty/pty_test/connect?ticket=one-use-ticket`,
      { headers: { Upgrade: 'websocket' } },
    )
    expect(response.status).toBe(403)
  })

  test('rejects ambiguous terminal upgrade queries', async () => {
    const response = await fetch(
      `${origin}/api/opencode/pty/pty_test/connect?ticket=one&ticket=two`,
      { headers: { Origin: origin, Upgrade: 'websocket' } },
    )
    expect(response.status).toBe(400)
  })

  test('does not expose source maps', async () => {
    const response = await fetch(`${origin}/assets/client.js.map`)
    expect(response.status).toBe(404)
  })

  test('rejects unexpected request authorities', async () => {
    const response = await fetch(origin, { headers: { Host: 'attacker.example' } })
    expect(response.status).toBe(421)
  })

  test('proxies an allowlisted OpenCode route with server credentials', async () => {
    const response = await fetch(`${origin}/api/opencode/global/health`, {
      headers: { Authorization: 'Bearer browser-secret' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      healthy: true,
      version: 'authenticated',
    })
  })
})

test('refuses non-loopback binding', async () => {
  expect(
    startProductionServer({ hostname: '0.0.0.0', port: 0, log: false }),
  ).rejects.toThrow('Refusing to bind')
})
