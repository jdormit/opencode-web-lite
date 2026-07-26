import {
  getDefaultConnection,
  resolveConnection,
  type ServerConnection,
} from './connections.server'

type ProxyOptions = Readonly<{
  connection?: ServerConnection
  serverKey?: string
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  timeoutMs?: number
}>

const allowedMethods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'])
const maximumRequestBytes = 1024 * 1024
const maximumResponseBytes = 4 * 1024 * 1024
const finiteRequestTimeoutMs = 8_000
const strippedRequestHeaders = new Set([
  'authorization',
  'accept-encoding',
  'connection',
  'cookie',
  'host',
  'origin',
  'proxy-authorization',
  'referer',
  'transfer-encoding',
  'upgrade',
])
const strippedResponseHeaders = new Set([
  'access-control-allow-credentials',
  'access-control-allow-origin',
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'set-cookie',
  'transfer-encoding',
  'upgrade',
  'www-authenticate',
])

export async function proxyOpenCodeRequest(
  request: Request,
  splat: string | undefined,
  options: ProxyOptions = {},
): Promise<Response> {
  if (!allowedMethods.has(request.method)) {
    return new Response('Method not allowed', { status: 405 })
  }
  if (!isSameOriginMutation(request)) {
    return new Response('Cross-origin request rejected', { status: 403 })
  }

  const path = validatePath(request, splat, options.serverKey)
  if (!path) return new Response('Unsupported OpenCode path', { status: 404 })

  let connection: ServerConnection
  try {
    connection = options.connection ?? (options.serverKey
      ? resolveConnection(options.serverKey)
      : getDefaultConnection())
    if (options.serverKey && connection.key !== options.serverKey) {
      return new Response('Unknown OpenCode server', { status: 404 })
    }
  } catch {
    return new Response(options.serverKey ? 'Unknown OpenCode server' : 'Invalid OpenCode server configuration', {
      status: options.serverKey ? 404 : 503,
    })
  }

  const incomingUrl = new URL(request.url)
  const upstreamUrl = new URL(path, connection.url)
  upstreamUrl.search = incomingUrl.search
  const headers = proxyRequestHeaders(request.headers, connection)

  let response: Response
  const streaming = path === '/global/event'
  const finiteSignal = streaming
    ? request.signal
    : AbortSignal.any([request.signal, AbortSignal.timeout(options.timeoutMs ?? finiteRequestTimeoutMs)])
  try {
    const declaredRequestLength = Number(request.headers.get('content-length'))
    if (Number.isFinite(declaredRequestLength) && declaredRequestLength > maximumRequestBytes) {
      return new Response('Request body too large', { status: 413 })
    }
    const body = request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await readBoundedBody(request.body, maximumRequestBytes, finiteSignal)
    if (body === null) return new Response('Request body too large', { status: 413 })
    response = await (options.fetch ?? fetch)(upstreamUrl, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
      signal: finiteSignal,
    } as RequestInit)
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      return new Response('OpenCode redirect rejected', { status: 502 })
    }
    if (!streaming) {
      const bounded = await boundedResponse(response, maximumResponseBytes, finiteSignal)
      if (!bounded) return new Response('OpenCode response too large', { status: 502 })
      response = bounded
    }
  } catch (error) {
    if (isTimeout(error) || (!request.signal.aborted && finiteSignal.aborted)) {
      return new Response('OpenCode server timed out', { status: 504 })
    }
    if (request.signal.aborted) return new Response(null, { status: 499 })
    return new Response('OpenCode server unavailable', { status: 502 })
  }

  const responseHeaders = new Headers(response.headers)
  for (const name of connectionHeaders(response.headers)) responseHeaders.delete(name)
  for (const name of strippedResponseHeaders) responseHeaders.delete(name)
  responseHeaders.set('Cache-Control', 'private, no-store')
  if (path === '/global/event') {
    responseHeaders.set('Content-Type', 'text/event-stream')
    responseHeaders.set('X-Accel-Buffering', 'no')
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}

function validatePath(
  request: Request,
  splat: string | undefined,
  serverKey?: string,
): string | undefined {
  if (!splat) return undefined
  if (splat.split('/').some((segment) => segment === '.' || segment === '..'))
    return undefined

  const prefix = serverKey
    ? `/api/opencode/server/${encodeURIComponent(serverKey)}/`
    : '/api/opencode/'
  const pathname = new URL(request.url).pathname
  if (!pathname.startsWith(prefix)) return undefined
  const rawPath = pathname.slice(prefix.length)
  const segments = rawPath.split('/')

  try {
    const decodedSegments = segments.map((segment) => decodeURIComponent(segment))
    if (
      decodedSegments.some(
        (segment) => !segment || segment === '.' || segment === '..',
      ) ||
      !isAllowedEndpoint(decodedSegments, request.method)
    ) {
      return undefined
    }
  } catch {
    return undefined
  }

  return `/${rawPath}`
}

function isAllowedEndpoint(segments: string[], method: string) {
  if (segments.length === 2 && segments[0] === 'global' && segments[1] === 'event') return method === 'GET'
  if (segments.length === 2 && segments[0] === 'global' && segments[1] === 'health') return method === 'GET' || method === 'HEAD'
  if (segments[0] !== 'pty') return false
  if (segments.length === 1) return method === 'GET' || method === 'POST'
  if (segments.length === 2 && /^[A-Za-z0-9_-]{1,128}$/.test(segments[1]!)) {
    return method === 'GET' || method === 'PUT' || method === 'DELETE'
  }
  return segments.length === 3 && /^[A-Za-z0-9_-]{1,128}$/.test(segments[1]!) &&
    segments[2] === 'connect-token' && method === 'POST'
}

async function readBoundedBody(body: ReadableStream<Uint8Array> | null, maximum: number, signal: AbortSignal) {
  if (!body) return undefined
  const bytes = await readBoundedBytes(body, maximum, signal)
  return bytes ?? null
}

async function boundedResponse(response: Response, maximum: number, signal: AbortSignal) {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > maximum) {
    await response.body?.cancel()
    return undefined
  }
  if (!response.body) return response
  const bytes = await readBoundedBytes(response.body, maximum, signal)
  if (!bytes) return undefined
  return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers })
}

async function readBoundedBytes(stream: ReadableStream<Uint8Array>, maximum: number, signal: AbortSignal) {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await readWithSignal(reader, signal)
      if (done) break
      length += value.byteLength
      if (length > maximum) { await reader.cancel(); return undefined }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength }
  return output
}

async function readWithSignal(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal) {
  if (signal.aborted) throw signal.reason
  let rejectAbort: ((reason: unknown) => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
  const onAbort = () => rejectAbort?.(signal.reason)
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([reader.read(), aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

function isTimeout(error: unknown) {
  return error instanceof DOMException && error.name === 'TimeoutError'
}

function isSameOriginMutation(request: Request): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return true

  const requestOrigin = new URL(request.url).origin
  const origin = request.headers.get('origin')
  if (origin) return origin === requestOrigin

  const referer = request.headers.get('referer')
  if (referer) return new URL(referer).origin === requestOrigin
  return false
}

function proxyRequestHeaders(
  incoming: Headers,
  connection: ServerConnection,
): Headers {
  const headers = new Headers()
  const dynamic = connectionHeaders(incoming)
  for (const [name, value] of incoming) {
    if (!strippedRequestHeaders.has(name.toLowerCase()) && !dynamic.has(name.toLowerCase())) headers.set(name, value)
  }

  if (connection.password !== undefined) {
    const token = Buffer.from(
      `${connection.username ?? 'opencode'}:${connection.password}`,
    ).toString('base64')
    headers.set('Authorization', `Basic ${token}`)
  }
  return headers
}

function connectionHeaders(headers: Headers) {
  return new Set((headers.get('connection') ?? '').split(',').map((name) => name.trim().toLowerCase()).filter(Boolean))
}
