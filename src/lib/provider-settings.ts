export type SafeProvider = {
  id: string
  name: string
  source: 'env' | 'config' | 'custom' | 'api'
  connected: boolean
  disconnectable: boolean
  modelCount: number
  methods: Array<{
    index: number
    type: 'oauth' | 'api'
    label: string
    prompts: Array<
      | { type: 'text'; key: string; message: string; placeholder?: string }
      | { type: 'select'; key: string; message: string; options: Array<{ label: string; value: string; hint?: string }> }
    >
  }>
}

export type CustomProviderInput = {
  providerID: string
  name: string
  baseURL: string
  apiKey?: string
  models: Array<{ id: string; name: string }>
  headers: Array<{ name: string; value: string }>
}

export function validateCustomProvider(value: CustomProviderInput) {
  const providerID = value.providerID.trim()
  const name = value.name.trim()
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(providerID)) throw new Error('Provider ID must use lowercase letters, numbers, hyphens, or underscores')
  if (!name || name.length > 100) throw new Error('Provider name is invalid')
  const base = new URL(value.baseURL)
  if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new Error('Base URL must use HTTP or HTTPS')
  if (value.models.length < 1 || value.models.length > 100) throw new Error('Add between 1 and 100 models')
  const models = value.models.map((model) => ({ id: model.id.trim(), name: model.name.trim() }))
  if (models.some((model) => !model.id || model.id.length > 200 || !model.name || model.name.length > 200) ||
    new Set(models.map((model) => model.id)).size !== models.length) throw new Error('Model IDs and names must be unique and non-empty')
  if (value.headers.length > 50) throw new Error('Too many custom headers')
  const headers = value.headers.map((header) => ({ name: header.name.trim(), value: header.value.trim() }))
  if (headers.some((header) => !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(header.name) || !header.value || /[\r\n]/.test(header.value)) ||
    new Set(headers.map((header) => header.name.toLowerCase())).size !== headers.length) throw new Error('Custom headers are invalid or duplicated')
  return { providerID, name, baseURL: base.toString().replace(/\/$/, ''), apiKey: value.apiKey?.trim() || undefined, models, headers }
}

export function safeExternalUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Authorization URL is unsafe')
  return url.toString()
}
