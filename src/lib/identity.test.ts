import { describe, expect, test } from 'bun:test'

import { parseDirectory, parseRouteIdentity } from './identity'

describe('route identity', () => {
  test('accepts canonical non-secret identifiers', () => {
    expect(parseRouteIdentity({ serverKey: 'server_abc-123', sessionId: 'ses_1' })).toEqual({
      serverKey: 'server_abc-123',
      sessionId: 'ses_1',
    })
  })

  test('rejects malformed and oversized identifiers', () => {
    expect(parseRouteIdentity({ serverKey: '../server', sessionId: 'ses_1' })).toBeUndefined()
    expect(parseRouteIdentity({ serverKey: 'server_1', sessionId: 'x'.repeat(129) })).toBeUndefined()
    expect(parseRouteIdentity({ serverKey: 'server_1' })).toBeUndefined()
  })

  test('bounds directory scope', () => {
    expect(parseDirectory('/work/alpha')).toBe('/work/alpha')
    expect(parseDirectory('')).toBeUndefined()
    expect(parseDirectory('x'.repeat(2_001))).toBeUndefined()
  })
})
