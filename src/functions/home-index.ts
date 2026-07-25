import { createServerFn } from '@tanstack/react-start'

import { loadHomeIndex } from '~/server/home-index.server'

export const getHomeIndex = createServerFn({ method: 'GET' }).handler(() =>
  loadHomeIndex(),
)
