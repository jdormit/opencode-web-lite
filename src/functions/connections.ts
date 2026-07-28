import { createServerFn } from '@tanstack/react-start'

import {
  getDefaultConnectionSnapshot,
  getConnectionRegistrySnapshot,
  removeConnection,
  saveConnection,
  selectDefaultConnection,
} from '~/server/connections.server'
import type { ConnectionInput } from '~/lib/connection'
import { assertSameOriginRequest } from '~/server/request-security.server'

export const getConnectionSnapshot = createServerFn({ method: 'GET' }).handler(
  () => getDefaultConnectionSnapshot(),
)

export const getConnections = createServerFn({ method: 'GET' }).handler(
  () => getConnectionRegistrySnapshot(),
)

export const saveConnectionMutation = createServerFn({ method: 'POST' })
  .validator(validateConnectionInput)
  .handler(({ data }) => { assertSameOriginRequest(); return saveConnection(data) })

export const removeConnectionMutation = createServerFn({ method: 'POST' })
  .validator(validateKey)
  .handler(({ data }) => { assertSameOriginRequest(); removeConnection(data.serverKey); return { ok: true } })

export const defaultConnectionMutation = createServerFn({ method: 'POST' })
  .validator(validateKey)
  .handler(({ data }) => { assertSameOriginRequest(); selectDefaultConnection(data.serverKey); return { ok: true } })

function validateKey(data: unknown) {
  if (!data || typeof data !== 'object' || !('serverKey' in data) ||
    typeof data.serverKey !== 'string' || !/^server_[A-Za-z0-9_-]{1,64}$/.test(data.serverKey)) {
    throw new Error('Invalid server identity')
  }
  return { serverKey: data.serverKey }
}

function validateConnectionInput(data: ConnectionInput): ConnectionInput {
  if (!data || typeof data !== 'object') throw new Error('Invalid connection')
  if (data.key !== undefined && !/^server_[A-Za-z0-9_-]{1,64}$/.test(data.key)) throw new Error('Invalid server identity')
  if (typeof data.label !== 'string' || data.label.length > 80) throw new Error('Invalid server label')
  if (typeof data.url !== 'string' || data.url.length > 2_048) throw new Error('Invalid server URL')
  if (data.username !== undefined && (typeof data.username !== 'string' || data.username.length > 256)) throw new Error('Invalid username')
  if (data.password !== undefined && (typeof data.password !== 'string' || data.password.length > 4_096)) throw new Error('Invalid password')
  return data
}
