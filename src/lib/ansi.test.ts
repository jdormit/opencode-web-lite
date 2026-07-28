import { expect, test } from 'bun:test'
import { stripAnsi } from './ansi'

test('strips terminal control sequences and normalizes newlines', () => {
  expect(stripAnsi('\u001b[31mfailed\u001b[0m\r\nnext')).toBe('failed\nnext')
})
