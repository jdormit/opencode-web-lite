import { createServerFn } from '@tanstack/react-start'

import { loadSessionSnapshot } from '~/server/session-snapshot.server'

export const getSessionSnapshot = createServerFn({ method: 'GET' })
  .validator((data: { serverKey: string; sessionID: string }) => data)
  .handler(({ data }) => loadSessionSnapshot(data.serverKey, data.sessionID))
