import type { PermissionRequest, QuestionRequest, Session } from '@opencode-ai/sdk/v2/client'
import { createSdkForConnection, resolveConnection, type ServerConnection } from './connections.server'

type RequestClient = {
  session: { get(parameters: { sessionID: string }): Promise<{ data: Session | undefined }> }
  permission: {
    list(parameters: { directory: string }): Promise<{ data: PermissionRequest[] | undefined }>
    reply(parameters: { requestID: string; directory: string; reply: 'once' | 'always' | 'reject' }): Promise<unknown>
  }
  question: {
    list(parameters: { directory: string }): Promise<{ data: QuestionRequest[] | undefined }>
    reply(parameters: { requestID: string; directory: string; answers: string[][] }): Promise<unknown>
    reject(parameters: { requestID: string; directory: string }): Promise<unknown>
  }
}

export async function replyPermission(input: {
  serverKey: string
  sessionID: string
  directory: string
  requestID: string
  reply: 'once' | 'always' | 'reject'
}, connection: ServerConnection = resolveConnection(input.serverKey), client: RequestClient = createSdkForConnection(connection)) {
  if (input.serverKey !== connection.key) throw new Error('Unknown server')
  const session = await client.session.get({ sessionID: input.sessionID })
  if (!session.data) throw new Error('Session not found')
  const directory = session.data.directory
  const pending = await client.permission.list({ directory })
  if (!pending.data?.some((request) => request.id === input.requestID && request.sessionID === input.sessionID))
    throw new Error('Permission request is no longer pending')
  await client.permission.reply({
    requestID: input.requestID,
    directory,
    reply: input.reply,
  })
  return { responded: true as const }
}

export async function replyQuestion(input: {
  serverKey: string
  sessionID: string
  directory: string
  requestID: string
  answers: string[][]
}, connection: ServerConnection = resolveConnection(input.serverKey), client: RequestClient = createSdkForConnection(connection)) {
  if (input.serverKey !== connection.key) throw new Error('Unknown server')
  const session = await client.session.get({ sessionID: input.sessionID })
  if (!session.data) throw new Error('Session not found')
  const directory = session.data.directory
  const pending = await client.question.list({ directory })
  const request = pending.data?.find(
    (candidate) => candidate.id === input.requestID && candidate.sessionID === input.sessionID,
  )
  if (!request) throw new Error('Question request is no longer pending')
  if (input.answers.length !== request.questions.length || input.answers.some((answer) => !answer.length))
    throw new Error('Answer every question')
  if (input.answers.flat().some((answer) => answer.length > 2_000))
    throw new Error('Question answer is too long')
  request.questions.forEach((question, index) => {
    const answers = input.answers[index] ?? []
    if (!question.multiple && answers.length !== 1) throw new Error('Choose one answer')
    const labels = new Set(question.options.map((option) => option.label))
    if (!question.custom && answers.some((answer) => !labels.has(answer)))
      throw new Error('Custom answers are not allowed')
  })
  await client.question.reply({
    requestID: input.requestID,
    directory,
    answers: input.answers,
  })
  return { responded: true as const }
}

export async function rejectQuestion(input: {
  serverKey: string
  sessionID: string
  requestID: string
}, connection: ServerConnection = resolveConnection(input.serverKey), client: RequestClient = createSdkForConnection(connection)) {
  if (input.serverKey !== connection.key) throw new Error('Unknown server')
  const session = await client.session.get({ sessionID: input.sessionID })
  if (!session.data) throw new Error('Session not found')
  const directory = session.data.directory
  const pending = await client.question.list({ directory })
  if (!pending.data?.some((request) => request.id === input.requestID && request.sessionID === input.sessionID))
    throw new Error('Question request is no longer pending')
  await client.question.reject({ requestID: input.requestID, directory })
  return { responded: true as const }
}
