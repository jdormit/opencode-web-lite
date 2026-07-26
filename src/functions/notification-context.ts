import { createServerFn } from '@tanstack/react-start'
import { parseRouteIdentity } from '~/lib/identity'
import { loadNotificationContext } from '~/server/notification-context.server'

export const getNotificationContext = createServerFn({ method: 'GET' })
  .validator((data: { serverKey: string; sessionID: string }) => {
    if (!parseRouteIdentity({ serverKey: data.serverKey, sessionId: data.sessionID })) throw new Error('Invalid session identity')
    return data
  })
  .handler(({ data }) => loadNotificationContext(data.serverKey, data.sessionID))
