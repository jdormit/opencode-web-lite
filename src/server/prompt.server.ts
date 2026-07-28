import type { AgentPartInput, FilePartInput, Session, TextPartInput } from '@opencode-ai/sdk/v2/client'
import type { ComposerOptions } from '~/lib/composer-options'
import type { PromptMutationInput } from '~/lib/composer-prompt'
import { dataUrlSourceBytes, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, MAX_ATTACHMENTS_TOTAL_BYTES } from '~/lib/composer-attachments'

import {
  createSdkForConnection,
  resolveConnection,
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
      parts: Array<TextPartInput | FilePartInput | AgentPartInput>
    }): Promise<unknown>
    command?(parameters: {
      sessionID: string; messageID: string; directory: string; agent: string; model: string
      variant?: string; command: string; arguments: string; parts?: FilePartInput[]
    }): Promise<unknown>
    shell?(parameters: {
      sessionID: string; messageID: string; directory: string; agent: string
      model: { providerID: string; modelID: string }; command: string
    }): Promise<unknown>
    message(
      parameters: { sessionID: string; messageID: string; directory: string },
      options?: { throwOnError?: boolean },
    ): Promise<{ data?: unknown; response?: Response }>
    abort(parameters: { sessionID: string; directory: string }): Promise<unknown>
  }
}

export async function sendPrompt(
  input: PromptMutationInput,
  connection: ServerConnection = resolveConnection(input.serverKey),
  client: PromptClient = createSdkForConnection(connection),
  composerOptions?: ComposerOptions,
) {
  if (input.serverKey !== connection.key) throw new Error('Unknown server')
  if (input.text.length > 100_000 || (input.mode === 'shell' && !input.text.trim())) throw new Error('Prompt text is invalid')
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
  const options = composerOptions ?? (await loadComposerOptions(input.serverKey, session.directory, connection))
  if (!options.agents.some((agent) => agent.name === input.agent))
    throw new Error('The selected agent is unavailable')
  const model = options.models.find(
    (candidate) =>
      candidate.providerID === input.providerID && candidate.modelID === input.modelID,
  )
  if (!model) throw new Error('The selected model is unavailable')
  if (input.variant && !model.variants.includes(input.variant))
    throw new Error('The selected variant is unavailable')

  const parts = buildAuthoritativeParts(input, session.directory, options, model)
  if (input.mode === 'shell') {
    if (!client.session.shell) throw new Error('Shell commands are unavailable')
    if ((input.parts ?? []).some((part) => part.type !== 'text')) throw new Error('Shell commands cannot include mentions or attachments')
    await client.session.shell({
      sessionID: session.id, messageID: input.messageID, directory: session.directory,
      agent: input.agent, model: { providerID: input.providerID, modelID: input.modelID }, command: input.text,
    })
    return { accepted: true as const }
  }
  if (input.mode === 'command') {
    if (!client.session.command) throw new Error('Commands are unavailable')
    const command = (options.commands ?? []).find((candidate) => candidate.name === input.command)
    if (!command) throw new Error('The selected command is unavailable')
    await client.session.command({
      sessionID: session.id, messageID: input.messageID, directory: session.directory,
      agent: input.agent, model: `${input.providerID}/${input.modelID}`,
      ...(input.variant ? { variant: input.variant } : {}), command: command.name, arguments: input.text,
      parts: parts.filter((part): part is FilePartInput => part.type === 'file' && part.url.startsWith('data:')),
    })
    return { accepted: true as const }
  }

  await client.session.promptAsync({
    sessionID: session.id,
    messageID: input.messageID,
    directory: session.directory,
    agent: input.agent,
    model: { providerID: input.providerID, modelID: input.modelID },
    ...(input.variant ? { variant: input.variant } : {}),
    parts,
  })
  return { accepted: true as const }
}

function buildAuthoritativeParts(
  input: PromptMutationInput,
  directory: string,
  options: ComposerOptions,
  model: ComposerOptions['models'][number],
): Array<TextPartInput | FilePartInput | AgentPartInput> {
  const output: Array<TextPartInput | FilePartInput | AgentPartInput> = []
  let textCharacters = 0
  let attachments = 0
  let attachmentBytes = 0
  for (const part of input.parts ?? [{ type: 'text' as const, text: input.text }]) {
    if (part.type === 'text') {
      textCharacters += part.text.length
      if (part.text) output.push({ type: 'text', text: part.text })
      continue
    }
    if (part.type === 'context') {
      textCharacters += part.text.length
      if (part.text.length > 32_000) throw new Error('Prompt context is too large')
      output.push({ type: 'text', text: part.text, synthetic: true })
      const path = part.contextType === 'file' ? part.label.replace(/ \(\d+ comments?\)$/, '') : ''
      if (path && validProjectPath(path)) output.push(projectFilePart(path, `@${path}`, 0, path.length + 1, directory))
      continue
    }
    if (part.type === 'project-file') {
      if (!validProjectPath(part.path) || part.start < 0 || part.end <= part.start || input.text.slice(part.start, part.end) !== part.label)
        throw new Error('A project file mention is invalid')
      output.push(projectFilePart(part.path, part.label, part.start, part.end, directory))
      continue
    }
    if (part.type === 'agent') {
      if (!(options.mentionAgents ?? []).some((agent) => agent.name === part.name) || part.start < 0 ||
        part.end <= part.start || input.text.slice(part.start, part.end) !== part.label)
        throw new Error('An agent mention is invalid')
      output.push({ type: 'agent', name: part.name, source: { value: part.label, start: part.start, end: part.end } })
      continue
    }
    attachments += 1
    const bytes = dataUrlSourceBytes(part.url)
    if (bytes === undefined || bytes !== part.size || bytes > MAX_ATTACHMENT_BYTES || part.filename.length > 500)
      throw new Error('An attachment is invalid')
    if (!validMime(part.mime) || !part.url.startsWith(`data:${part.mime};base64,`)) throw new Error('An attachment type is invalid')
    if (part.mime.startsWith('image/') && !model.capabilities?.image) throw new Error('The selected model does not accept images')
    if (part.mime === 'application/pdf' && !model.capabilities?.pdf) throw new Error('The selected model does not accept PDFs')
    attachmentBytes += bytes
    output.push({ type: 'file', mime: part.mime, filename: part.filename, url: part.url })
  }
  if ((!output.length && input.mode !== 'command') || textCharacters > 100_000) throw new Error('Prompt parts are invalid')
  if (attachments > MAX_ATTACHMENTS || attachmentBytes > MAX_ATTACHMENTS_TOTAL_BYTES) throw new Error('Attachment limits were exceeded')
  return output
}

function projectFilePart(path: string, label: string, start: number, end: number, directory: string): FilePartInput {
  const absolute = `${directory.replace(/[\\/]+$/, '')}/${path}`
  const filename = path.split(/[\\/]/).pop()
  return {
    type: 'file', mime: 'text/plain', ...(filename ? { filename } : {}),
    url: `file://${encodeURI(absolute)}`,
    source: { type: 'file', path: absolute, text: { value: label, start, end } },
  }
}

function validProjectPath(path: string) {
  return path.length > 0 && path.length <= 2_000 && !path.includes('\0') && !path.startsWith('/') &&
    !/^[A-Za-z]:[\\/]/.test(path) && !path.split(/[\\/]/).includes('..')
}

function validMime(mime: string) {
  return mime === 'application/pdf' || mime.startsWith('image/') || mime.startsWith('text/')
}

export async function stopSession(
  input: { serverKey: string; sessionID: string },
  connection: ServerConnection = resolveConnection(input.serverKey),
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
