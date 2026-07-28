import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'
import { createHash, randomBytes } from 'node:crypto'

import type {
  ConnectionSnapshot,
  ConnectionInput,
  ConnectionRegistrySnapshot,
  PublicServerConnection,
} from '~/lib/connection'
import { finiteOpenCodeFetch } from './bounded-fetch.server'
import { connectionStorePath, readConnectionStore, writeConnectionStore } from './connection-persistence.server'

export type ServerConnection = PublicServerConnection & {
  username?: string
  password?: string
}

export type ConnectionRegistry = Readonly<{
  readonly defaultKey: string
  readonly persistent: boolean
  list(): ServerConnection[]
  resolve(serverKey: string): ServerConnection
  save(input: ConnectionInput, options?: ProbeOptions): Promise<ConnectionSnapshot>
  remove(serverKey: string): void
  setDefault(serverKey: string): void
}>

type ProbeOptions = Readonly<{
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  timeoutMs?: number
}>

const defaultServerUrl = 'http://localhost:4096'
const maximumHealthBytes = 64 * 1024
const defaultProbeTimeoutMs = 650
const snapshotCacheMs = 2_000
let snapshotCache:
  | { key: string; expiresAt: number; promise: Promise<ConnectionSnapshot> }
  | undefined

export function getDefaultConnection(
  env: Record<string, string | undefined> = process.env,
): ServerConnection {
  const url = normalizeServerUrl(env.OPENCODE_SERVER_URL ?? defaultServerUrl)
  const parsed = new URL(url)
  const username = env.OPENCODE_SERVER_USERNAME
  const hasPassword = env.OPENCODE_SERVER_PASSWORD !== undefined
  const password = env.OPENCODE_SERVER_PASSWORD

  if (hasPassword && parsed.protocol === 'http:' && !isLoopback(parsed.hostname)) {
    throw new Error('OpenCode credentials require HTTPS for non-loopback servers')
  }

  return {
    key: createServerKey(url),
    label: env.OPENCODE_SERVER_LABEL?.trim() || parsed.hostname,
    url,
    ...(hasPassword
      ? { password: password ?? '', username: username || 'opencode' }
      : {}),
  }
}

export function createConnectionRegistry(
  env: Record<string, string | undefined> = process.env,
): ConnectionRegistry {
  const encryptionKey = env.OPENCODE_WEB_ENCRYPTION_KEY
  const path = connectionStorePath(env)
  const storedResult = readConnectionStore(encryptionKey, path)
  if (storedResult.status === 'unreadable') throw new Error('Saved OpenCode connections could not be decrypted or validated')
  const stored = storedResult.status === 'valid' ? storedResult.store : undefined
  const fallback = stored ? undefined : getDefaultConnection(env)
  let defaultKey = stored?.defaultKey ?? fallback!.key
  let connections = stored?.connections ?? [fallback!]
  const persist = () => writeConnectionStore(
    { version: 1, defaultKey, connections },
    encryptionKey,
    path,
  )
  return {
    get defaultKey() { return defaultKey },
    persistent: Boolean(encryptionKey),
    list: () => connections.map((connection) => ({ ...connection })),
    resolve: (serverKey) => {
      const connection = connections.find((candidate) => candidate.key === serverKey)
      if (!connection) throw new Error('Unknown server')
      return { ...connection }
    },
    async save(input, options) {
      const existing = input.key ? connections.find((candidate) => candidate.key === input.key) : undefined
      if (input.key && !existing) throw new Error('Unknown server')
      const url = normalizeServerUrl(input.url)
      const duplicate = connections.find((candidate) => candidate.url === url && candidate.key !== input.key)
      if (duplicate) throw new Error('That server is already saved')
      const parsed = new URL(url)
      const password = input.clearCredentials ? undefined : input.password ?? existing?.password
      const username = input.clearCredentials ? undefined : input.username?.trim() || existing?.username
      if (password !== undefined && parsed.protocol === 'http:' && !isLoopback(parsed.hostname)) {
        throw new Error('OpenCode credentials require HTTPS for non-loopback servers')
      }
      const connection: ServerConnection = {
        key: existing?.key ?? createOpaqueServerKey(),
        label: input.label.trim() || parsed.hostname,
        url,
        ...(password !== undefined ? { password, username: username || 'opencode' } : {}),
      }
      const snapshot = await probeConnection(connection, options)
      if (snapshot.state !== 'connected') throw new Error(`Server health check failed: ${snapshot.state}`)
      connections = existing
        ? connections.map((candidate) => candidate.key === existing.key ? connection : candidate)
        : [...connections, connection]
      persist()
      return snapshot
    },
    remove(serverKey) {
      if (!connections.some((candidate) => candidate.key === serverKey)) throw new Error('Unknown server')
      if (connections.length === 1) throw new Error('At least one server is required')
      connections = connections.filter((candidate) => candidate.key !== serverKey)
      if (defaultKey === serverKey) defaultKey = connections[0]!.key
      persist()
    },
    setDefault(serverKey) {
      if (!connections.some((candidate) => candidate.key === serverKey)) throw new Error('Unknown server')
      defaultKey = serverKey
      persist()
    },
  }
}

let registry: ConnectionRegistry | undefined

export function getConnectionRegistry() {
  return registry ??= createConnectionRegistry()
}

export function resolveConnection(serverKey: string): ServerConnection {
  return getConnectionRegistry().resolve(serverKey)
}

export function createSdkForConnection(
  connection: ServerConnection,
  options: Readonly<{
    fetch?: typeof globalThis.fetch
    throwOnError?: boolean
    directory?: string
  }> = {},
) {
  return createOpencodeClient({
    baseUrl: connection.url,
    headers: authorizationHeaders(connection),
    ...options,
    fetch: options.fetch ?? finiteOpenCodeFetch,
    throwOnError: options.throwOnError ?? true,
  })
}

export function getDefaultConnectionSnapshot(): Promise<ConnectionSnapshot> {
  let connection: ServerConnection
  try {
    const current = getConnectionRegistry()
    connection = current.resolve(current.defaultKey)
  } catch {
    return Promise.resolve({
      server: { key: 'invalid', label: 'Invalid configuration', url: '' },
      state: 'invalid-configuration',
    })
  }

  const now = Date.now()
  if (
    snapshotCache &&
    snapshotCache.key === connection.key &&
    snapshotCache.expiresAt > now
  ) {
    return snapshotCache.promise
  }

  const promise = probeConnection(connection)
  snapshotCache = {
    key: connection.key,
    expiresAt: now + snapshotCacheMs,
    promise,
  }
  return promise
}

export async function getConnectionRegistrySnapshot(): Promise<ConnectionRegistrySnapshot> {
  const current = getConnectionRegistry()
  const servers = await Promise.all(current.list().map((connection) => probeConnection(connection)))
  return { defaultKey: current.defaultKey, servers, persistent: current.persistent }
}

export async function saveConnection(input: ConnectionInput) {
  const result = await getConnectionRegistry().save(input)
  snapshotCache = undefined
  return result
}

export function removeConnection(serverKey: string) {
  getConnectionRegistry().remove(serverKey)
  snapshotCache = undefined
}

export function selectDefaultConnection(serverKey: string) {
  getConnectionRegistry().setDefault(serverKey)
  snapshotCache = undefined
}

export async function probeConnection(
  connection: ServerConnection,
  options: ProbeOptions = {},
): Promise<ConnectionSnapshot> {
  const publicConnection = toPublicConnection(connection)
  const timeoutMs = options.timeoutMs ?? defaultProbeTimeoutMs

  try {
    const response = await (options.fetch ?? fetch)(
      new URL('/global/health', connection.url),
      {
        ...withAuthorization(connection),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      },
    )

    if (response.status === 401 || response.status === 403) {
      return { server: publicConnection, state: 'authentication-failed' }
    }
    if (response.status >= 300 && response.status < 400) {
      return { server: publicConnection, state: 'incompatible' }
    }
    if (!response.ok) {
      return {
        server: publicConnection,
        state: [404, 405, 410, 501].includes(response.status)
          ? 'incompatible'
          : 'unavailable',
      }
    }
    if (!response.headers.get('content-type')?.includes('application/json')) {
      return { server: publicConnection, state: 'incompatible' }
    }

    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > maximumHealthBytes) {
      return { server: publicConnection, state: 'incompatible' }
    }

    const text = await readBoundedText(response, maximumHealthBytes)
    if (text === undefined)
      return { server: publicConnection, state: 'incompatible' }

    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      return { server: publicConnection, state: 'incompatible' }
    }
    if (!isV1Health(value)) {
      return { server: publicConnection, state: 'incompatible' }
    }

    return {
      server: publicConnection,
      state: 'connected',
      version: value.version,
    }
  } catch {
    return { server: publicConnection, state: 'unavailable' }
  }
}

export function normalizeServerUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('OPENCODE_SERVER_URL must be a valid URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('OPENCODE_SERVER_URL must use http or https')
  }
  if (url.username || url.password) {
    throw new Error('Put OpenCode credentials in dedicated environment variables')
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('OPENCODE_SERVER_URL must contain only an origin')
  }

  return url.origin
}

export function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function createServerKey(url: string): string {
  return `server_${createHash('sha256').update(url).digest('hex').slice(0, 16)}`
}

function createOpaqueServerKey(): string {
  return `server_${randomBytes(16).toString('base64url')}`
}

function authorizationHeaders(connection: ServerConnection) {
  if (connection.password === undefined) return undefined

  const token = Buffer.from(
    `${connection.username ?? 'opencode'}:${connection.password}`,
  ).toString('base64')
  return { Authorization: `Basic ${token}` }
}

async function readBoundedText(
  response: Response,
  maximumBytes: number,
): Promise<string | undefined> {
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maximumBytes) {
        await reader.cancel()
        return undefined
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function withAuthorization(connection: ServerConnection) {
  const headers = authorizationHeaders(connection)
  return headers ? { headers } : {}
}

function toPublicConnection(connection: ServerConnection): PublicServerConnection {
  return {
    key: connection.key,
    label: connection.label,
    url: connection.url,
  }
}

function isV1Health(value: unknown): value is { healthy: true; version: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'healthy' in value &&
    value.healthy === true &&
    'version' in value &&
    typeof value.version === 'string' &&
    value.version.length > 0
  )
}
