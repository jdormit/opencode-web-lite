import type { Config, Message, Part, PermissionRequest, QuestionRequest, Session, SessionStatus, SnapshotFileDiff, Todo } from '@opencode-ai/sdk/v2/client'

import type { SessionFileDiff, SessionHistoryPage, SessionSnapshot, SessionTimelineItem } from '~/lib/session-snapshot'
import { projectTurns } from '~/lib/session-snapshot'
import { projectTimelineMessage, projectTokens } from '~/lib/timeline-projection'
import {
  createSdkForConnection,
  resolveConnection,
  type ServerConnection,
} from './connections.server'

type SessionClient = {
  session: {
    get(
      parameters: { sessionID: string },
      options?: { signal?: AbortSignal },
    ): Promise<{ data: Session | undefined; response?: Response }>
    messages(
      parameters: { sessionID: string; directory: string; limit: number; before?: string },
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
    diff?(parameters: { sessionID: string; directory: string; messageID: string }, options?: { signal?: AbortSignal }): Promise<{ data: SnapshotFileDiff[] | undefined }>
  }
  permission?: { list(parameters: { directory: string }, options?: { signal?: AbortSignal }): Promise<{ data: PermissionRequest[] | undefined }> }
  question?: { list(parameters: { directory: string }, options?: { signal?: AbortSignal }): Promise<{ data: QuestionRequest[] | undefined }> }
  config?: { get(parameters: { directory: string }, options?: { signal?: AbortSignal }): Promise<{ data: Config | undefined }> }
  vcs?: { get(parameters: { directory: string }, options?: { signal?: AbortSignal }): Promise<{ data: { branch?: string; default_branch?: string } | undefined }> }
}

export async function loadSessionFileDiff(
  serverKey: string,
  sessionID: string,
  messageID: string,
  file: string,
  connection: ServerConnection = resolveConnection(serverKey),
  client: SessionClient = createSdkForConnection(connection, { fetch: boundedFetch, throwOnError: false }),
): Promise<SessionFileDiff | undefined> {
  if (serverKey !== connection.key) throw new Error('Unknown server')
  if (!file || file.length > 2_000 || file.includes('\0')) throw new Error('Invalid diff file')
  const signal = AbortSignal.timeout(2_500)
  const sessionResult = await client.session.get({ sessionID }, { signal })
  if (!sessionResult.data) throw new Error('Session could not be loaded')
  if (!client.session.diff) throw new Error('Detailed diffs are unavailable')
  const diffs = (await client.session.diff({
    sessionID, directory: sessionResult.data.directory, messageID,
  }, { signal })).data ?? []
  const match = diffs.find((diff) => diff.file === file)
  if (!match?.patch) return undefined
  return { file, patch: match.patch.slice(0, 512 * 1024), limited: match.patch.length > 512 * 1024 }
}

export async function loadSessionSnapshot(
  serverKey: string,
  sessionID: string,
  connection: ServerConnection = resolveConnection(serverKey),
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
  const [messageResult, statusResult, childResult, todoResult, permissionResult, questionResult, configResult, vcsResult] = await Promise.all([
    client.session.messages(
      { sessionID, directory: session.directory, limit: 20 },
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
    client.config?.get({ directory: session.directory }, { signal }).catch(() => undefined),
    client.vcs?.get({ directory: session.directory }, { signal }).catch(() => undefined),
  ])
  if (!messageResult.data) throw new Error('Session messages could not be loaded')
  const messages = messageResult.data
  const revertIndex = await loadRevertIndex(session, messages, messageResult.response, client, signal)
  const visible = messages.slice(-20)
  const currentTurnMessage = [...messages].reverse().find(({ info }) => info.role === 'user')?.info
  const currentTurnSummary = currentTurnMessage?.summary
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

  const projectedItems = visible.map(projectMessage)
  const lastAssistant = [...projectedItems].reverse().find((item) => item.role === 'assistant')
  const sessionTokens = projectTokens(session.tokens)
  const contextTokens = lastAssistant?.metadata.tokens ?? sessionTokens
  const contextCost = lastAssistant?.metadata.cost ?? session.cost
  return {
    id: session.id,
    title: bounded(session.title, 500),
    directory: bounded(session.directory, 2_000),
    ...(session.parentID ? { parentID: bounded(session.parentID, 500) } : {}),
    children: (childResult?.data ?? []).slice(0, 50).map((child) => ({
      id: bounded(child.id, 500),
      title: bounded(child.title, 500),
    })),
    childrenLimited: (childResult?.data?.length ?? 0) > 50,
    ...(session.share?.url ? { shareUrl: bounded(session.share.url, 4_096) } : {}),
    sharingEnabled: Boolean(configResult?.data && configResult.data.share !== 'disabled'),
    ...(session.revert?.messageID ? { revertMessageID: bounded(session.revert.messageID, 500) } : {}),
    ...(revertIndex.undoMessageID ? { revertUndoMessageID: revertIndex.undoMessageID } : {}),
    revertedTurns: revertIndex.turns,
    revertsLimited: revertIndex.limited,
    hasOlder: Boolean(messageResult.response?.headers.get('x-next-cursor')),
    ...(messageResult.response?.headers.get('x-next-cursor')
      ? { historyCursor: bounded(messageResult.response.headers.get('x-next-cursor')!, 2_048) }
      : {}),
    busy: statusResult?.data?.[session.id]?.type === 'busy',
    ...(vcsResult?.data?.branch ? { branch: bounded(vcsResult.data.branch, 500) } : {}),
    ...(vcsResult?.data?.default_branch ? { defaultBranch: bounded(vcsResult.data.default_branch, 500) } : {}),
    requestsUnavailable:
      permissionResult?.failed === true ||
      questionResult?.failed === true ||
      lineageLimited,
    removedMessageIds: [],
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
    changesAdditions: currentTurnDiffs.reduce(
      (sum, diff) => sum + (Number.isFinite(diff.additions) ? diff.additions : 0),
      0,
    ),
    changesDeletions: currentTurnDiffs.reduce(
      (sum, diff) => sum + (Number.isFinite(diff.deletions) ? diff.deletions : 0),
      0,
    ),
    ...(currentTurnMessage ? { changeMessageId: currentTurnMessage.id } : {}),
    ...projectPermission(permission),
    ...projectQuestion(question),
    items: projectedItems,
    turns: projectTurns(projectedItems, statusResult?.data?.[session.id]?.type === 'busy'),
    context: {
      providerID: lastAssistant?.metadata.providerID ?? session.model?.providerID,
      modelID: lastAssistant?.metadata.modelID ?? session.model?.id,
      agent: lastAssistant?.metadata.agent ?? session.agent,
      variant: lastAssistant?.metadata.variant ?? session.model?.variant,
      tokens: contextTokens,
      cost: contextCost,
      createdAt: safeTime(session.time.created),
      updatedAt: safeTime(session.time.updated),
      completedAt: lastAssistant?.metadata.completedAt,
      freshness: lastAssistant ? 'current' : contextTokens ? 'estimated' : 'unavailable',
    },
  }
}

async function loadRevertIndex(
  session: Session,
  current: Array<{ info: Message; parts: Part[] }>,
  response: Response | undefined,
  client: SessionClient,
  signal: AbortSignal,
) {
  const boundary = session.revert?.messageID
  if (!boundary) return { turns: [], limited: false }
  let retained = current
  let cursor = response?.headers.get('x-next-cursor') ?? undefined
  let failed = false
  const complete = () => retained.some(({ info }) => info.role === 'user' && info.id < boundary)
  while (!complete() && cursor && retained.length < 1_000) {
    try {
      const page = await client.session.messages({
        sessionID: session.id,
        directory: session.directory,
        limit: Math.min(200, 1_000 - retained.length),
        before: cursor,
      }, { signal })
      if (!page.data?.length) { failed = true; break }
      retained = [...page.data, ...retained]
      const next = page.response?.headers.get('x-next-cursor') ?? undefined
      if (next === cursor) { failed = true; break }
      cursor = next
    } catch {
      failed = true
      break
    }
  }
  const users = retained.filter(({ info }) => info.role === 'user')
  const undoMessageID = [...users].reverse().find(({ info }) => info.id < boundary)?.info.id
  const boundaryFound = users.some(({ info }) => info.id === boundary)
  return {
    ...(undoMessageID ? { undoMessageID: bounded(undoMessageID, 500) } : {}),
    turns: users.filter(({ info }) => info.id >= boundary).slice(0, 1_000).map(({ info, parts }) => ({
      id: bounded(info.id, 500),
      label: bounded(parts.find((part) => part.type === 'text')?.type === 'text'
        ? (parts.find((part) => part.type === 'text') as Extract<Part, { type: 'text' }>).text
        : formatTime(info.time.created), 100),
    })),
    limited: failed || Boolean(cursor) || !boundaryFound,
  }
}

export async function loadSessionHistoryPage(
  serverKey: string,
  sessionID: string,
  cursor: string,
  limit = 200,
  connection: ServerConnection = resolveConnection(serverKey),
  client: SessionClient = createSdkForConnection(connection, {
    fetch: boundedFetch,
    throwOnError: false,
  }),
): Promise<SessionHistoryPage> {
  if (serverKey !== connection.key) throw new Error('Unknown server')
  if (!cursor || cursor.length > 2_048) throw new Error('Invalid history cursor')
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('Invalid history limit')
  const signal = AbortSignal.timeout(2_500)
  const sessionResult = await client.session.get({ sessionID }, { signal })
  if (!sessionResult.data) throw new Error('Session could not be loaded')
  const response = await client.session.messages({
    sessionID,
    directory: sessionResult.data.directory,
    limit,
    before: cursor,
  }, { signal })
  if (!response.data) throw new Error('Session history could not be loaded')
  const next = response.response?.headers.get('x-next-cursor') ?? undefined
  return {
    items: response.data.slice(-limit).map(projectMessage),
    ...(next ? { cursor: bounded(next, 2_048) } : {}),
    complete: !next,
  }
}

function projectMessage({ info, parts }: { info: Message; parts: Part[] }): SessionTimelineItem {
  const projected = projectTimelineMessage(
    info as unknown as Record<string, unknown>,
    parts as unknown as Array<Record<string, unknown>>,
  )
  if (!projected) throw new Error('Invalid session message')
  return projected
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

function bounded(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}...`
}

function safeTime(value: number): number {
  return Number.isFinite(value) && value >= 0 && value <= 8_640_000_000_000_000 ? value : 0
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(safeTime(value))
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
