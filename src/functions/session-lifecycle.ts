import { createServerFn } from '@tanstack/react-start'
import { parseRouteIdentity } from '~/lib/identity'
import { mutateSessionLifecycle, type LifecycleAction } from '~/server/session-lifecycle.server'
import { assertSameOriginRequest } from '~/server/request-security.server'

const actions = new Set<LifecycleAction>(['rename', 'archive', 'delete', 'fork', 'share', 'unshare', 'compact', 'undo', 'redo'])

export const sessionLifecycleMutation = createServerFn({ method: 'POST' })
  .validator((data: { serverKey: string; sessionID: string; action: LifecycleAction; value?: string }) => {
    if (!parseRouteIdentity({ serverKey: data.serverKey, sessionId: data.sessionID })) throw new Error('Invalid session identity')
    if (!actions.has(data.action)) throw new Error('Invalid session action')
    if (data.value !== undefined && data.value.length > 2_000) throw new Error('Invalid action value')
    return data
  })
  .handler(({ data }) => { assertSameOriginRequest(); return mutateSessionLifecycle(data.serverKey, data.sessionID, data.action, data.value) })
