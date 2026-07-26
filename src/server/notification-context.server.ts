import type { Session } from '@opencode-ai/sdk/v2/client'
import { createSdkForConnection, resolveConnection, type ServerConnection } from './connections.server'

type Client = { session: { get(input: { sessionID: string }, options?: { signal?: AbortSignal }): Promise<{ data: Session | undefined }> } }

export async function loadNotificationContext(
  serverKey: string,
  sessionID: string,
  connection: ServerConnection = resolveConnection(serverKey),
  client: Client = createSdkForConnection(connection, { throwOnError: false }),
) {
  if (serverKey !== connection.key) throw new Error('Unknown server')
  const result = await client.session.get({ sessionID }, { signal: AbortSignal.timeout(2_500) })
  if (!result.data) throw new Error('Session could not be loaded')
  return { root: !result.data.parentID }
}
