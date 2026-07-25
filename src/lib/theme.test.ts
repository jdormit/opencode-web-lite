import { describe, expect, test } from 'bun:test'

import { parseThemeCookie } from './theme'

describe('parseThemeCookie', () => {
  test('defaults to the system preference', () => {
    expect(parseThemeCookie(null)).toBe('system')
    expect(parseThemeCookie('session=abc')).toBe('system')
  })

  test('reads supported values among other cookies', () => {
    expect(parseThemeCookie('session=abc; color-scheme=dark; mode=compact')).toBe(
      'dark',
    )
    expect(parseThemeCookie('color-scheme=light')).toBe('light')
  })

  test('rejects arbitrary values', () => {
    expect(parseThemeCookie('color-scheme=midnight')).toBe('system')
    expect(parseThemeCookie('color-scheme=%')).toBe('system')
  })
})
