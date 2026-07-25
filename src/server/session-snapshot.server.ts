import type { Message, Part, PermissionRequest, QuestionRequest, Session, SessionStatus, Todo } from '@opencode-ai/sdk/v2/client'

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
    status?(
      parameters: { directory: string },
      options?: { signal?: AbortSignal },
    ): Promise<{ data: Record<string, SessionStatus> | undefined }>
    children?(
      parameters: { sessionID: string; directory: string },
      options?: { signal?: AbortSignal },
    ): Promise<{ data: Session[] | undefined }>
    todo?(parameters: { sessionID: string; directory: string }, options?: { signal?: AbortSignal }): Promise<{ data: Todo[] | undefined }>
  }
  permission?: { list(parameters: { directory: string }, options?: { signal?: AbortSignal }): Promise<{ data: PermissionRequest[] | undefined }> }
  question?: { list(parameters: { directory: string }, options?: { signal?: AbortSignal }): Promise<{ data: QuestionRequest[] | undefined }> }
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
  const [messageResult, statusResult, childResult, todoResult, permissionResult, questionResult] = await Promise.all([
    client.session.messages(
      { sessionID, directory: session.directory, limit: 21 },
      { signal },
    ),
    client.session.status?.({ directory: session.directory }, { signal }),
    client.session.children?.({ sessionID: session.id, directory: session.directory }, { signal }).catch(() => undefined),
    client.session.todo
      ? client.session.todo({ sessionID: session.id, directory: session.directory }, { signal })
          .then((value) => ({ value, failed: value.data === undefined }))
          .catch(() => ({ value: undefined, failed: true }))
      : undefined,
    client.permission
      ? client.permission.list({ directory: session.directory }, { signal })
          .then((value) => ({ value, failed: value.data === undefined }))
          .catch(() => ({ value: undefined, failed: true }))
      : undefined,
    client.question
      ? client.question.list({ directory: session.directory }, { signal })
          .then((value) => ({ value, failed: value.data === undefined }))
          .catch(() => ({ value: undefined, failed: true }))
      : undefined,
  ])
  if (!messageResult.data) throw new Error('Session messages could not be loaded')
  const messages = messageResult.data
  const visible = messages.slice(-20)
  const currentTurnSummary = [...messages].reverse().find(({ info }) => info.role === 'user')?.info.summary
  const currentTurnDiffs = currentTurnSummary && typeof currentTurnSummary === 'object'
    ? currentTurnSummary.diffs
    : []
  const sessionCache = new Map(
    [session, ...(childResult?.data ?? []).slice(0, 50)].map((item) => [item.id, item]),
  )
  const permission = await findLineageRequest(
    permissionResult?.value?.data,
    session,
    client,
    sessionCache,
    signal,
  )
  const question = await findLineageRequest(
    questionResult?.value?.data,
    session,
    client,
    sessionCache,
    signal,
  )
  const lineageLimited =
    (permissionResult?.value?.data?.length ?? 0) > 100 ||
    (questionResult?.value?.data?.length ?? 0) > 100

  return {
    id: session.id,
    title: bounded(session.title, 500),
    directory: bounded(session.directory, 2_000),
    hasOlder: messages.length > visible.length,
    busy: statusResult?.data?.[session.id]?.type === 'busy',
    requestsUnavailable:
      permissionResult?.failed === true ||
      questionResult?.failed === true ||
      lineageLimited,
    todos: (todoResult?.value?.data ?? []).slice(0, 20).map((todo) => ({
      content: bounded(todo.content, 2_000),
      status: bounded(todo.status, 100),
      priority: bounded(todo.priority, 100),
    })),
    todosLimited: (todoResult?.value?.data?.length ?? 0) > 20,
    todosUnavailable: todoResult?.failed === true,
    changes: currentTurnDiffs.filter((diff) => Boolean(diff.file)).slice(0, 40).map((diff, index) => ({
      file: bounded(diff.file!, 2_000),
      status: diff.status ?? 'modified',
      additions: Number.isFinite(diff.additions) ? diff.additions : 0,
      deletions: Number.isFinite(diff.deletions) ? diff.deletions : 0,
      ...(diff.patch && index < 5 ? { patch: bounded(diff.patch, 8_000) } : {}),
      patchLimited: index < 5 && (diff.patch?.length ?? 0) > 8_000,
      patchOmitted: Boolean(diff.patch) && index >= 5,
    })),
    changesLimited: currentTurnDiffs.filter((diff) => Boolean(diff.file)).length > 40,
    changesTotal: currentTurnDiffs.filter((diff) => Boolean(diff.file)).length,
    ...projectPermission(permission),
    ...projectQuestion(question),
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

async function findLineageRequest<T extends { sessionID: string }>(
  requests: T[] | undefined,
  root: Session,
  client: SessionClient,
  cache: Map<string, Session>,
  signal: AbortSignal,
): Promise<T | undefined> {
  for (const request of (requests ?? []).slice(0, 100)) {
    let sessionID: string | undefined = request.sessionID
    for (let depth = 0; sessionID && depth < 20; depth += 1) {
      if (sessionID === root.id) return request
      let current = cache.get(sessionID)
      if (!current) {
        const result = await client.session.get({ sessionID }, { signal })
        current = result.data
        if (!current) break
        cache.set(current.id, current)
      }
      sessionID = current.parentID
    }
  }
  return undefined
}

function projectPermission(request: PermissionRequest | undefined) {
  if (!request) return {}
  const complete =
    request.patterns.length <= 100 &&
    request.always.length <= 100 &&
    [...request.patterns, ...request.always].every((pattern) => pattern.length <= 2_000)
  return {
    permission: {
      id: bounded(request.id, 200),
      sessionID: bounded(request.sessionID, 200),
      permission: bounded(request.permission, 500),
      patterns: request.patterns.slice(0, 100).map((pattern) => bounded(pattern, 2_000)),
      always: request.always.slice(0, 100).map((pattern) => bounded(pattern, 2_000)),
      complete,
    },
  }
}

function projectQuestion(request: QuestionRequest | undefined) {
  if (!request) return {}
  const complete =
    request.questions.length <= 20 &&
    request.questions.every(
      (question) =>
        question.question.length <= 2_000 &&
        question.header.length <= 100 &&
        question.options.length <= 50 &&
        question.options.every(
          (option) => option.label.length <= 200 && option.description.length <= 1_000,
        ),
    )
  return {
    question: {
      id: bounded(request.id, 200),
      sessionID: bounded(request.sessionID, 200),
      questions: request.questions.slice(0, 20).map((question) => ({
        header: bounded(question.header, 100),
        question: bounded(question.question, 2_000),
        multiple: question.multiple === true,
        custom: question.custom !== false,
        options: question.options.slice(0, 50).map((option) => ({
          label: bounded(option.label, 200),
          description: bounded(option.description, 1_000),
        })),
      })),
      complete,
    },
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
