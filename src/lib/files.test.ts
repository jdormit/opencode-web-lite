import { describe, expect, test } from 'bun:test'
import { FilePreviewCache, validProjectPath } from './files'

describe('validProjectPath', () => {
  test('accepts bounded project-relative paths', () => {
    expect(validProjectPath('')).toBe(true)
    expect(validProjectPath('src/app.tsx')).toBe(true)
  })
  test('rejects traversal, absolute, null, and oversized paths', () => {
    expect(validProjectPath('../secret')).toBe(false)
    expect(validProjectPath('src/../secret')).toBe(false)
    expect(validProjectPath('/etc/passwd')).toBe(false)
    expect(validProjectPath('bad\0path')).toBe(false)
    expect(validProjectPath('x'.repeat(2_001))).toBe(false)
  })
})

describe('FilePreviewCache', () => {
  test('evicts by encoded bytes as well as entry count', () => {
    const cache = new FilePreviewCache(40, 8)
    cache.set('a', { path: 'a', type: 'text', content: '1234', limited: false })
    cache.set('b', { path: 'b', type: 'text', content: '🙂🙂', limited: false })
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')?.path).toBe('b')
    expect(cache.retainedBytes).toBeLessThanOrEqual(8)
  })
})
