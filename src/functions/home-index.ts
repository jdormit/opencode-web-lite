import { createServerFn } from '@tanstack/react-start'

import { loadAllHomeIndices, loadHomeIndex } from '~/server/home-index.server'
import type { HomeIndexQuery } from '~/lib/home-index'

export const getHomeIndex = createServerFn({ method: 'GET' })
  .validator((data: unknown) => {
    if (!data || typeof data !== 'object' || !('serverKey' in data) ||
      typeof data.serverKey !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.serverKey)) {
      throw new Error('Invalid server identity')
    }
    const query: HomeIndexQuery = {}
    if ('search' in data && typeof data.search === 'string') query.search = data.search.trim().slice(0, 200)
    if ('projectID' in data && typeof data.projectID === 'string') query.projectID = data.projectID.slice(0, 128)
    if ('start' in data && typeof data.start === 'number' && Number.isInteger(data.start) && data.start >= 0) query.start = data.start
    if ('limit' in data && typeof data.limit === 'number' && Number.isInteger(data.limit)) query.limit = data.limit
    return { serverKey: data.serverKey, query }
  })
  .handler(({ data }) => loadHomeIndex(data.serverKey, undefined, undefined, data.query))

export const getAllHomeIndices = createServerFn({ method: 'GET' })
  .validator((data: unknown) => {
    const query: HomeIndexQuery = {}
    if (data && typeof data === 'object') {
      if ('search' in data && typeof data.search === 'string') query.search = data.search.trim().slice(0, 200)
      if ('limit' in data && typeof data.limit === 'number' && Number.isInteger(data.limit)) query.limit = data.limit
      if ('start' in data && typeof data.start === 'number' && Number.isInteger(data.start) && data.start >= 0) query.start = data.start
    }
    return query
  })
  .handler(({ data }) => loadAllHomeIndices(data))
