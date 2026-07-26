import { createServerFn } from '@tanstack/react-start'

import { loadComposerOptions } from '~/server/composer-options.server'

export const getComposerOptions = createServerFn({ method: 'GET' })
  .validator((data: unknown) => {
    if (typeof data !== 'object' || data === null || !('serverKey' in data) || typeof data.serverKey !== 'string' || !('directory' in data) || typeof data.directory !== 'string')
      throw new Error('Invalid project directory')
    return { serverKey: data.serverKey, directory: data.directory }
  })
  .handler(({ data }) => loadComposerOptions(data.serverKey, data.directory))
