import { createServerFn } from '@tanstack/react-start'

import { loadSessionHistoryPage, loadSessionSnapshot } from '~/server/session-snapshot.server'
import { parseRouteIdentity } from '~/lib/identity'

export const getSessionSnapshot = createServerFn({ method: 'GET' })
  .validator((data: { serverKey: string; sessionID: string }) => {
    if (!parseRouteIdentity({ serverKey: data.serverKey, sessionId: data.sessionID })) {
      throw new Error('Invalid session identity')
    }
    return data
  })
  .handler(({ data }) => loadSessionSnapshot(data.serverKey, data.sessionID))

export const getSessionHistoryPage = createServerFn({ method: 'GET' })
  .validator((data: { serverKey: string; sessionID: string; cursor: string; limit: number }) => {
    if (!parseRouteIdentity({ serverKey: data.serverKey, sessionId: data.sessionID })) {
      throw new Error('Invalid session identity')
    }
    if (!data.cursor || data.cursor.length > 2_048) throw new Error('Invalid history cursor')
    if (!Number.isSafeInteger(data.limit) || data.limit < 1 || data.limit > 200) {
      throw new Error('Invalid history limit')
    }
    return data
  })
  .handler(({ data }) =>
    loadSessionHistoryPage(data.serverKey, data.sessionID, data.cursor, data.limit),
  )
