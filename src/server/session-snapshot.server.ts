import type { Message, Part, Session } from '@opencode-ai/sdk/v2/client'

import type { SessionSnapshot } from '~/lib/session-snapshot'
import {
  createSdkForConnection,
  getDefaultConnection,
  type ServerConnection,
} from './connections.server'

type SessionClient = {
  session: {
    get(
      parameters: { sessionID: string },
      options?: { signal?: AbortSignal },
    ): Promise<{ data: Session | undefined; response?: Response }>
    messages(
      parameters: { sessionID: string; directory: string; limit: number },
      options?: { signal?: AbortSignal },
    ): Promise<{
      data: Array<{ info: Message; parts: Part[] }> | undefined
      response?: Response
    }>
  }
}

export async function loadSessionSnapshot(
  serverKey: string,
  sessionID: string,
  connection: ServerConnection = getDefaultConnection(),
  client: SessionClient = createSdkForConnection(connection, {
    fetch: boundedFetch,
    throwOnError: false,
  }),
): Promise<SessionSnapshot | undefined> {
  if (serverKey !== connection.key) return undefined
  const signal = AbortSignal.timeout(1_500)
  const sessionResult = await client.session.get({ sessionID }, { signal })
  if (!sessionResult.data) {
    if (sessionResult.response?.status === 404) return undefined
    throw new Error('Session could not be loaded')
  }

  const session = sessionResult.data
  const messageResult = await client.session.messages(
    { sessionID, directory: session.directory, limit: 21 },
    { signal },
  )
  if (!messageResult.data) throw new Error('Session messages could not be loaded')
  const messages = messageResult.data
  const visible = messages.slice(-20)

  return {
    id: session.id,
    title: bounded(session.title, 500),
    directory: bounded(session.directory, 2_000),
    hasOlder: messages.length > visible.length,
    items: visible.map(({ info, parts }) => ({
      id: info.id,
      role: info.role,
      createdAt: safeTime(info.time.created),
      createdLabel: formatTime(info.time.created),
      ...(info.role === 'assistant' && info.error
        ? { error: bounded(errorLabel(info.error), 2_000) }
        : {}),
      parts: parts.flatMap((part) => projectPart(part)),
    })),
  }
}

function projectPart(part: Part): SessionSnapshot['items'][number]['parts'] {
  if (part.type === 'text') {
    return part.ignored || part.synthetic
      ? []
      : [{ id: part.id, type: 'text', text: bounded(part.text, 16_000) }]
  }
  if (part.type === 'tool') {
    return [
      {
        id: part.id,
        type: 'tool',
        name: bounded(part.tool, 200),
        status: part.state.status,
        ...('title' in part.state && part.state.title
          ? { title: bounded(part.state.title, 500) }
          : {}),
      },
    ]
  }
  const labels: Partial<Record<Part['type'], string>> = {
    file: 'Attachment',
    reasoning: 'Reasoning',
    retry: 'Retrying response',
    subtask: 'Subtask',
    compaction: 'Conversation compacted',
  }
  const label = labels[part.type]
  return label ? [{ id: part.id, type: 'status', label }] : []
}

function bounded(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}...`
}

function safeTime(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(safeTime(value))
}

function errorLabel(error: object): string {
  if (
    'data' in error &&
    error.data &&
    typeof error.data === 'object' &&
    'message' in error.data
  )
    return String(error.data.message)
  return 'The assistant response failed.'
}

const maximumSnapshotBytes = 1024 * 1024

const boundedFetch: typeof globalThis.fetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, init)
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maximumSnapshotBytes) {
      await response.body?.cancel()
      throw new Error('Session snapshot is too large')
    }
    if (!response.body) return response
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maximumSnapshotBytes) {
        await reader.cancel()
        throw new Error('Session snapshot is too large')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const headers = new Headers(response.headers)
    headers.set('Content-Length', String(size))
    return new Response(bytes, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  },
  { preconnect: globalThis.fetch.preconnect },
)
