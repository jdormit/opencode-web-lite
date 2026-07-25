import { describe, expect, test } from 'bun:test'

import { getDefaultConnection, probeConnection } from './connections.server'

describe('getDefaultConnection', () => {
  test('normalizes the default server and creates a stable non-secret key', () => {
    const first = getDefaultConnection({})
    const second = getDefaultConnection({ OPENCODE_SERVER_URL: 'http://localhost:4096/' })

    expect(first.url).toBe('http://localhost:4096')
    expect(first.key).toBe(second.key)
    expect(first.key).toMatch(/^server_[a-f0-9]{16}$/)
  })

  test('keeps credentials out of public identity fields', () => {
    const connection = getDefaultConnection({
      OPENCODE_SERVER_URL: 'https://code.example',
      OPENCODE_SERVER_USERNAME: 'nova',
      OPENCODE_SERVER_PASSWORD: 'secret',
    })

    expect(connection.key).not.toContain('secret')
    expect(connection.url).toBe('https://code.example')
  })

  test('rejects URLs that are not plain HTTP origins', () => {
    expect(() =>
      getDefaultConnection({ OPENCODE_SERVER_URL: 'file:///tmp/socket' }),
    ).toThrow('must use http or https')
    expect(() =>
      getDefaultConnection({ OPENCODE_SERVER_URL: 'https://code.example/path' }),
    ).toThrow('must contain only an origin')
    expect(() =>
      getDefaultConnection({ OPENCODE_SERVER_URL: 'https://user:pass@code.example' }),
    ).toThrow('dedicated environment variables')
    expect(() =>
      getDefaultConnection({
        OPENCODE_SERVER_URL: 'http://code.example',
        OPENCODE_SERVER_PASSWORD: 'secret',
      }),
    ).toThrow('require HTTPS')
  })

  test('supports an explicitly configured blank Basic password', () => {
    const connection = getDefaultConnection({
      OPENCODE_SERVER_URL: 'http://localhost:4096',
      OPENCODE_SERVER_PASSWORD: '',
    })
    expect(connection.password).toBe('')
  })
})

describe('probeConnection', () => {
  const connection = getDefaultConnection({
    OPENCODE_SERVER_URL: 'https://code.example',
    OPENCODE_SERVER_USERNAME: 'nova',
    OPENCODE_SERVER_PASSWORD: 'secret',
  })

  test('returns a public connected snapshot for valid v1 health', async () => {
    let authorization = ''
    const snapshot = await probeConnection(connection, {
      fetch: async (_input, init) => {
        authorization = new Headers(init?.headers).get('authorization') ?? ''
        return Response.json({ healthy: true, version: '1.18.4' })
      },
    })

    expect(snapshot).toEqual({
      server: {
        key: connection.key,
        label: 'code.example',
        url: 'https://code.example',
      },
      state: 'connected',
      version: '1.18.4',
    })
    expect(authorization).toStartWith('Basic ')
    expect(JSON.stringify(snapshot)).not.toContain('secret')
  })

  test('maps authentication, compatibility, and transport failures', async () => {
    const unauthorized = await probeConnection(connection, {
      fetch: async () => new Response(null, { status: 401 }),
    })
    const incompatible = await probeConnection(connection, {
      fetch: async () => Response.json({ pid: 123 }),
    })
    const missingEndpoint = await probeConnection(connection, {
      fetch: async () => new Response(null, { status: 405 }),
    })
    const malformed = await probeConnection(connection, {
      fetch: async () =>
        new Response('{', { headers: { 'Content-Type': 'application/json' } }),
    })
    let redirectMode: RequestRedirect | undefined
    const redirected = await probeConnection(connection, {
      fetch: async (_input, init) => {
        redirectMode = init?.redirect
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://attacker.example/global/health' },
        })
      },
    })
    const unavailable = await probeConnection(connection, {
      fetch: async () => {
        throw new TypeError('connection refused')
      },
    })

    expect(unauthorized.state).toBe('authentication-failed')
    expect(incompatible.state).toBe('incompatible')
    expect(missingEndpoint.state).toBe('incompatible')
    expect(malformed.state).toBe('incompatible')
    expect(redirected.state).toBe('incompatible')
    expect(redirectMode).toBe('manual')
    expect(unavailable.state).toBe('unavailable')
  })

  test('cancels an oversized streamed response', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(40_000))
      },
      cancel() {
        cancelled = true
      },
    })
    const snapshot = await probeConnection(connection, {
      fetch: async () =>
        new Response(body, {
          headers: { 'Content-Type': 'application/json' },
        }),
    })

    expect(snapshot.state).toBe('incompatible')
    expect(cancelled).toBeTrue()
  })

  test('aborts a probe at the configured timeout', async () => {
    const startedAt = performance.now()
    const snapshot = await probeConnection(connection, {
      timeoutMs: 25,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Timed out', 'TimeoutError')),
            { once: true },
          )
        }),
    })

    expect(snapshot.state).toBe('unavailable')
    expect(performance.now() - startedAt).toBeLessThan(250)
  })
})
