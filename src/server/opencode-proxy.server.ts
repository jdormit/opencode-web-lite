import {
  getDefaultConnection,
  type ServerConnection,
} from './connections.server'

type ProxyOptions = Readonly<{
  connection?: ServerConnection
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}>

const allowedRoots = new Set([
  'agent',
  'auth',
  'command',
  'config',
  'event',
  'experimental',
  'file',
  'find',
  'formatter',
  'global',
  'instance',
  'log',
  'lsp',
  'mcp',
  'path',
  'permission',
  'project',
  'provider',
  'pty',
  'question',
  'session',
  'skill',
  'sync',
  'tui',
  'vcs',
  'worktree',
  'workspace',
])

const allowedMethods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'])
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

  const path = validatePath(request, splat)
  if (!path) return new Response('Unsupported OpenCode path', { status: 404 })

  let connection: ServerConnection
  try {
    connection = options.connection ?? getDefaultConnection()
  } catch {
    return new Response('Invalid OpenCode server configuration', { status: 503 })
  }

  const incomingUrl = new URL(request.url)
  const upstreamUrl = new URL(path, connection.url)
  upstreamUrl.search = incomingUrl.search
  const headers = proxyRequestHeaders(request.headers, connection)

  let response: Response
  try {
    response = await (options.fetch ?? fetch)(upstreamUrl, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? null : request.body,
      redirect: 'manual',
      signal: request.signal,
      duplex: request.body ? 'half' : undefined,
    } as RequestInit)
  } catch {
    return new Response('OpenCode server unavailable', { status: 502 })
  }

  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel()
    return new Response('OpenCode redirect rejected', { status: 502 })
  }

  const responseHeaders = new Headers(response.headers)
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
): string | undefined {
  if (!splat) return undefined
  if (splat.split('/').some((segment) => segment === '.' || segment === '..'))
    return undefined

  const prefix = '/api/opencode/'
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
      !allowedRoots.has(decodedSegments[0] ?? '')
    ) {
      return undefined
    }
  } catch {
    return undefined
  }

  return `/${rawPath}`
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
  for (const [name, value] of incoming) {
    if (!strippedRequestHeaders.has(name.toLowerCase())) headers.set(name, value)
  }

  if (connection.password !== undefined) {
    const token = Buffer.from(
      `${connection.username ?? 'opencode'}:${connection.password}`,
    ).toString('base64')
    headers.set('Authorization', `Basic ${token}`)
  }
  return headers
}
