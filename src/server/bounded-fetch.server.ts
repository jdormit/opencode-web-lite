export function createBoundedFetch({
  maximumBytes = 4 * 1024 * 1024,
  timeoutMs = 8_000,
  label = 'OpenCode response',
}: Readonly<{ maximumBytes?: number; timeoutMs?: number; label?: string }> = {}): typeof globalThis.fetch {
  return Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestSignal = input instanceof Request ? input.signal : undefined
    const callerSignals = [requestSignal, init?.signal].filter((value): value is AbortSignal => Boolean(value))
    const signal = AbortSignal.any([...callerSignals, AbortSignal.timeout(timeoutMs)])
    const response = await fetch(input, { ...init, signal, redirect: 'manual' })
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maximumBytes) {
      await response.body?.cancel()
      throw new Error(`${label} is too large`)
    }
    if (!response.body) return response
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maximumBytes) {
          await reader.cancel()
          throw new Error(`${label} is too large`)
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const headers = new Headers(response.headers)
    headers.set('Content-Length', String(size))
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers })
  }, { preconnect: globalThis.fetch.preconnect })
}

export const finiteOpenCodeFetch = createBoundedFetch()
