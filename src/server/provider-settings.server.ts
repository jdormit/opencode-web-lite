import type { Config, Provider, ProviderAuthAuthorization, ProviderAuthMethod } from '@opencode-ai/sdk/v2/client'

import type { CustomProviderInput, SafeProvider } from '~/lib/provider-settings'
import { safeExternalUrl, validateCustomProvider } from '~/lib/provider-settings'
import { createSdkForConnection, resolveConnection, type ServerConnection } from './connections.server'

type ProviderClient = {
  provider: {
    list(parameters?: undefined, options?: { signal?: AbortSignal }): Promise<{ data?: { all: Provider[]; connected: string[]; default: Record<string, string> } }>
    auth(parameters?: undefined, options?: { signal?: AbortSignal }): Promise<{ data?: Record<string, ProviderAuthMethod[]> }>
    oauth: {
      authorize(parameters: { providerID: string; method: number; inputs: Record<string, string> }, options?: { signal?: AbortSignal }): Promise<{ data?: ProviderAuthAuthorization }>
      callback(parameters: { providerID: string; method: number; code?: string }, options?: { signal?: AbortSignal }): Promise<{ data?: boolean }>
    }
  }
  auth: {
    set(parameters: { providerID: string; auth: { type: 'api'; key: string } }, options?: { signal?: AbortSignal }): Promise<unknown>
    remove(parameters: { providerID: string }, options?: { signal?: AbortSignal }): Promise<unknown>
  }
  config: {
    get(parameters?: undefined, options?: { signal?: AbortSignal }): Promise<{ data?: Config }>
    update(parameters: { config: Config }, options?: { signal?: AbortSignal }): Promise<unknown>
  }
}

function scoped(serverKey: string, connection: ServerConnection, directory?: string) {
  if (serverKey !== connection.key) throw new Error('Unknown server')
  return createSdkForConnection(connection, { ...(directory ? { directory } : {}) }) as ProviderClient
}

export async function listProviderSettings(
  serverKey: string, directory?: string, connection = resolveConnection(serverKey),
  client: ProviderClient = scoped(serverKey, connection, directory),
): Promise<SafeProvider[]> {
  if (serverKey !== connection.key) throw new Error('Unknown server')
  const signal = AbortSignal.timeout(2_500)
  const [providers, auth] = await Promise.all([client.provider.list(undefined, { signal }), client.provider.auth(undefined, { signal })])
  if (!providers.data) throw new Error('Providers could not be loaded')
  const connected = new Set(providers.data.connected)
  return providers.data.all.slice(0, 500).map((provider) => ({
    id: provider.id,
    name: provider.name,
    source: provider.source,
    connected: connected.has(provider.id),
    disconnectable: connected.has(provider.id) && provider.source !== 'env',
    modelCount: Object.keys(provider.models).length,
    methods: (auth.data?.[provider.id] ?? []).slice(0, 10).map((method, index) => ({
      index, type: method.type, label: method.label,
      prompts: (method.prompts ?? []).slice(0, 20).map((prompt) => prompt.type === 'text'
        ? { type: 'text' as const, key: prompt.key, message: prompt.message, ...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}) }
        : { type: 'select' as const, key: prompt.key, message: prompt.message, options: prompt.options.slice(0, 50).map((option) => ({ label: option.label, value: option.value, ...(option.hint ? { hint: option.hint } : {}) })) }),
    })),
  }))
}

export async function connectProviderKey(
  input: { serverKey: string; directory?: string; providerID: string; key: string },
  connection = resolveConnection(input.serverKey), client: ProviderClient = scoped(input.serverKey, connection, input.directory),
) {
  if (!input.key.trim() || input.key.length > 20_000) throw new Error('API key is required')
  await client.auth.set({ providerID: input.providerID, auth: { type: 'api', key: input.key } }, { signal: AbortSignal.timeout(5_000) })
  return { connected: true as const }
}

export async function disconnectProvider(
  input: { serverKey: string; directory?: string; providerID: string },
  connection = resolveConnection(input.serverKey), client: ProviderClient = scoped(input.serverKey, connection, input.directory),
) {
  const provider = (await listProviderSettings(input.serverKey, input.directory, connection, client)).find((item) => item.id === input.providerID)
  if (!provider?.disconnectable) throw new Error('This provider cannot be disconnected here')
  await client.auth.remove({ providerID: input.providerID }, { signal: AbortSignal.timeout(5_000) })
  return { disconnected: true as const }
}

export async function authorizeProviderOAuth(
  input: { serverKey: string; directory?: string; providerID: string; method: number; inputs: Record<string, string> },
  connection = resolveConnection(input.serverKey), client: ProviderClient = scoped(input.serverKey, connection, input.directory),
) {
  if (!Number.isInteger(input.method) || input.method < 0 || input.method > 20) throw new Error('OAuth method is invalid')
  if (Object.keys(input.inputs).length > 20 || Object.values(input.inputs).some((value) => value.length > 2_000)) throw new Error('OAuth input is invalid')
  const result = await client.provider.oauth.authorize(
    { providerID: input.providerID, method: input.method, inputs: input.inputs },
    { signal: AbortSignal.timeout(30_000) },
  )
  if (!result.data) throw new Error('OAuth authorization did not start')
  return { ...result.data, url: safeExternalUrl(result.data.url) }
}

export async function completeProviderOAuth(
  input: { serverKey: string; directory?: string; providerID: string; method: number; code: string },
  connection = resolveConnection(input.serverKey), client: ProviderClient = scoped(input.serverKey, connection, input.directory),
) {
  if (!input.code.trim() || input.code.length > 4_000) throw new Error('Authorization code is required')
  const result = await client.provider.oauth.callback(
    { providerID: input.providerID, method: input.method, code: input.code },
    { signal: AbortSignal.timeout(30_000) },
  )
  if (!result.data) throw new Error('OAuth authorization failed')
  return { connected: true as const }
}

export async function pollProviderOAuth(
  input: { serverKey: string; directory?: string; providerID: string; method: number },
  connection = resolveConnection(input.serverKey), client: ProviderClient = scoped(input.serverKey, connection, input.directory),
) {
  const result = await client.provider.oauth.callback(
    { providerID: input.providerID, method: input.method },
    { signal: AbortSignal.timeout(30_000) },
  )
  if (!result.data) throw new Error('OAuth authorization is not complete')
  return { connected: true as const }
}

export async function saveCustomProvider(
  input: { serverKey: string; directory?: string; provider: CustomProviderInput },
  connection = resolveConnection(input.serverKey), client: ProviderClient = scoped(input.serverKey, connection, input.directory),
) {
  const provider = validateCustomProvider(input.provider)
  const signal = AbortSignal.timeout(5_000)
  const current = await client.config.get(undefined, { signal })
  if (!current.data) throw new Error('Provider configuration could not be loaded')
  if (provider.apiKey) await client.auth.set({ providerID: provider.providerID, auth: { type: 'api', key: provider.apiKey } }, { signal })
  await client.config.update({ config: {
    provider: {
      [provider.providerID]: {
        npm: '@ai-sdk/openai-compatible', name: provider.name,
        options: {
          baseURL: provider.baseURL,
          ...(provider.headers.length ? { headers: Object.fromEntries(provider.headers.map((header) => [header.name, header.value])) } : {}),
        },
        models: Object.fromEntries(provider.models.map((model) => [model.id, { name: model.name }])),
      },
    },
    ...(current.data.disabled_providers ? { disabled_providers: current.data.disabled_providers.filter((id) => id !== provider.providerID) } : {}),
  } }, { signal })
  return { connected: true as const, providerID: provider.providerID }
}
