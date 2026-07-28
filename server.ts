import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { brotliCompressSync } from 'node:zlib'

import { resolveConnection } from './src/server/connections.server'

type StartHandler = {
  fetch(request: Request): Response | Promise<Response>
}

type HostOptions = Readonly<{
  port?: number
  hostname?: string
  clientDirectory?: string
  serverEntryPoint?: string
  enableWebSocketProbe?: boolean
  log?: boolean
  installSignalHandlers?: boolean
  publicOrigin?: string
}>

type SocketData =
  | { kind: 'upgrade-probe' }
  | {
      kind: 'pty-proxy'
      upstreamUrl: string
      upstreamOrigin: string
      authorization?: string
      upstream?: WebSocket
      pending: Array<string | ArrayBuffer>
      pendingBytes: number
      connectTimer?: ReturnType<typeof setTimeout>
    }

type Asset = {
  file: Bun.BunFile
  gzip?: Uint8Array
  brotli?: Uint8Array
}

const defaultClientDirectory = './dist/client'
const defaultServerEntryPoint = './dist/server/server.js'
const websocketProbePath = '/__foundation/websocket'
const ptyConnectPath = /^\/api\/opencode\/server\/([A-Za-z0-9_-]{1,128})\/pty\/([A-Za-z0-9_-]{1,128})\/connect$/
const globalEventPath = /^\/api\/opencode\/server\/[A-Za-z0-9_-]{1,128}\/global\/event$/
const maximumPendingPtyBytes = 64 * 1024
const maximumPtyFrameBytes = 64 * 1024
const maximumPtyBackpressureBytes = 1024 * 1024
const shutdownDrainMs = 5_000

export async function startProductionServer(options: HostOptions = {}) {
  const hostname = options.hostname ?? '127.0.0.1'
  assertLoopbackHost(hostname)

  const port = options.port ?? parsePort(process.env.PORT)
  const clientDirectory = resolve(options.clientDirectory ?? defaultClientDirectory)
  const serverEntryPoint = resolve(
    options.serverEntryPoint ?? defaultServerEntryPoint,
  )
  const handler = await loadStartHandler(serverEntryPoint)
  const assets = await indexAssets(clientDirectory)
  const publicOrigin = normalizePublicOrigin(options.publicOrigin ?? process.env.OPENCODE_WEB_PUBLIC_ORIGIN)
  let ready = true

  const server = Bun.serve<SocketData>({
    hostname,
    port,
    async fetch(request, bunServer) {
      const startedAt = performance.now()
      const requestId = requestID(request.headers.get('x-request-id'))
      const url = new URL(request.url)
      let response: Response | undefined
      let category = 'ok'
      const finish = (value: Response | undefined, overrideCategory?: string) => {
        if (!value) return value
        response = withHostHeaders(value, requestId, publicOrigin?.startsWith('https:') ?? url.protocol === 'https:')
        category = overrideCategory ?? failureCategory(response.status)
        if (options.log !== false) logRequest(request, response, requestId, startedAt, category)
        return response
      }
      if (!hasExpectedAuthority(url, hostname, bunServer.port)) {
        return finish(new Response('Misdirected request', { status: 421 }), 'invalid-authority')
      }
      if (url.pathname === '/healthz') return finish(Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } }))
      if (url.pathname === '/readyz') {
        return finish(Response.json({ status: ready ? 'ready' : 'stopping' }, { status: ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }))
      }
      if (globalEventPath.test(url.pathname) || ptyConnectPath.test(url.pathname)) {
        bunServer.timeout(request, 0)
      }

      if (
        options.enableWebSocketProbe === true &&
        url.pathname === websocketProbePath
      ) {
        if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
          return finish(new Response('WebSocket upgrade required', { status: 426 }))
        }

        return bunServer.upgrade(request, {
          data: { kind: 'upgrade-probe' },
        })
          ? undefined
          : finish(new Response('WebSocket upgrade failed', { status: 400 }))
      }

      if (ptyConnectPath.test(url.pathname)) {
        const upgrade = preparePtyUpgrade(request, publicOrigin)
        if (upgrade instanceof Response) return finish(upgrade)
        return bunServer.upgrade(request, { data: upgrade })
          ? undefined
          : finish(new Response('WebSocket upgrade failed', { status: 400 }))
      }

      const asset = assets.get(url.pathname)
      if (asset && (request.method === 'GET' || request.method === 'HEAD')) {
        return finish(serveAsset(request, asset))
      }

      try {
        return finish(await handler.fetch(publicOrigin ? withPublicOrigin(request, publicOrigin) : request))
      } catch {
        return finish(new Response('Internal server error', { status: 500 }), 'internal')
      }
    },
    websocket: {
      open(socket) {
        if (socket.data.kind === 'upgrade-probe') {
          socket.send('upgrade-ok')
          socket.close(1000, 'Probe complete')
          return
        }
        connectUpstreamPty(socket)
      },
      message(socket, message) {
        if (socket.data.kind !== 'pty-proxy') return
        const value = typeof message === 'string' ? message : Uint8Array.from(message).buffer
        const size = typeof value === 'string' ? Buffer.byteLength(value) : value.byteLength
        if (socket.data.upstream?.readyState === WebSocket.OPEN) {
          if (socket.data.upstream.bufferedAmount + size > maximumPtyBackpressureBytes) {
            socket.data.upstream.close(1013, 'Terminal input backpressure exceeded')
            socket.close(1013, 'Terminal input backpressure exceeded')
            return
          }
          socket.data.upstream.send(value)
          return
        }
        if (socket.data.pendingBytes + size > maximumPendingPtyBytes) {
          socket.close(1009, 'Terminal input buffer exceeded')
          return
        }
        socket.data.pending.push(value)
        socket.data.pendingBytes += size
      },
      close(socket) {
        if (socket.data.kind !== 'pty-proxy') return
        if (socket.data.connectTimer) clearTimeout(socket.data.connectTimer)
        socket.data.upstream?.close(1000, 'Browser disconnected')
      },
      maxPayloadLength: maximumPtyFrameBytes,
      backpressureLimit: maximumPtyBackpressureBytes,
      closeOnBackpressureLimit: true,
    },
  })

  if (options.log !== false) {
    console.log(`OpenCode Web Lite listening on http://${hostname}:${server.port}`)
  }

  const shutdown = async (signal: string) => {
    if (!ready) return
    ready = false
    if (options.log !== false) console.log(JSON.stringify({ event: 'shutdown', signal }))
    const forceTimer = setTimeout(() => void server.stop(true), shutdownDrainMs + 10_000)
    try {
      await Bun.sleep(shutdownDrainMs)
      await server.stop(false)
    } finally {
      clearTimeout(forceTimer)
    }
  }
  if (options.installSignalHandlers === true) {
    process.once('SIGTERM', () => void shutdown('SIGTERM'))
    process.once('SIGINT', () => void shutdown('SIGINT'))
  }

  return server
}

function preparePtyUpgrade(request: Request, publicOrigin?: string): Extract<SocketData, { kind: 'pty-proxy' }> | Response {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('WebSocket upgrade required', { status: 426 })
  }
  const requestUrl = new URL(request.url)
  if (request.headers.get('origin') !== (publicOrigin ?? requestUrl.origin)) {
    return new Response('Cross-origin WebSocket rejected', { status: 403 })
  }
  const match = requestUrl.pathname.match(ptyConnectPath)
  if (!match) return new Response('Invalid terminal path', { status: 404 })
  if ([...requestUrl.searchParams.keys()].some((key) => !['cursor', 'directory', 'ticket', 'workspace'].includes(key))) {
    return new Response('Invalid terminal query', { status: 400 })
  }
  for (const key of ['cursor', 'directory', 'ticket', 'workspace']) {
    if (requestUrl.searchParams.getAll(key).length > 1) {
      return new Response('Invalid terminal query', { status: 400 })
    }
  }
  const ticket = requestUrl.searchParams.get('ticket')
  const directory = requestUrl.searchParams.get('directory')
  const workspace = requestUrl.searchParams.get('workspace')
  const cursor = requestUrl.searchParams.get('cursor')
  if (!ticket || ticket.length > 4_096 || (directory?.length ?? 0) > 2_000 || (workspace?.length ?? 0) > 256) {
    return new Response('Invalid terminal query', { status: 400 })
  }
  if (cursor !== null && (!/^-?\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor)) || Number(cursor) < -1)) {
    return new Response('Invalid terminal cursor', { status: 400 })
  }

  let connection
  try {
    connection = resolveConnection(match[1]!)
  } catch {
    return new Response('Invalid OpenCode server configuration', { status: 503 })
  }
  const upstreamUrl = new URL(`/pty/${encodeURIComponent(match[2]!)}/connect`, connection.url)
  upstreamUrl.protocol = upstreamUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  upstreamUrl.searchParams.set('ticket', ticket)
  if (directory) upstreamUrl.searchParams.set('directory', directory)
  if (workspace) upstreamUrl.searchParams.set('workspace', workspace)
  if (cursor !== null) upstreamUrl.searchParams.set('cursor', cursor)
  const authorization = connection.password === undefined
    ? undefined
    : `Basic ${Buffer.from(`${connection.username ?? 'opencode'}:${connection.password}`).toString('base64')}`
  return {
    kind: 'pty-proxy',
    upstreamUrl: upstreamUrl.href,
    upstreamOrigin: connection.url,
    ...(authorization ? { authorization } : {}),
    pending: [],
    pendingBytes: 0,
  }
}

function normalizePublicOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined
  let url: URL
  try { url = new URL(value) } catch { throw new Error('OPENCODE_WEB_PUBLIC_ORIGIN must be a valid HTTP origin') }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== value || url.username || url.password) {
    throw new Error('OPENCODE_WEB_PUBLIC_ORIGIN must be a valid HTTP origin')
  }
  return url.origin
}

function withPublicOrigin(request: Request, publicOrigin: string): Request {
  const target = new URL(request.url)
  const origin = new URL(publicOrigin)
  target.protocol = origin.protocol
  target.host = origin.host
  return new Request(target, request)
}

function connectUpstreamPty(socket: Bun.ServerWebSocket<SocketData>) {
  if (socket.data.kind !== 'pty-proxy') return
  const headers: Record<string, string> = { Origin: socket.data.upstreamOrigin }
  if (socket.data.authorization) headers.Authorization = socket.data.authorization
  const WebSocketWithHeaders = WebSocket as unknown as new (
    url: string,
    init: { headers: Record<string, string> },
  ) => WebSocket
  const upstream = new WebSocketWithHeaders(socket.data.upstreamUrl, { headers })
  upstream.binaryType = 'arraybuffer'
  socket.data.upstream = upstream
  socket.data.connectTimer = setTimeout(() => {
    upstream.close()
    socket.close(1013, 'OpenCode terminal connection timed out')
  }, 5_000)
  upstream.addEventListener('open', () => {
    if (socket.data.kind !== 'pty-proxy') return
    if (socket.data.connectTimer) clearTimeout(socket.data.connectTimer)
    delete socket.data.connectTimer
    for (const message of socket.data.pending) upstream.send(message)
    socket.data.pending = []
    socket.data.pendingBytes = 0
  })
  upstream.addEventListener('message', (event) => {
    const value = event.data
    if (typeof value !== 'string' && !(value instanceof ArrayBuffer)) return
    if (socket.send(value) === 0) {
      upstream.close(1013, 'Terminal output backpressure exceeded')
      socket.close(1013, 'Terminal output backpressure exceeded')
    }
  })
  upstream.addEventListener('close', (event) => {
    const code = event.code === 1000 || (event.code >= 3000 && event.code <= 4999) ? event.code : 1011
    socket.close(code, boundedCloseReason(event.reason || 'OpenCode terminal disconnected'))
  })
  upstream.addEventListener('error', () => socket.close(1011, 'OpenCode terminal unavailable'))
}

function boundedCloseReason(reason: string): string {
  return Buffer.from(reason).subarray(0, 120).toString().replaceAll('\uFFFD', '')
}

function assertLoopbackHost(hostname: string) {
  if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1') {
    return
  }

  throw new Error(
    `Refusing to bind to non-loopback host ${hostname} without application authentication`,
  )
}

function hasExpectedAuthority(
  url: URL,
  hostname: string,
  port: number | undefined,
): boolean {
  if (port === undefined) return false
  const expectedHostname = hostname === '::1' ? '[::1]' : hostname
  const expectedPort = String(port)
  const requestPort =
    url.port || (url.protocol === 'http:' ? '80' : url.protocol === 'https:' ? '443' : '')
  return url.hostname === expectedHostname && requestPort === expectedPort
}

function parsePort(value: string | undefined): number {
  if (!value) return 3000

  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid PORT value: ${value}`)
  }
  return port
}

async function loadStartHandler(entryPoint: string): Promise<StartHandler> {
  const module = (await import(pathToFileURL(entryPoint).href)) as {
    default?: StartHandler
  }

  if (!module.default || typeof module.default.fetch !== 'function') {
    throw new Error(`No TanStack Start handler found at ${entryPoint}`)
  }
  return module.default
}

async function indexAssets(directory: string): Promise<Map<string, Asset>> {
  const assets = new Map<string, Asset>()
  const glob = new Bun.Glob('**/*')

  for await (const relativePath of glob.scan({ cwd: directory, onlyFiles: true })) {
    if (relativePath.endsWith('.map')) continue

    const route = `/${relativePath.replaceAll('\\', '/')}`
    const file = Bun.file(resolve(directory, relativePath))
    const compressed = await compressAsset(file)
    assets.set(route, { file, ...compressed })
  }

  return assets
}

async function compressAsset(file: Bun.BunFile): Promise<Pick<Asset, 'gzip' | 'brotli'>> {
  if (file.size < 1_024 || !isCompressible(file.type)) return {}
  const bytes = await file.arrayBuffer()
  return {
    gzip: Bun.gzipSync(bytes),
    brotli: brotliCompressSync(bytes),
  }
}

function isCompressible(type: string): boolean {
  return (
    type.startsWith('text/') ||
    type.includes('javascript') ||
    type.includes('json') ||
    type.includes('svg+xml')
  )
}

function serveAsset(request: Request, asset: Asset): Response {
  const { file } = asset
  const encoding = asset.brotli && acceptsEncoding(request.headers, 'br')
    ? 'br'
    : asset.gzip && acceptsEncoding(request.headers, 'gzip') ? 'gzip' : undefined
  const compressed = encoding === 'br' ? asset.brotli : encoding === 'gzip' ? asset.gzip : undefined
  const body = compressed ? (new Uint8Array(compressed).buffer as ArrayBuffer) : file
  const bodySize = compressed?.byteLength ?? file.size
  const variant = encoding ?? 'identity'
  const etag = `W/\"${file.size.toString(16)}-${file.lastModified.toString(16)}-${variant}\"`
  const headers = new Headers({
    'Cache-Control': request.url.includes('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600',
    'Content-Length': String(bodySize),
    'Content-Type': file.type || 'application/octet-stream',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  })
  if (asset.gzip) headers.set('Vary', 'Accept-Encoding')
  if (encoding) headers.set('Content-Encoding', encoding)

  if (matchesEtag(request.headers.get('if-none-match'), etag)) {
    headers.delete('Content-Length')
    return new Response(null, { status: 304, headers })
  }

  return new Response(request.method === 'HEAD' ? null : body, { headers })
}

function requestID(candidate: string | null): string {
  return candidate && /^[A-Za-z0-9_-]{8,128}$/.test(candidate)
    ? candidate
    : crypto.randomUUID()
}

function withHostHeaders(response: Response, requestId: string, secure: boolean): Response {
  const headers = new Headers(response.headers)
  headers.set('X-Request-ID', requestId)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=()')
  headers.set('X-Frame-Options', 'DENY')
  if (!headers.has('Content-Security-Policy')) {
    headers.set('Content-Security-Policy', "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'")
  }
  if (secure) headers.set('Strict-Transport-Security', 'max-age=31536000')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function routeTemplate(request: Request): string {
  const path = new URL(request.url).pathname
  if (path === '/healthz' || path === '/readyz') return path
  if (path.startsWith('/assets/')) return '/assets/:asset'
  if (globalEventPath.test(path)) return '/api/opencode/server/:serverKey/global/event'
  if (ptyConnectPath.test(path)) return '/api/opencode/server/:serverKey/pty/:ptyId/connect'
  if (path.startsWith('/api/opencode/server/')) return '/api/opencode/server/:serverKey/:operation'
  if (/^\/server\/[^/]+\/session\/[^/]+$/.test(path)) return '/server/:serverKey/session/:sessionId'
  return ['/', '/new', '/settings'].includes(path) ? path : '/:route'
}

function failureCategory(status: number): string {
  if (status < 400) return 'ok'
  if (status === 401 || status === 403) return 'denied'
  if (status === 404) return 'not-found'
  if (status === 408 || status === 504) return 'timeout'
  if (status >= 500) return 'upstream-or-internal'
  return 'invalid-request'
}

function logRequest(request: Request, response: Response, id: string, startedAt: number, category: string) {
  console.log(JSON.stringify({
    event: 'request',
    requestId: id,
    method: request.method,
    route: routeTemplate(request),
    status: response.status,
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    category,
  }))
}

function acceptsEncoding(headers: Headers, encoding: string): boolean {
  const preferences = (headers.get('accept-encoding') ?? '')
    .split(',')
    .map((value) => {
      const [name = '', ...parameters] = value.trim().toLowerCase().split(';')
      const qualityParameter = parameters.find((parameter) =>
        parameter.trim().startsWith('q='),
      )
      const quality = qualityParameter
        ? Number(qualityParameter.trim().slice(2))
        : 1
      return { name, quality: Number.isFinite(quality) ? quality : 0 }
    })

  const explicit = preferences.find(({ name }) => name === encoding)
  if (explicit) return explicit.quality > 0
  return preferences.some(({ name, quality }) => name === '*' && quality > 0)
}

function matchesEtag(header: string | null, etag: string): boolean {
  if (!header) return false
  if (header.trim() === '*') return true

  const normalizedEtag = etag.replace(/^W\//, '')
  return header
    .split(',')
    .map((value) => value.trim().replace(/^W\//, ''))
    .some((value) => value === normalizedEtag)
}

if (import.meta.main) {
  await startProductionServer({ installSignalHandlers: true })
}
