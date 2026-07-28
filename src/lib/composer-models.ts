import type { ComposerModel } from './composer-options'

export type ModelPreferences = {
  recent: string[]
  hidden: string[]
  variants: Record<string, string>
  workspaces: Record<string, string>
}

export const emptyModelPreferences = (): ModelPreferences => ({ recent: [], hidden: [], variants: {}, workspaces: {} })
export const modelKey = (model: Pick<ComposerModel, 'providerID' | 'modelID'>) => `${model.providerID}\0${model.modelID}`

export function parseModelPreferences(value: unknown): ModelPreferences {
  if (!value || typeof value !== 'object') return emptyModelPreferences()
  const item = value as Record<string, unknown>
  const strings = (input: unknown, limit: number) => Array.isArray(input)
    ? input.filter((entry): entry is string => typeof entry === 'string' && entry.length <= 500).slice(0, limit)
    : []
  const record = (input: unknown) => input && typeof input === 'object'
    ? Object.fromEntries(Object.entries(input).filter(([key, entry]) => key.length <= 500 && typeof entry === 'string' && entry.length <= 500).slice(0, 500))
    : {}
  return { recent: strings(item.recent, 8), hidden: strings(item.hidden, 500), variants: record(item.variants), workspaces: record(item.workspaces) }
}

export function pushRecent(preferences: ModelPreferences, key: string) {
  return { ...preferences, recent: [key, ...preferences.recent.filter((entry) => entry !== key)].slice(0, 5) }
}

export function searchModels(models: ComposerModel[], query: string, hidden: string[] = []) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const excluded = new Set(hidden)
  return models.filter((model) => !excluded.has(modelKey(model)) && words.every((word) =>
    `${model.providerName} ${model.providerID} ${model.name} ${model.modelID}`.toLowerCase().includes(word)))
}
