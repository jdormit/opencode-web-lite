import { describe, expect, test } from 'bun:test'

import { safeExternalUrl, validateCustomProvider } from './provider-settings'

describe('provider settings validation', () => {
  test('normalizes a compatible provider without exposing key in config fields', () => {
    const value = validateCustomProvider({
      providerID: 'local-ai', name: 'Local AI', baseURL: 'https://ai.example/v1/', apiKey: 'secret',
      models: [{ id: 'model', name: 'Model' }], headers: [{ name: 'X-Tenant', value: 'one' }],
    })
    expect(value.baseURL).toBe('https://ai.example/v1')
    expect(value.apiKey).toBe('secret')
  })

  test('rejects unsafe OAuth and provider URLs', () => {
    expect(() => safeExternalUrl('javascript:alert(1)')).toThrow('unsafe')
    expect(() => validateCustomProvider({ providerID: 'x', name: 'X', baseURL: 'file:///tmp', models: [{ id: 'm', name: 'M' }], headers: [] })).toThrow('HTTP')
  })
})
