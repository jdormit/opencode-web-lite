export type FileEntry = { name: string; path: string; type: 'file' | 'directory'; ignored: boolean }
export type FileListResult = { entries: FileEntry[]; limited: boolean }
export type FilePreview = {
  path: string
  type: 'text' | 'binary'
  content: string
  limited: boolean
  mimeType?: string
}

export function validProjectPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2_000 || value.includes('\0')) return false
  if (value.startsWith('/') || value.startsWith('\\')) return false
  return !value.split(/[\\/]/).some((segment) => segment === '..')
}

export class FilePreviewCache {
  private entries = new Map<string, { value: FilePreview; bytes: number }>()
  private bytes = 0
  constructor(private maximumEntries = 40, private maximumBytes = 20 * 1024 * 1024) {}
  get(key: string) {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }
  set(key: string, value: FilePreview) {
    const previous = this.entries.get(key)
    if (previous) this.bytes -= previous.bytes
    this.entries.delete(key)
    const bytes = new TextEncoder().encode(value.content).byteLength
    this.entries.set(key, { value, bytes })
    this.bytes += bytes
    while (this.entries.size > this.maximumEntries || this.bytes > this.maximumBytes) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      const removed = this.entries.get(oldest)
      if (removed) this.bytes -= removed.bytes
      this.entries.delete(oldest)
    }
  }
  get size() { return this.entries.size }
  get retainedBytes() { return this.bytes }
}
