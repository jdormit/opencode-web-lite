import { createServerFn } from '@tanstack/react-start'

import { loadHomeIndex } from '~/server/home-index.server'

export const getHomeIndex = createServerFn({ method: 'GET' })
  .validator((data: unknown) => {
    if (!data || typeof data !== 'object' || !('serverKey' in data) ||
      typeof data.serverKey !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.serverKey)) {
      throw new Error('Invalid server identity')
    }
    return { serverKey: data.serverKey }
  })
  .handler(({ data }) => loadHomeIndex(data.serverKey))
