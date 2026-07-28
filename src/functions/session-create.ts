import { createServerFn } from '@tanstack/react-start'

import { createSession } from '~/server/session-create.server'
import { assertSameOriginRequest } from '~/server/request-security.server'

export const createSessionMutation = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    if (
      typeof data !== 'object' ||
      data === null ||
      !('serverKey' in data) || typeof data.serverKey !== 'string' ||
      !('directory' in data) ||
      typeof data.directory !== 'string' ||
      !('title' in data) || typeof data.title !== 'string' ||
      !('agent' in data) || typeof data.agent !== 'string' ||
      !('providerID' in data) || typeof data.providerID !== 'string' ||
      !('modelID' in data) || typeof data.modelID !== 'string' ||
      !('variant' in data) || typeof data.variant !== 'string'
    ) {
      throw new Error('Invalid session input')
    }
    return {
      serverKey: data.serverKey,
      directory: data.directory,
      title: data.title,
      agent: data.agent,
      providerID: data.providerID,
      modelID: data.modelID,
      variant: data.variant,
    }
  })
  .handler(({ data }) => { assertSameOriginRequest(); return createSession(data) })
