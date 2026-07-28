import { createServerFn } from '@tanstack/react-start'

import type { CustomProviderInput } from '~/lib/provider-settings'
import {
  authorizeProviderOAuth, completeProviderOAuth, connectProviderKey, disconnectProvider,
  listProviderSettings, pollProviderOAuth, saveCustomProvider,
} from '~/server/provider-settings.server'
import { assertSameOriginRequest } from '~/server/request-security.server'

function object(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Invalid input')
  return value as Record<string, unknown>
}
function base(value: unknown) {
  const item = object(value)
  if (typeof item.serverKey !== 'string') throw new Error('Invalid input')
  if (item.directory !== undefined && typeof item.directory !== 'string') throw new Error('Invalid input')
  return { item, serverKey: item.serverKey, ...(typeof item.directory === 'string' ? { directory: item.directory } : {}) }
}

export const getProviderSettings = createServerFn({ method: 'GET' }).validator((value) => {
  const { item: _, ...input } = base(value)
  return input
}).handler(({ data }) => listProviderSettings(data.serverKey, data.directory))

export const connectProviderKeyMutation = createServerFn({ method: 'POST' }).validator((value) => {
  const { item, ...input } = base(value)
  if (typeof item.providerID !== 'string' || typeof item.key !== 'string') throw new Error('Invalid input')
  return { ...input, providerID: item.providerID, key: item.key }
}).handler(({ data }) => { assertSameOriginRequest(); return connectProviderKey(data) })

export const disconnectProviderMutation = createServerFn({ method: 'POST' }).validator((value) => {
  const { item, ...input } = base(value)
  if (typeof item.providerID !== 'string') throw new Error('Invalid input')
  return { ...input, providerID: item.providerID }
}).handler(({ data }) => { assertSameOriginRequest(); return disconnectProvider(data) })

export const authorizeProviderOAuthMutation = createServerFn({ method: 'POST' }).validator((value) => {
  const { item, ...input } = base(value)
  if (typeof item.providerID !== 'string' || typeof item.method !== 'number' || !item.inputs || typeof item.inputs !== 'object') throw new Error('Invalid input')
  return { ...input, providerID: item.providerID, method: item.method, inputs: item.inputs as Record<string, string> }
}).handler(({ data }) => { assertSameOriginRequest(); return authorizeProviderOAuth(data) })

export const completeProviderOAuthMutation = createServerFn({ method: 'POST' }).validator((value) => {
  const { item, ...input } = base(value)
  if (typeof item.providerID !== 'string' || typeof item.method !== 'number' || typeof item.code !== 'string') throw new Error('Invalid input')
  return { ...input, providerID: item.providerID, method: item.method, code: item.code }
}).handler(({ data }) => { assertSameOriginRequest(); return completeProviderOAuth(data) })

export const pollProviderOAuthMutation = createServerFn({ method: 'POST' }).validator((value) => {
  const { item, ...input } = base(value)
  if (typeof item.providerID !== 'string' || typeof item.method !== 'number') throw new Error('Invalid input')
  return { ...input, providerID: item.providerID, method: item.method }
}).handler(({ data }) => { assertSameOriginRequest(); return pollProviderOAuth(data) })

export const saveCustomProviderMutation = createServerFn({ method: 'POST' }).validator((value) => {
  const { item, ...input } = base(value)
  if (!item.provider || typeof item.provider !== 'object') throw new Error('Invalid input')
  return { ...input, provider: item.provider as CustomProviderInput }
}).handler(({ data }) => { assertSameOriginRequest(); return saveCustomProvider(data) })
