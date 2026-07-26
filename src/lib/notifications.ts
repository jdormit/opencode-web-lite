import type { NormalizedGlobalEvent } from './live-store'
import { BoundedLru } from './bounded-lru'

export type NotificationKind = 'completion' | 'request' | 'error'
export type SessionNotification = {
  id: string
  sessionID: string
  directory: string
  kind: NotificationKind
  createdAt: number
  viewed: boolean
}
export type NotificationPreferences = Record<NotificationKind, boolean> & {
  sounds: Record<NotificationKind, boolean>
}

const defaults: NotificationPreferences = {
  completion: false,
  request: false,
  error: false,
  sounds: { completion: false, request: false, error: false },
}
const maximumEntries = 100
const maximumAge = 7 * 24 * 60 * 60_000

export class NotificationStore {
  private entries: SessionNotification[] = []
  private preferences: NotificationPreferences = defaults
  private readonly listeners = new Set<() => void>()
  private snapshot = { entries: this.entries, unseen: 0, preferences: this.preferences }

  constructor(readonly serverKey: string, private readonly now = Date.now) {
    this.restore()
  }

  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  apply(events: NormalizedGlobalEvent[]) {
    let changed = false
    for (const event of events) {
      const sessionID = eventSessionID(event)
      if (!sessionID) continue
      if (isIdle(event)) {
        if (event.properties.notificationRoot !== true) continue
        changed = this.add(event, sessionID, 'completion') || changed
        continue
      }
      if (event.type === 'session.error') changed = this.add(event, sessionID, 'error') || changed
      if (event.type === 'permission.asked' || event.type === 'question.asked') {
        changed = this.add(event, sessionID, 'request') || changed
      }
      if (event.type === 'permission.replied' || event.type === 'question.replied' || event.type === 'question.rejected') {
        changed = this.resolveRequests(sessionID) || changed
      }
    }
    if (changed) this.commit()
  }

  markViewed(sessionID: string) {
    let changed = false
    this.entries = this.entries.map((entry) => {
      if (entry.sessionID !== sessionID || entry.viewed) return entry
      changed = true
      return { ...entry, viewed: true }
    })
    if (changed) this.commit()
  }

  clear() {
    if (!this.entries.length) return
    this.entries = []
    this.commit()
  }

  clearDirectory(directory: string) {
    const next = this.entries.filter((entry) => entry.directory !== directory)
    if (next.length === this.entries.length) return
    this.entries = next
    this.commit()
  }

  pruneExpired() {
    const next = prune(this.entries, this.now())
    if (next.length === this.entries.length) return
    this.entries = next
    this.commit()
  }

  setPreference(kind: NotificationKind, enabled: boolean, sound = false) {
    this.preferences = sound
      ? { ...this.preferences, sounds: { ...this.preferences.sounds, [kind]: enabled } }
      : { ...this.preferences, [kind]: enabled }
    this.persistPreferences()
    this.publish()
  }

  private add(event: NormalizedGlobalEvent, sessionID: string, kind: NotificationKind) {
    const token = kind === 'completion' && typeof event.properties.notificationToken === 'string'
      ? event.properties.notificationToken
      : event.id
    const id = `${kind}:${token}`
    if (this.entries.some((entry) => entry.id === id)) return false
    const createdAt = this.now()
    const deliver = kind === 'completion' || !this.entries.some((entry) =>
      entry.sessionID === sessionID && entry.kind === kind && createdAt - entry.createdAt < 30_000)
    this.entries = [...this.entries, {
      id,
      sessionID,
      directory: event.directory,
      kind,
      createdAt,
      viewed: event.properties.notificationViewed === true,
    }]
    this.entries = prune(this.entries, createdAt)
    if (deliver) this.deliver(kind, sessionID)
    return true
  }

  private resolveRequests(sessionID: string) {
    const next = this.entries.filter((entry) => entry.sessionID !== sessionID || entry.kind !== 'request')
    if (next.length === this.entries.length) return false
    this.entries = next
    return true
  }

  private deliver(kind: NotificationKind, sessionID: string) {
    if (this.preferences[kind] && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        const notification = new Notification(notificationTitle(kind), { body: `Session ${sessionID}` })
        notification.onclick = () => {
          window.focus()
          window.location.assign(`/server/${encodeURIComponent(this.serverKey)}/session/${encodeURIComponent(sessionID)}`)
          notification.close()
        }
      } catch {}
    }
    if (this.preferences.sounds[kind]) playNotificationSound(kind)
  }

  private restore() {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(entriesKey(this.serverKey)) ?? '[]')
      this.entries = prune(Array.isArray(stored) ? stored.filter(validEntry) : [], this.now())
      const preferences: unknown = JSON.parse(localStorage.getItem(preferencesKey(this.serverKey)) ?? 'null')
      if (validPreferences(preferences)) this.preferences = preferences
    } catch {
      this.entries = []
    }
    this.publish()
  }

  private commit() {
    try { localStorage.setItem(entriesKey(this.serverKey), JSON.stringify(this.entries)) } catch {}
    this.publish()
  }

  private persistPreferences() {
    try { localStorage.setItem(preferencesKey(this.serverKey), JSON.stringify(this.preferences)) } catch {}
  }

  private publish() {
    this.snapshot = {
      entries: this.entries,
      unseen: this.entries.filter((entry) => !entry.viewed).length,
      preferences: this.preferences,
    }
    for (const listener of this.listeners) listener()
  }
}

function prune(entries: SessionNotification[], now: number) {
  return entries.filter((entry) => now - entry.createdAt <= maximumAge).slice(-maximumEntries)
}
function eventSessionID(event: NormalizedGlobalEvent) {
  if (validSessionID(event.properties.sessionID)) return event.properties.sessionID
  const info = objectProperty(event.properties, 'info')
  return validSessionID(info?.id) ? info.id : undefined
}
function validSessionID(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value)
}
function objectProperty(value: Record<string, unknown>, key: string) {
  const item = value[key]
  return item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : undefined
}
function isIdle(event: NormalizedGlobalEvent) {
  const status = objectProperty(event.properties, 'status')
  return event.type === 'session.idle' || (event.type === 'session.status' && status?.type === 'idle')
}
function validEntry(value: unknown): value is SessionNotification {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return typeof entry.id === 'string' && entry.id.length <= 512 && typeof entry.sessionID === 'string' &&
    entry.sessionID.length <= 500 && typeof entry.directory === 'string' && entry.directory.length <= 4_096 &&
    (entry.kind === 'completion' || entry.kind === 'request' || entry.kind === 'error') &&
    typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt) && typeof entry.viewed === 'boolean'
}
function validPreferences(value: unknown): value is NotificationPreferences {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  const sounds = objectProperty(item, 'sounds')
  return ['completion', 'request', 'error'].every((key) => typeof item[key] === 'boolean' && typeof sounds?.[key] === 'boolean')
}
function notificationTitle(kind: NotificationKind) {
  if (kind === 'completion') return 'Response ready'
  if (kind === 'request') return 'Session needs attention'
  return 'Session error'
}
function entriesKey(serverKey: string) { return `opencode-web-lite:notifications:v1:${serverKey}` }
function preferencesKey(serverKey: string) { return `opencode-web-lite:notification-preferences:v1:${serverKey}` }

const stores = new BoundedLru<string, NotificationStore>(20, 20 * 60_000)
export function getNotificationStore(serverKey: string) {
  let store = stores.get(serverKey)
  if (!store) { store = new NotificationStore(serverKey); stores.set(serverKey, store) }
  return store
}

let audioContext: AudioContext | undefined
export function playNotificationSound(kind: NotificationKind) {
  try {
    const context = audioContext ??= new AudioContext()
    void context.resume()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.frequency.value = kind === 'error' ? 220 : kind === 'request' ? 520 : 740
    gain.gain.setValueAtTime(0.05, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.15)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.15)
  } catch {}
}
