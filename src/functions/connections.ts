import { createServerFn } from '@tanstack/react-start'

import {
  getDefaultConnectionSnapshot,
} from '~/server/connections.server'

export const getConnectionSnapshot = createServerFn({ method: 'GET' }).handler(
  () => getDefaultConnectionSnapshot(),
)
