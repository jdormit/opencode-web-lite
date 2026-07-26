export type StreamState =
  | { status: 'idle' | 'connecting' | 'connected' | 'disconnected' }
  | { status: 'reconnecting'; attempt: number; retryInMs: number }
  | { status: 'authentication-failed' | 'incompatible' }

type StreamOptions = Readonly<{
  fetch?: typeof globalThis.fetch
  random?: () => number
  baseDelayMs?: number
  maximumDelayMs?: number
}>

export class GlobalEventStream {
  private readonly fetcher
  private readonly random
  private readonly baseDelayMs
  private readonly maximumDelayMs
  private controller: AbortController | undefined
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private frame: number | undefined
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private attempt = 0
  private state: StreamState = { status: 'idle' }
  private readonly stateListeners = new Set<() => void>()
  private readonly eventListeners = new Set<(events: unknown[]) => void>()
  private readonly reconnectListeners = new Set<() => void>()
  private pendingEvents: unknown[] = []
  private static readonly maximumBlockBytes = 256 * 1024
  private static readonly maximumBufferBytes = 1024 * 1024
  private static readonly maximumPendingEvents = 500

  constructor(
    private readonly serverKey: string,
    options: StreamOptions = {},
  ) {
    this.fetcher = options.fetch ?? fetch
    this.random = options.random ?? Math.random
    this.baseDelayMs = options.baseDelayMs ?? 500
    this.maximumDelayMs = options.maximumDelayMs ?? 30_000
  }

  getSnapshot = () => this.state

  subscribe = (listener: () => void) => {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  onEvents(listener: (events: unknown[]) => void) {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  onReconnect(listener: () => void) {
    this.reconnectListeners.add(listener)
    return () => this.reconnectListeners.delete(listener)
  }

  start() {
    if (this.controller || this.retryTimer) return
    void this.connect()
  }

  stop() {
    this.controller?.abort()
    this.controller = undefined
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    if (this.frame !== undefined) cancelAnimationFrame(this.frame)
    this.frame = undefined
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = undefined
    this.pendingEvents = []
    this.attempt = 0
    this.setState({ status: 'disconnected' })
  }

  retryNow() {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    this.controller?.abort()
    this.controller = undefined
    void this.connect()
  }

  private async connect() {
    const controller = new AbortController()
    this.controller = controller
    this.setState(
      this.attempt
        ? { status: 'reconnecting', attempt: this.attempt, retryInMs: 0 }
        : { status: 'connecting' },
    )

    try {
      const response = await this.fetcher('/api/opencode/global/event', {
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
      })
      if (response.status === 401 || response.status === 403) {
        this.setState({ status: 'authentication-failed' })
        return
      }
      if ([404, 405, 410, 501].includes(response.status)) {
        this.setState({ status: 'incompatible' })
        return
      }
      if (!response.ok || !response.body) throw new Error('Event stream unavailable')
      const reconnected = this.attempt > 0
      this.setState({ status: 'connected' })
      if (reconnected) {
        for (const listener of this.reconnectListeners) listener()
      }
      await this.read(response.body)
      if (!controller.signal.aborted) throw new Error('Event stream ended')
    } catch {
      if (!controller.signal.aborted) this.scheduleReconnect()
    } finally {
      if (this.controller === controller) this.controller = undefined
    }
  }

  private async read(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        buffer = buffer.replaceAll('\r\n', '\n').replace(/\r(?!$)/g, '\n')
        if (done) buffer = buffer.replaceAll('\r', '\n')
        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          this.parseBlock(buffer.slice(0, boundary))
          buffer = buffer.slice(boundary + 2)
          boundary = buffer.indexOf('\n\n')
        }
        if (buffer.length > GlobalEventStream.maximumBufferBytes) {
          throw new Error('Event stream block exceeded its byte limit')
        }
        if (done) break
      }
    } finally {
      reader.releaseLock()
    }
  }

  private parseBlock(block: string) {
    if (block.length > GlobalEventStream.maximumBlockBytes) return
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data) return
    try {
      if (this.pendingEvents.length >= GlobalEventStream.maximumPendingEvents) this.flush()
      this.pendingEvents.push(JSON.parse(data))
      this.attempt = 0
      this.scheduleFrame()
    } catch {}
  }

  private scheduleFrame() {
    if (this.frame !== undefined) return
    this.frame = requestAnimationFrame(() => {
      this.flush()
    })
    this.flushTimer = setTimeout(() => this.flush(), 100)
  }

  private flush() {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame)
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.frame = undefined
    this.flushTimer = undefined
    if (!this.pendingEvents.length) return
    const events = this.pendingEvents
    this.pendingEvents = []
    for (const listener of this.eventListeners) listener(events)
  }

  private scheduleReconnect() {
    this.attempt += 1
    const ceiling = Math.min(
      this.maximumDelayMs,
      this.baseDelayMs * 2 ** (this.attempt - 1),
    )
    const retryInMs = Math.floor(this.random() * ceiling)
    this.setState({ status: 'reconnecting', attempt: this.attempt, retryInMs })
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      void this.connect()
    }, retryInMs)
  }

  private setState(state: StreamState) {
    this.state = state
    for (const listener of this.stateListeners) listener()
  }
}

const streams = new Map<string, { stream: GlobalEventStream; touchedAt: number }>()
const maximumStreams = 20
const maximumIdleMs = 20 * 60_000

export function getGlobalEventStream(serverKey: string) {
  const existing = streams.get(serverKey)
  if (existing) {
    existing.touchedAt = Date.now()
    return existing.stream
  }
  evictIdleStreams()
  const stream = new GlobalEventStream(serverKey)
  streams.set(serverKey, { stream, touchedAt: Date.now() })
  if (streams.size > maximumStreams) {
    const candidate = [...streams.entries()]
      .filter(([, value]) => {
        const status = value.stream.getSnapshot().status
        return status === 'idle' || status === 'disconnected'
      })
      .sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0]
    if (candidate) {
      candidate[1].stream.stop()
      streams.delete(candidate[0])
    }
  }
  return stream
}

function evictIdleStreams() {
  const cutoff = Date.now() - maximumIdleMs
  for (const [key, value] of streams) {
    const status = value.stream.getSnapshot().status
    if (value.touchedAt < cutoff && (status === 'idle' || status === 'disconnected')) {
      value.stream.stop()
      streams.delete(key)
    }
  }
}
