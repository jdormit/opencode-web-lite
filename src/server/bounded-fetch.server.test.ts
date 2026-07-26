import { afterEach, describe, expect, test } from 'bun:test'
import { createBoundedFetch } from './bounded-fetch.server'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

describe('bounded OpenCode fetch', () => {
  test('rejects declared and streamed oversized responses', async () => {
    const bounded = createBoundedFetch({ maximumBytes: 4 })
    globalThis.fetch = Object.assign(async () => new Response('x', { headers: { 'Content-Length': '5' } }), { preconnect() {} })
    expect(bounded('https://code.example')).rejects.toThrow('too large')
    globalThis.fetch = Object.assign(async () => new Response('12345'), { preconnect() {} })
    expect(bounded('https://code.example')).rejects.toThrow('too large')
  })

  test('returns a replayable bounded response', async () => {
    globalThis.fetch = Object.assign(async () => Response.json({ ok: true }), { preconnect() {} })
    const response = await createBoundedFetch({ maximumBytes: 100 })('https://code.example')
    expect(await response.json()).toEqual({ ok: true })
  })

  test('preserves a signal embedded in an SDK-style Request', async () => {
    const controller = new AbortController()
    let forwarded: AbortSignal | undefined
    globalThis.fetch = Object.assign(async (_input: RequestInfo | URL, init?: RequestInit) => {
      forwarded = init?.signal ?? undefined
      return Response.json({ ok: true })
    }, { preconnect() {} })
    await createBoundedFetch()(new Request('https://code.example', { signal: controller.signal }))
    controller.abort()
    expect(forwarded?.aborted).toBe(true)
  })
})
