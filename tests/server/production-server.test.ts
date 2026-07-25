import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { startProductionServer } from '../../server'

let server: Awaited<ReturnType<typeof startProductionServer>>
let origin: string
const previousNodeEnv = process.env.NODE_ENV

beforeAll(async () => {
  process.env.NODE_ENV = 'production'
  server = await startProductionServer({
    port: 0,
    enableWebSocketProbe: true,
    log: false,
  })
  origin = `http://127.0.0.1:${server.port}`
})

afterAll(() => {
  void server.stop(true)
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = previousNodeEnv
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

  test('does not expose source maps', async () => {
    const response = await fetch(`${origin}/assets/client.js.map`)
    expect(response.status).toBe(404)
  })

  test('rejects unexpected request authorities', async () => {
    const response = await fetch(origin, { headers: { Host: 'attacker.example' } })
    expect(response.status).toBe(421)
  })
})

test('refuses non-loopback binding', async () => {
  expect(
    startProductionServer({ hostname: '0.0.0.0', port: 0, log: false }),
  ).rejects.toThrow('Refusing to bind')
})
