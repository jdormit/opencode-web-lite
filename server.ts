import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

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
}>

type SocketData = { kind: 'upgrade-probe' }

type Asset = {
  file: Bun.BunFile
  gzip?: Uint8Array
}

const defaultClientDirectory = './dist/client'
const defaultServerEntryPoint = './dist/server/server.js'
const websocketProbePath = '/__foundation/websocket'

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

  const server = Bun.serve<SocketData>({
    hostname,
    port,
    async fetch(request, bunServer) {
      const url = new URL(request.url)
      if (!hasExpectedAuthority(url, hostname, bunServer.port)) {
        return new Response('Misdirected request', { status: 421 })
      }

      if (
        options.enableWebSocketProbe === true &&
        url.pathname === websocketProbePath
      ) {
        if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
          return new Response('WebSocket upgrade required', { status: 426 })
        }

        return bunServer.upgrade(request, {
          data: { kind: 'upgrade-probe' },
        })
          ? undefined
          : new Response('WebSocket upgrade failed', { status: 400 })
      }

      const asset = assets.get(url.pathname)
      if (asset && (request.method === 'GET' || request.method === 'HEAD')) {
        return serveAsset(request, asset)
      }

      return handler.fetch(request)
    },
    websocket: {
      open(socket) {
        if (socket.data.kind !== 'upgrade-probe') return
        socket.send('upgrade-ok')
        socket.close(1000, 'Probe complete')
      },
      message() {},
    },
  })

  if (options.log !== false) {
    console.log(`OpenCode Web Lite listening on http://${hostname}:${server.port}`)
  }

  return server
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
    const gzip = await compressAsset(file)
    assets.set(route, gzip ? { file, gzip } : { file })
  }

  return assets
}

async function compressAsset(file: Bun.BunFile): Promise<Uint8Array | undefined> {
  if (file.size < 1_024 || !isCompressible(file.type)) return undefined
  return Bun.gzipSync(await file.arrayBuffer())
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
  const gzip = asset.gzip
  const usesGzip = gzip !== undefined && acceptsEncoding(request.headers, 'gzip')
  const body = usesGzip ? (new Uint8Array(gzip).buffer as ArrayBuffer) : file
  const bodySize = usesGzip ? gzip.byteLength : file.size
  const variant = usesGzip ? 'gzip' : 'identity'
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
  if (usesGzip) headers.set('Content-Encoding', 'gzip')

  if (matchesEtag(request.headers.get('if-none-match'), etag)) {
    headers.delete('Content-Length')
    return new Response(null, { status: 304, headers })
  }

  return new Response(request.method === 'HEAD' ? null : body, { headers })
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
  await startProductionServer()
}
