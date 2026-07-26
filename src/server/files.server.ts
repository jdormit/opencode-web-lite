import type { FileContent, FileNode, Session } from '@opencode-ai/sdk/v2/client'

import type { FileListResult, FilePreview } from '~/lib/files'
import { validProjectPath } from '~/lib/files'
import { createSdkForConnection, getDefaultConnection, type ServerConnection } from './connections.server'

type FilesClient = {
  session: { get(parameters: { sessionID: string }, options?: { signal?: AbortSignal }): Promise<{ data: Session | undefined }> }
  file: {
    list(parameters: { directory: string; path: string }, options?: { signal?: AbortSignal }): Promise<{ data: FileNode[] | undefined }>
    read(parameters: { directory: string; path: string }, options?: { signal?: AbortSignal }): Promise<{ data: FileContent | undefined }>
  }
  find: {
    files(parameters: { directory: string; query: string; limit: number }, options?: { signal?: AbortSignal }): Promise<{ data: string[] | undefined }>
  }
}

export async function listSessionFiles(
  serverKey: string,
  sessionID: string,
  path: string,
  connection: ServerConnection = getDefaultConnection(),
  client: FilesClient = createSdkForConnection(connection, { fetch: boundedFileFetch, throwOnError: false }),
): Promise<FileListResult> {
  if (!validProjectPath(path)) throw new Error('Invalid file path')
  const { directory, signal } = await sessionDirectory(serverKey, sessionID, connection, client)
  const result = await client.file.list({ directory, path }, { signal })
  if (!result.data) throw new Error('Files could not be loaded')
  return {
    entries: result.data.slice(0, 200).flatMap((entry) =>
      validProjectPath(entry.path) && typeof entry.name === 'string'
        ? [{ name: entry.name.slice(0, 500), path: entry.path, type: entry.type, ignored: entry.ignored }]
        : [],
    ),
    limited: result.data.length > 200,
  }
}

export async function searchSessionFiles(
  serverKey: string,
  sessionID: string,
  query: string,
  connection: ServerConnection = getDefaultConnection(),
  client: FilesClient = createSdkForConnection(connection, { fetch: boundedFileFetch, throwOnError: false }),
) {
  const normalized = query.trim()
  if (!normalized || normalized.length > 200) throw new Error('Invalid file search')
  const { directory, signal } = await sessionDirectory(serverKey, sessionID, connection, client)
  const result = await client.find.files({ directory, query: normalized, limit: 65 }, { signal })
  if (!result.data) throw new Error('File search failed')
  const paths = result.data.filter(validProjectPath).slice(0, 64)
  return { paths, limited: result.data.length > paths.length }
}

export async function readSessionFile(
  serverKey: string,
  sessionID: string,
  path: string,
  connection: ServerConnection = getDefaultConnection(),
  client: FilesClient = createSdkForConnection(connection, { fetch: boundedFileFetch, throwOnError: false }),
): Promise<FilePreview> {
  if (!path || !validProjectPath(path)) throw new Error('Invalid file path')
  const { directory, signal } = await sessionDirectory(serverKey, sessionID, connection, client)
  const result = await client.file.read({ directory, path }, { signal })
  if (!result.data) throw new Error('File could not be read')
  const maximum = 256 * 1024
  return {
    path,
    type: result.data.type,
    content: result.data.type === 'text' ? result.data.content.slice(0, maximum) : '',
    limited: result.data.content.length > maximum,
    ...(result.data.mimeType ? { mimeType: result.data.mimeType.slice(0, 200) } : {}),
  }
}

async function sessionDirectory(
  serverKey: string,
  sessionID: string,
  connection: ServerConnection,
  client: FilesClient,
) {
  if (serverKey !== connection.key) throw new Error('Unknown server')
  const signal = AbortSignal.timeout(2_500)
  const session = await client.session.get({ sessionID }, { signal })
  if (!session.data) throw new Error('Session could not be loaded')
  return { directory: session.data.directory, signal }
}

const maximumResponseBytes = 1024 * 1024
const boundedFileFetch: typeof fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
  const response = await fetch(input, init)
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maximumResponseBytes) {
    await response.body?.cancel()
    throw new Error('File response is too large')
  }
  if (!response.body) return response
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maximumResponseBytes) {
      await reader.cancel()
      throw new Error('File response is too large')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers })
}, { preconnect() {} })
