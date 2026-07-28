import { describe, expect, test } from 'bun:test'

import { assertSameOriginRequest } from './request-security.server'

describe('assertSameOriginRequest', () => {
  test('accepts same-origin Origin and Referer headers', () => {
    expect(() => assertSameOriginRequest(new Request('https://app.example/action', {
      headers: { Origin: 'https://app.example' },
    }))).not.toThrow()
    expect(() => assertSameOriginRequest(new Request('https://app.example/action', {
      headers: { Referer: 'https://app.example/settings' },
    }))).not.toThrow()
  })

  test('rejects cross-origin and unverifiable requests', () => {
    expect(() => assertSameOriginRequest(new Request('https://app.example/action', {
      headers: { Origin: 'https://attacker.example' },
    }))).toThrow('Cross-origin request rejected')
    expect(() => assertSameOriginRequest(new Request('https://app.example/action')))
      .toThrow('Cross-origin request rejected')
  })
})
