export type DiffLine = {
  key: string
  kind: 'context' | 'addition' | 'deletion' | 'header'
  text: string
  oldLine?: number | undefined
  newLine?: number | undefined
}

export function parseUnifiedDiff(patch: string, maximumLines = 20_000): { lines: DiffLine[]; limited: boolean } {
  const source = patch.split('\n')
  const lines: DiffLine[] = []
  let oldLine: number | undefined
  let newLine: number | undefined
  for (let index = 0; index < source.length && lines.length < maximumLines; index += 1) {
    const text = source[index] ?? ''
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text)
    if (hunk) {
      oldLine = Number(hunk[1]); newLine = Number(hunk[2])
      lines.push({ key: `${index}:h`, kind: 'header', text })
      continue
    }
    if (text.startsWith('+') && !text.startsWith('+++')) {
      lines.push({ key: `${index}:a`, kind: 'addition', text, newLine }); newLine = (newLine ?? 0) + 1
    } else if (text.startsWith('-') && !text.startsWith('---')) {
      lines.push({ key: `${index}:d`, kind: 'deletion', text, oldLine }); oldLine = (oldLine ?? 0) + 1
    } else if (oldLine !== undefined && newLine !== undefined && !text.startsWith('\\')) {
      lines.push({ key: `${index}:c`, kind: 'context', text, oldLine, newLine }); oldLine += 1; newLine += 1
    } else lines.push({ key: `${index}:h`, kind: 'header', text })
  }
  return { lines, limited: source.length > maximumLines }
}

export function incrementalDiffWindow(patch: string, start: number, size = 500) {
  const parsed = parseUnifiedDiff(patch)
  return { lines: parsed.lines.slice(start, start + size), total: parsed.lines.length, limited: parsed.limited }
}
