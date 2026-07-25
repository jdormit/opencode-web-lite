import type { Session } from '@opencode-ai/sdk/v2/client'
import type { ComposerOptions } from '~/lib/composer-options'

import {
  createSdkForConnection,
  getDefaultConnection,
  type ServerConnection,
} from './connections.server'
import { loadComposerOptions } from './composer-options.server'

type PromptClient = {
  session: {
    get(parameters: { sessionID: string }): Promise<{ data: Session | undefined }>
    promptAsync(parameters: {
      sessionID: string
      messageID: string
      directory: string
      agent: string
      model: { providerID: string; modelID: string }
      variant?: string
      parts: Array<{ type: 'text'; text: string }>
    }): Promise<unknown>
    message(
      parameters: { sessionID: string; messageID: string; directory: string },
      options?: { throwOnError?: boolean },
    ): Promise<{ data?: unknown; response?: Response }>
    abort(parameters: { sessionID: string; directory: string }): Promise<unknown>
  }
}

export async function sendPrompt(
  input: {
    serverKey: string
    sessionID: string
    messageID: string
    text: string
    agent: string
    providerID: string
    modelID: string
    variant: string
  },
  connection: ServerConnection = getDefaultConnection(),
  client: PromptClient = createSdkForConnection(connection),
  composerOptions?: ComposerOptions,
) {
  if (input.serverKey !== connection.key) throw new Error('Unknown server')
  if (!input.text.trim() || input.text.length > 100_000) throw new Error('Prompt text is invalid')
  if (!/^msg_[0-9A-Za-z]{26}$/.test(input.messageID)) throw new Error('Message ID is invalid')
  const session = (await client.session.get({ sessionID: input.sessionID })).data
  if (!session) throw new Error('Session not found')
  const existing = await client.session.message(
    {
      sessionID: session.id,
      messageID: input.messageID,
      directory: session.directory,
    },
    { throwOnError: false },
  )
  if (existing.data) return { accepted: true as const, existing: true as const }
  if (existing.response?.status !== 404)
    throw new Error('Existing message state could not be verified')
  const options = composerOptions ?? (await loadComposerOptions(session.directory, connection))
  if (!options.agents.some((agent) => agent.name === input.agent))
    throw new Error('The selected agent is unavailable')
  const model = options.models.find(
    (candidate) =>
      candidate.providerID === input.providerID && candidate.modelID === input.modelID,
  )
  if (!model) throw new Error('The selected model is unavailable')
  if (input.variant && !model.variants.includes(input.variant))
    throw new Error('The selected variant is unavailable')

  await client.session.promptAsync({
    sessionID: session.id,
    messageID: input.messageID,
    directory: session.directory,
    agent: input.agent,
    model: { providerID: input.providerID, modelID: input.modelID },
    ...(input.variant ? { variant: input.variant } : {}),
    parts: [{ type: 'text', text: input.text }],
  })
  return { accepted: true as const }
}

export async function stopSession(
  input: { serverKey: string; sessionID: string },
  connection: ServerConnection = getDefaultConnection(),
  client: PromptClient = createSdkForConnection(connection),
) {
  if (input.serverKey !== connection.key) throw new Error('Unknown server')
  const session = (await client.session.get({ sessionID: input.sessionID })).data
  if (!session) throw new Error('Session not found')
  await client.session.abort({
    sessionID: session.id,
    directory: session.directory,
  })
  return { stopped: true as const }
}
