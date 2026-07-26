import type { Session } from '@opencode-ai/sdk/v2/client'
import { createSdkForConnection, getDefaultConnection, type ServerConnection } from './connections.server'

export type LifecycleAction = 'rename' | 'archive' | 'delete' | 'fork' | 'share' | 'unshare' | 'compact' | 'undo' | 'redo'

type Client = {
  session: {
    get(input: { sessionID: string }, options?: { signal?: AbortSignal }): Promise<{ data: Session | undefined }>
    update(input: { sessionID: string; directory: string; title?: string; time?: { archived?: number } }, options?: { signal?: AbortSignal }): Promise<{ data: Session | undefined }>
    delete(input: { sessionID: string; directory: string }, options?: { signal?: AbortSignal }): Promise<{ data: boolean | undefined }>
    fork(input: { sessionID: string; directory: string; messageID?: string }, options?: { signal?: AbortSignal }): Promise<{ data: Session | undefined }>
    share(input: { sessionID: string; directory: string }, options?: { signal?: AbortSignal }): Promise<{ data: Session | undefined }>
    unshare(input: { sessionID: string; directory: string }, options?: { signal?: AbortSignal }): Promise<{ data: Session | undefined }>
    summarize(input: { sessionID: string; directory: string; providerID: string; modelID: string }, options?: { signal?: AbortSignal }): Promise<{ data: boolean | undefined }>
    revert(input: { sessionID: string; directory: string; messageID: string }, options?: { signal?: AbortSignal }): Promise<{ data: Session | undefined }>
    unrevert(input: { sessionID: string; directory: string }, options?: { signal?: AbortSignal }): Promise<{ data: Session | undefined }>
  }
}

export async function mutateSessionLifecycle(
  serverKey: string,
  sessionID: string,
  action: LifecycleAction,
  value?: string,
  connection: ServerConnection = getDefaultConnection(),
  client: Client = createSdkForConnection(connection, { throwOnError: false }),
) {
  if (serverKey !== connection.key) throw new Error('Unknown server')
  const signal = AbortSignal.timeout(5_000)
  const current = await client.session.get({ sessionID }, { signal })
  if (!current.data) throw new Error('Session could not be loaded')
  const directory = current.data.directory
  if (action === 'rename') {
    const title = value?.trim()
    if (!title || title.length > 200) throw new Error('Invalid session title')
    const result = await client.session.update({ sessionID, directory, title }, { signal })
    if (!result.data) throw new Error('Session could not be renamed')
    return { sessionID: result.data.id }
  }
  if (action === 'archive') {
    const result = await client.session.update({ sessionID, directory, time: { archived: Date.now() } }, { signal })
    if (!result.data) throw new Error('Session could not be archived')
    return { sessionID }
  }
  if (action === 'delete') {
    const result = await client.session.delete({ sessionID, directory }, { signal })
    if (result.data !== true) throw new Error('Session could not be deleted')
    return { sessionID }
  }
  if (action === 'fork') {
    const result = await client.session.fork({ sessionID, directory, ...(value ? { messageID: value } : {}) }, { signal })
    if (!result.data) throw new Error('Session could not be forked')
    return { sessionID: result.data.id }
  }
  if (action === 'share') {
    const result = await client.session.share({ sessionID, directory }, { signal })
    if (!result.data) throw new Error('Session could not be shared')
    return { sessionID, shareUrl: result.data.share?.url }
  }
  if (action === 'unshare') {
    const result = await client.session.unshare({ sessionID, directory }, { signal })
    if (!result.data) throw new Error('Session could not be made private')
    return { sessionID }
  }
  if (action === 'compact') {
    if (!current.data.model) throw new Error('Choose a model before compacting this session')
    const result = await client.session.summarize({
      sessionID,
      directory,
      providerID: current.data.model.providerID,
      modelID: current.data.model.id,
    }, { signal })
    if (result.data !== true) throw new Error('Session could not be compacted')
    return { sessionID }
  }
  if (action === 'undo') {
    if (!value) throw new Error('A message is required to undo')
    const result = await client.session.revert({ sessionID, directory, messageID: value }, { signal })
    if (!result.data) throw new Error('Session could not be reverted')
    return { sessionID }
  }
  if (value) {
    const result = await client.session.revert({ sessionID, directory, messageID: value }, { signal })
    if (!result.data) throw new Error('Session could not be restored')
    return { sessionID }
  }
  const result = await client.session.unrevert({ sessionID, directory }, { signal })
  if (!result.data) throw new Error('Session could not be restored')
  return { sessionID }
}
