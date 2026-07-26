export class BoundedLru<K, V> {
  private readonly values = new Map<K, { value: V; touchedAt: number; pinned: boolean }>()

  constructor(
    private readonly maximumEntries: number,
    private readonly maximumIdleMs: number,
    private readonly now: () => number = Date.now,
    private readonly onEvict?: (key: K, value: V) => void,
  ) {
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1) throw new Error('Invalid LRU size')
    if (!Number.isSafeInteger(maximumIdleMs) || maximumIdleMs < 0) throw new Error('Invalid idle limit')
  }

  get size() {
    return this.values.size
  }

  get(key: K): V | undefined {
    const entry = this.values.get(key)
    if (!entry) return undefined
    if (!entry.pinned && entry.touchedAt < this.now() - this.maximumIdleMs) {
      this.values.delete(key)
      this.onEvict?.(key, entry.value)
      return undefined
    }
    entry.touchedAt = this.now()
    return entry.value
  }

  set(key: K, value: V, pinned = false) {
    this.values.delete(key)
    this.values.set(key, { value, touchedAt: this.now(), pinned })
    this.evict()
  }

  pin(key: K, pinned = true) {
    const entry = this.values.get(key)
    if (entry) {
      entry.pinned = pinned
      entry.touchedAt = this.now()
      if (!pinned) this.evict()
    }
  }

  delete(key: K) {
    const entry = this.values.get(key)
    const deleted = this.values.delete(key)
    if (deleted && entry) this.onEvict?.(key, entry.value)
    return deleted
  }

  entries() {
    this.evict()
    return [...this.values.entries()].map(([key, entry]) => [key, entry.value] as const)
  }

  evict() {
    const cutoff = this.now() - this.maximumIdleMs
    for (const [key, entry] of this.values) {
      if (!entry.pinned && entry.touchedAt < cutoff) this.remove(key, entry)
    }
    if (this.values.size <= this.maximumEntries) return
    const candidates = [...this.values.entries()]
      .filter(([, entry]) => !entry.pinned)
      .sort((a, b) => a[1].touchedAt - b[1].touchedAt)
    while (this.values.size > this.maximumEntries && candidates.length) {
      const candidate = candidates.shift()
      if (candidate) this.remove(candidate[0], candidate[1])
    }
  }

  private remove(key: K, entry: { value: V; touchedAt: number; pinned: boolean }) {
    if (!this.values.delete(key)) return
    this.onEvict?.(key, entry.value)
  }
}
