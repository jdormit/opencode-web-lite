import { createServerFn } from '@tanstack/react-start'

import { createSession } from '~/server/session-create.server'

export const createSessionMutation = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    if (
      typeof data !== 'object' ||
      data === null ||
      !('directory' in data) ||
      typeof data.directory !== 'string' ||
      !('title' in data) ||
      typeof data.title !== 'string'
    ) {
      throw new Error('Invalid session input')
    }
    return { directory: data.directory, title: data.title }
  })
  .handler(({ data }) => createSession(data))
