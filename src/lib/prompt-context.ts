export function appendPromptContext(current: string, context: unknown) {
  if (typeof context !== 'string' || !context || context.length > 32_000) {
    return { ok: false as const, reason: 'context-limit' as const }
  }
  const value = `${current}${current ? '\n\n' : ''}${context}`
  if (value.length > 100_000) return { ok: false as const, reason: 'prompt-limit' as const }
  return { ok: true as const, value }
}
