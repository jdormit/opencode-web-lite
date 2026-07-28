import { closeTab, normalizeTabs, openTab, reopenTab, reorderTab, tabKey, type TabState, type TopLevelTab } from './tabs'
import { writePersistentValue } from './persistence'

const storageKey = 'opencode-web-lite:tabs:v1'
let state: TabState = { tabs: [], closed: [] }
let loaded = false
const listeners = new Set<() => void>()

function load() {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  try { state = normalizeTabs(JSON.parse(localStorage.getItem(storageKey) ?? '{}')) } catch {}
}
function write(next: TabState) { state = next; writePersistentValue(localStorage, storageKey, JSON.stringify(state), 'session-ui'); for (const listener of listeners) listener() }
export const tabStore = {
  subscribe(listener: () => void) { load(); listeners.add(listener); return () => listeners.delete(listener) },
  getSnapshot() { load(); return state },
  getServerSnapshot() { return { tabs: [], closed: [] } as TabState },
  open(tab: TopLevelTab) { load(); write(openTab(state, tab)) },
  close(key: string) { load(); const result = closeTab(state, key); write(result.state); return result.next },
  removeSession(serverKey: string, sessionId: string) {
    load(); const result = closeTab(state, `session:${serverKey}:${sessionId}`, false); write(result.state); return result.next
  },
  reorder(key: string, direction: -1 | 1) { load(); write(reorderTab(state, key, direction)) },
  reopen() { load(); const result = reopenTab(state); write(result.state); return result.tab },
  promoteDraft(draftId: string, tab: Extract<TopLevelTab, { type: 'session' }>) {
    load(); const index = state.tabs.findIndex((item) => item.type === 'draft' && item.draftId === draftId)
    const tabs = [...state.tabs]; if (index >= 0) tabs[index] = tab; else tabs.push(tab); write(normalizeTabs({ ...state, tabs }))
  },
  key: tabKey,
}
