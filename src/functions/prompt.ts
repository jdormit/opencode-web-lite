import { createServerFn } from '@tanstack/react-start'

import { sendPrompt, stopSession } from '~/server/prompt.server'

function strings(data: unknown, names: string[]) {
  if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
  const output: Record<string, string> = {}
  for (const name of names) {
    if (!(name in data) || typeof data[name as keyof typeof data] !== 'string')
      throw new Error('Invalid input')
    output[name] = data[name as keyof typeof data] as string
  }
  return output
}

export const sendPromptMutation = createServerFn({ method: 'POST' })
  .validator((data: unknown) => strings(data, ['serverKey', 'sessionID', 'messageID', 'text', 'agent', 'providerID', 'modelID', 'variant']) as Parameters<typeof sendPrompt>[0])
  .handler(({ data }) => sendPrompt(data))

export const stopSessionMutation = createServerFn({ method: 'POST' })
  .validator((data: unknown) => strings(data, ['serverKey', 'sessionID']) as Parameters<typeof stopSession>[0])
  .handler(({ data }) => stopSession(data))
