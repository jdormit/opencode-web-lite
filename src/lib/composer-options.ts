export type ComposerAgent = { name: string; description?: string }
export type ComposerModel = {
  providerID: string
  providerName: string
  modelID: string
  name: string
  variants: string[]
  capabilities?: { image: boolean; pdf: boolean; reasoning: boolean; attachment: boolean }
  contextLimit?: number
  outputLimit?: number
  status?: 'alpha' | 'beta' | 'active'
}

export type ComposerCommand = {
  name: string
  description?: string
  source: 'command' | 'skill' | 'mcp'
  hints: string[]
}

export type ComposerOptions = {
  agents: ComposerAgent[]
  models: ComposerModel[]
  mentionAgents?: ComposerAgent[]
  commands?: ComposerCommand[]
  directory?: string
  defaultAgent?: string
  defaultModel?: { providerID: string; modelID: string }
  currentAgent?: string
  currentModel?: { providerID: string; modelID: string; variant?: string }
}
