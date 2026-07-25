import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { GlobalEventStream } from './global-event-stream'

const originalRequestAnimationFrame = globalThis.requestAnimationFrame
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame

beforeAll(() => {
  globalThis.requestAnimationFrame = (callback) => {
    setTimeout(() => callback(performance.now()), 0)
    return 1
  }
  globalThis.cancelAnimationFrame = () => {}
})

afterAll(() => {
  globalThis.requestAnimationFrame = originalRequestAnimationFrame
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame
})

describe('GlobalEventStream', () => {
  test('parses and frame-batches SSE events', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"one"}\n\ndata: '))
        controller.enqueue(encoder.encode('{"type":"two"}\n\n'))
        controller.close()
      },
    })
    const stream = new GlobalEventStream('server_test', {
      fetch: Object.assign(async () => new Response(body), { preconnect() {} }),
    })

    const events = await new Promise<unknown[]>((resolve) => {
      stream.onEvents(resolve)
      stream.start()
    })
    stream.stop()

    expect(events).toEqual([{ type: 'one' }, { type: 'two' }])
  })

  test('uses exponential full-jitter reconnect timing', async () => {
    const stream = new GlobalEventStream('server_test', {
      fetch: Object.assign(async () => {
        throw new TypeError('offline')
      }, { preconnect() {} }),
      random: () => 0.5,
      baseDelayMs: 500,
    })

    const state = await new Promise<ReturnType<typeof stream.getSnapshot>>(
      (resolve) => {
        stream.subscribe(() => {
          const next = stream.getSnapshot()
          if (next.status === 'reconnecting' && next.retryInMs > 0) resolve(next)
        })
        stream.start()
      },
    )
    stream.stop()

    expect(state).toEqual({ status: 'reconnecting', attempt: 1, retryInMs: 250 })
  })
})
