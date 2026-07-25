export type ComposerAgent = { name: string; description?: string }
export type ComposerModel = {
  providerID: string
  providerName: string
  modelID: string
  name: string
  variants: string[]
}

export type ComposerOptions = {
  agents: ComposerAgent[]
  models: ComposerModel[]
  defaultAgent?: string
  defaultModel?: { providerID: string; modelID: string }
}
