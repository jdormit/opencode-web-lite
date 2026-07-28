import { describe, expect, test } from 'bun:test'

import { dataUrlSourceBytes, MAX_ATTACHMENT_BYTES, supportedAttachmentMime, validateAttachmentFiles } from './composer-attachments'

describe('composer attachments', () => {
  test('accepts supported text by extension and rejects binary files', () => {
    expect(supportedAttachmentMime(new File(['hello'], 'notes.md'))).toBe('text/plain')
    expect(supportedAttachmentMime(new File(['data'], 'archive.zip'))).toBeUndefined()
  })

  test('rejects metadata over the per-file limit before reading', () => {
    const oversized = new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], 'large.pdf', { type: 'application/pdf' })
    const result = validateAttachmentFiles([], [oversized])
    expect(result.accepted).toEqual([])
    expect(result.errors[0]).toContain('10 MiB')
  })

  test('calculates source bytes from a data URL', () => {
    expect(dataUrlSourceBytes('data:text/plain;base64,aGVsbG8=')).toBe(5)
    expect(dataUrlSourceBytes('https://example.com/file')).toBeUndefined()
  })
})
