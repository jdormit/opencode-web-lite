export type SessionTab = { type: 'session'; serverKey: string; sessionId: string; title: string; directory?: string | undefined; status?: string | undefined }
export type DraftTab = { type: 'draft'; serverKey: string; draftId: string; title: string; directory?: string | undefined; status?: string | undefined }
export type TopLevelTab = SessionTab | DraftTab
export type ClosedTab = { tab: SessionTab; index: number; closedAt: number }
export type TabState = { tabs: TopLevelTab[]; closed: ClosedTab[] }

export const MAX_TABS = 50
export const MAX_CLOSED_TABS = 25

export function tabKey(tab: TopLevelTab) { return tab.type === 'session' ? `session:${tab.serverKey}:${tab.sessionId}` : `draft:${tab.serverKey}:${tab.draftId}` }

export function normalizeTabs(value: unknown): TabState {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const tabs = Array.isArray(source.tabs) ? source.tabs.flatMap(parseTab).slice(-MAX_TABS) : []
  const keys = new Set<string>()
  const unique = tabs.filter((tab) => { const key = tabKey(tab); if (keys.has(key)) return false; keys.add(key); return true })
  const closed = Array.isArray(source.closed) ? source.closed.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const object = entry as Record<string, unknown>
    const tab = parseTab(object.tab)[0]
    if (!tab || tab.type !== 'session') return []
    return [{ tab, index: integer(object.index), closedAt: number(object.closedAt) }]
  }).slice(-MAX_CLOSED_TABS) : []
  return { tabs: unique, closed }
}

export function openTab(state: TabState, tab: TopLevelTab): TabState {
  const key = tabKey(tab)
  const existing = state.tabs.findIndex((item) => tabKey(item) === key)
  if (existing >= 0) {
    const tabs = [...state.tabs]; tabs[existing] = { ...tabs[existing], ...tab } as TopLevelTab
    return { ...state, tabs }
  }
  return { ...state, tabs: [...state.tabs, tab].slice(-MAX_TABS), closed: tab.type === 'session' ? state.closed.filter((item) => tabKey(item.tab) !== key) : state.closed }
}

export function closeTab(state: TabState, key: string, record = true): { state: TabState; next?: TopLevelTab } {
  const index = state.tabs.findIndex((tab) => tabKey(tab) === key)
  if (index < 0) return { state }
  const tab = state.tabs[index]!
  const tabs = state.tabs.filter((_, itemIndex) => itemIndex !== index)
  const closed = record && tab.type === 'session' ? [...state.closed, { tab, index, closedAt: Date.now() }].slice(-MAX_CLOSED_TABS) : state.closed
  const next = tabs[index] ?? tabs[index - 1]
  return { state: { tabs, closed }, ...(next ? { next } : {}) }
}

export function reorderTab(state: TabState, key: string, direction: -1 | 1): TabState {
  const index = state.tabs.findIndex((tab) => tabKey(tab) === key)
  const target = index + direction
  if (index < 0 || target < 0 || target >= state.tabs.length) return state
  const tabs = [...state.tabs]; const [tab] = tabs.splice(index, 1); tabs.splice(target, 0, tab!)
  return { ...state, tabs }
}

export function reopenTab(state: TabState): { state: TabState; tab?: SessionTab } {
  const closed = [...state.closed]
  while (closed.length) {
    const entry = closed.pop()!
    if (state.tabs.some((tab) => tabKey(tab) === tabKey(entry.tab))) continue
    const tabs = [...state.tabs]; tabs.splice(Math.min(entry.index, tabs.length), 0, entry.tab)
    return { state: { tabs: tabs.slice(-MAX_TABS), closed }, tab: entry.tab }
  }
  return { state: { ...state, closed } }
}

export function removeStaleTabs(state: TabState, validServers: Set<string>, removedSessions = new Set<string>()): TabState {
  const keep = (tab: TopLevelTab) => validServers.has(tab.serverKey) && (tab.type !== 'session' || !removedSessions.has(`${tab.serverKey}:${tab.sessionId}`))
  return { tabs: state.tabs.filter(keep), closed: state.closed.filter((entry) => keep(entry.tab)) }
}

function parseTab(value: unknown): TopLevelTab[] {
  if (!value || typeof value !== 'object') return []
  const tab = value as Record<string, unknown>
  const serverKey = string(tab.serverKey, 200); const title = string(tab.title, 500)
  if (!serverKey || !title) return []
  const common = { serverKey, title, directory: string(tab.directory, 2_000), status: string(tab.status, 100) }
  if (tab.type === 'session') { const sessionId = string(tab.sessionId, 500); return sessionId ? [{ type: 'session', sessionId, ...common }] : [] }
  if (tab.type === 'draft') { const draftId = string(tab.draftId, 500); return draftId ? [{ type: 'draft', draftId, ...common }] : [] }
  return []
}
function string(value: unknown, maximum: number) { return typeof value === 'string' && value ? value.slice(0, maximum) : undefined }
function integer(value: unknown) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0 }
function number(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : Date.now() }
