export type ComposerWirePart =
  | { type: 'text'; text: string }
  | { type: 'project-file'; path: string; label: string; start: number; end: number }
  | { type: 'agent'; name: string; label: string; start: number; end: number }
  | { type: 'attachment'; mime: string; filename: string; url: string; size: number }
  | { type: 'context'; contextType: 'file' | 'diff'; label: string; text: string }

export type PromptMutationInput = {
  serverKey: string
  sessionID: string
  messageID: string
  mode?: 'prompt' | 'shell' | 'command'
  text: string
  command?: string
  agent: string
  providerID: string
  modelID: string
  variant: string
  parts?: ComposerWirePart[]
}

export function parsePromptMutation(value: unknown): PromptMutationInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid input')
  const item = value as Record<string, unknown>
  for (const key of ['serverKey', 'sessionID', 'messageID', 'text', 'agent', 'providerID', 'modelID', 'variant'])
    if (typeof item[key] !== 'string') throw new Error('Invalid input')
  const mode = item.mode === undefined ? 'prompt' : item.mode
  if (mode !== 'prompt' && mode !== 'shell' && mode !== 'command') throw new Error('Invalid input')
  if (item.command !== undefined && typeof item.command !== 'string') throw new Error('Invalid input')
  const parts = item.parts === undefined ? [{ type: 'text' as const, text: item.text as string }] : parseWireParts(item.parts)
  return {
    serverKey: item.serverKey as string,
    sessionID: item.sessionID as string,
    messageID: item.messageID as string,
    mode,
    text: item.text as string,
    ...(typeof item.command === 'string' ? { command: item.command } : {}),
    agent: item.agent as string,
    providerID: item.providerID as string,
    modelID: item.modelID as string,
    variant: item.variant as string,
    parts,
  }
}

function parseWireParts(value: unknown): ComposerWirePart[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error('Invalid prompt parts')
  return value.map((raw): ComposerWirePart => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid prompt part')
    const part = raw as Record<string, unknown>
    if (part.type === 'text' && typeof part.text === 'string') return { type: 'text', text: part.text }
    if (part.type === 'project-file' && typeof part.path === 'string' && typeof part.label === 'string' &&
      Number.isInteger(part.start) && Number.isInteger(part.end))
      return { type: 'project-file', path: part.path, label: part.label, start: part.start as number, end: part.end as number }
    if (part.type === 'agent' && typeof part.name === 'string' && typeof part.label === 'string' &&
      Number.isInteger(part.start) && Number.isInteger(part.end))
      return { type: 'agent', name: part.name, label: part.label, start: part.start as number, end: part.end as number }
    if (part.type === 'attachment' && typeof part.mime === 'string' && typeof part.filename === 'string' &&
      typeof part.url === 'string' && Number.isInteger(part.size))
      return { type: 'attachment', mime: part.mime, filename: part.filename, url: part.url, size: part.size as number }
    if (part.type === 'context' && (part.contextType === 'file' || part.contextType === 'diff') &&
      typeof part.label === 'string' && typeof part.text === 'string')
      return { type: 'context', contextType: part.contextType, label: part.label, text: part.text }
    throw new Error('Invalid prompt part')
  })
}
