import { createServerFn } from '@tanstack/react-start'

import { parseRouteIdentity } from '~/lib/identity'
import { validProjectPath } from '~/lib/files'
import { listSessionFiles, readSessionFile, searchSessionFiles } from '~/server/files.server'

function identity(data: { serverKey: string; sessionID: string }) {
  if (!parseRouteIdentity({ serverKey: data.serverKey, sessionId: data.sessionID })) {
    throw new Error('Invalid session identity')
  }
}

export const getSessionFiles = createServerFn({ method: 'GET' })
  .validator((data: { serverKey: string; sessionID: string; path: string }) => {
    identity(data)
    if (!validProjectPath(data.path)) throw new Error('Invalid file path')
    return data
  })
  .handler(({ data }) => listSessionFiles(data.serverKey, data.sessionID, data.path))

export const findSessionFiles = createServerFn({ method: 'GET' })
  .validator((data: { serverKey: string; sessionID: string; query: string }) => {
    identity(data)
    if (!data.query.trim() || data.query.length > 200) throw new Error('Invalid file search')
    return data
  })
  .handler(({ data }) => searchSessionFiles(data.serverKey, data.sessionID, data.query))

export const getSessionFile = createServerFn({ method: 'GET' })
  .validator((data: { serverKey: string; sessionID: string; path: string }) => {
    identity(data)
    if (!data.path || !validProjectPath(data.path)) throw new Error('Invalid file path')
    return data
  })
  .handler(({ data }) => readSessionFile(data.serverKey, data.sessionID, data.path))
