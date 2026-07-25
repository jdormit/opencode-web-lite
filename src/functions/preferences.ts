import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'

import { parseThemeCookie } from '~/lib/theme'

export const getThemePreference = createServerFn({ method: 'GET' }).handler(
  () => parseThemeCookie(getRequestHeader('cookie')),
)
