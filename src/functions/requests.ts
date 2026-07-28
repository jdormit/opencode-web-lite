import { createServerFn } from '@tanstack/react-start'
import { rejectQuestion, replyPermission, replyQuestion } from '~/server/requests.server'
import { assertSameOriginRequest } from '~/server/request-security.server'

export const replyPermissionMutation = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    const value = record(data)
    const rawReply = text(value, 'reply')
    if (rawReply !== 'once' && rawReply !== 'always' && rawReply !== 'reject')
      throw new Error('Invalid permission response')
    const reply: 'once' | 'always' | 'reject' = rawReply
    return {
      serverKey: text(value, 'serverKey'),
      sessionID: text(value, 'sessionID'),
      directory: text(value, 'directory'),
      requestID: text(value, 'requestID'),
      reply,
    }
  })
  .handler(({ data }) => { assertSameOriginRequest(); return replyPermission(data) })

export const replyQuestionMutation = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    const value = record(data)
    if (!Array.isArray(value.answers)) throw new Error('Invalid question answers')
    const answers = value.answers.map((answer) => {
      if (!Array.isArray(answer) || !answer.every((item) => typeof item === 'string'))
        throw new Error('Invalid question answers')
      return answer
    })
    return {
      serverKey: text(value, 'serverKey'),
      sessionID: text(value, 'sessionID'),
      directory: text(value, 'directory'),
      requestID: text(value, 'requestID'),
      answers,
    }
  })
  .handler(({ data }) => { assertSameOriginRequest(); return replyQuestion(data) })

export const rejectQuestionMutation = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    const value = record(data)
    return {
      serverKey: text(value, 'serverKey'),
      sessionID: text(value, 'sessionID'),
      requestID: text(value, 'requestID'),
    }
  })
  .handler(({ data }) => { assertSameOriginRequest(); return rejectQuestion(data) })

function record(data: unknown): Record<string, unknown> {
  if (typeof data !== 'object' || data === null) throw new Error('Invalid request')
  return data as Record<string, unknown>
}

function text(data: Record<string, unknown>, key: string): string {
  const value = data[key]
  if (typeof value !== 'string' || !value || value.length > 4_096)
    throw new Error('Invalid request')
  return value
}
