import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createConnectionRegistry, getDefaultConnection, probeConnection } from './connections.server'

describe('getDefaultConnection', () => {
  test('resolves only the exact registered server key', () => {
    const registry = createConnectionRegistry({ OPENCODE_SERVER_URL: 'https://code.example' })
    const connection = registry.list()[0]!
    expect(registry.defaultKey).toBe(connection.key)
    expect(registry.resolve(connection.key)).toEqual(connection)
    expect(() => registry.resolve('server_other')).toThrow('Unknown server')
  })

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

describe('persistent connection registry', () => {
  test('health-checks before saving and reloads an encrypted multi-server registry', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'connections-'))
    const path = join(directory, 'registry.json')
    const env = { OPENCODE_WEB_ENCRYPTION_KEY: 'test-only-key', OPENCODE_WEB_CONNECTIONS_FILE: path }
    try {
      const registry = createConnectionRegistry(env)
      const saved = await registry.save({ label: 'Remote', url: 'https://code.example', username: 'nova', password: 'secret' }, {
        fetch: async () => Response.json({ healthy: true, version: '1.18.4' }),
      })
      expect(saved.server.key).toMatch(/^server_[A-Za-z0-9_-]+$/)
      expect(JSON.stringify(saved)).not.toContain('secret')
      registry.setDefault(saved.server.key)

      const disk = readFileSync(path, 'utf8')
      expect(disk).toContain('aes-256-gcm')
      expect(disk).toContain('scrypt')
      expect(disk).not.toContain('secret')
      expect(disk).not.toContain('code.example')

      const reloaded = createConnectionRegistry(env)
      expect(reloaded.defaultKey).toBe(saved.server.key)
      expect(reloaded.list()).toHaveLength(2)
      expect(reloaded.resolve(saved.server.key).password).toBe('secret')
      expect(() => reloaded.resolve(`${saved.server.key}x`)).toThrow('Unknown server')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  test('loads a valid saved registry even when the fallback environment URL is invalid', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'connections-'))
    const path = join(directory, 'registry.json')
    const env = { OPENCODE_WEB_ENCRYPTION_KEY: 'test-only-key', OPENCODE_WEB_CONNECTIONS_FILE: path }
    try {
      const registry = createConnectionRegistry(env)
      await registry.save({ label: 'Remote', url: 'https://code.example' }, {
        fetch: async () => Response.json({ healthy: true, version: '1.18.4' }),
      })
      const reloaded = createConnectionRegistry({ ...env, OPENCODE_SERVER_URL: 'not a URL' })
      expect(reloaded.list()).toHaveLength(2)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  test('fails closed instead of overwriting an unreadable saved registry', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'connections-'))
    const path = join(directory, 'registry.json')
    try {
      const registry = createConnectionRegistry({ OPENCODE_WEB_ENCRYPTION_KEY: 'right-key', OPENCODE_WEB_CONNECTIONS_FILE: path })
      registry.setDefault(registry.defaultKey)
      expect(() => createConnectionRegistry({ OPENCODE_WEB_ENCRYPTION_KEY: 'wrong-key', OPENCODE_WEB_CONNECTIONS_FILE: path }))
        .toThrow('could not be decrypted or validated')
      writeFileSync(path, '{broken')
      expect(() => createConnectionRegistry({ OPENCODE_WEB_ENCRYPTION_KEY: 'right-key', OPENCODE_WEB_CONNECTIONS_FILE: path }))
        .toThrow('could not be decrypted or validated')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  test('does not write credentials without an encryption key and rejects duplicate origins', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'connections-'))
    const path = join(directory, 'registry.json')
    try {
      const registry = createConnectionRegistry({ OPENCODE_WEB_CONNECTIONS_FILE: path })
      await expect(registry.save({ label: 'Duplicate', url: 'http://localhost:4096' }, {
        fetch: async () => Response.json({ healthy: true, version: '1.18.4' }),
      })).rejects.toThrow('already saved')
      expect(Bun.file(path).size).toBe(0)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  test('does not retain a server when its health check fails', async () => {
    const registry = createConnectionRegistry({})
    await expect(registry.save({ label: 'Offline', url: 'https://offline.example' }, {
      fetch: async () => new Response(null, { status: 503 }),
    })).rejects.toThrow('health check failed')
    expect(registry.list()).toHaveLength(1)
  })
})
