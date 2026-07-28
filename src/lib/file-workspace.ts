import { writePersistentValue } from './persistence'

export type FileTabState = { path: string; pinned: boolean; scrollTop: number; selection?: { start: number; end: number } | undefined }
export type FileWorkspaceState = { tabs: FileTabState[]; active?: string | undefined; preview?: string | undefined; expanded: string[]; query: string }

export function openFileTab(state: FileWorkspaceState, path: string, pinned = false): FileWorkspaceState {
  const existing = state.tabs.find((tab) => tab.path === path)
  if (existing) return { ...state, active: path, preview: existing.pinned ? state.preview : path, tabs: state.tabs.map((tab) => tab.path === path && pinned ? { ...tab, pinned: true } : tab) }
  const tabs = state.tabs.filter((tab) => tab.pinned)
  return { ...state, tabs: [...tabs, { path, pinned, scrollTop: 0 }].slice(-20), active: path, preview: pinned ? state.preview : path }
}
export function pinFileTab(state: FileWorkspaceState, path: string): FileWorkspaceState { return { ...state, preview: state.preview === path ? undefined : state.preview, tabs: state.tabs.map((tab) => tab.path === path ? { ...tab, pinned: true } : tab) } }
export function closeFileTab(state: FileWorkspaceState, path: string): FileWorkspaceState {
  const index = state.tabs.findIndex((tab) => tab.path === path); const tabs = state.tabs.filter((tab) => tab.path !== path)
  return { ...state, tabs, active: state.active === path ? tabs[index]?.path ?? tabs[index - 1]?.path : state.active, preview: state.preview === path ? undefined : state.preview }
}
export function reorderFileTab(state: FileWorkspaceState, path: string, direction: -1 | 1): FileWorkspaceState {
  const index = state.tabs.findIndex((tab) => tab.path === path); const target = index + direction
  if (index < 0 || target < 0 || target >= state.tabs.length) return state
  const tabs = [...state.tabs]; const [tab] = tabs.splice(index, 1); tabs.splice(target, 0, tab!); return { ...state, tabs }
}

const stores = new Map<string, FileWorkspaceStore>()
export class FileWorkspaceStore {
  private state: FileWorkspaceState = { tabs: [], expanded: [], query: '' }
  private loaded = false
  private listeners = new Set<() => void>()
  constructor(private key: string) {}
  private load() { if (this.loaded || typeof window === 'undefined') return; this.loaded = true; try { const value = JSON.parse(localStorage.getItem(this.key) ?? '{}'); if (value && typeof value === 'object') this.state = { ...this.state, ...value, tabs: Array.isArray(value.tabs) ? value.tabs.slice(0, 20) : [] } } catch {} }
  getSnapshot = () => { this.load(); return this.state }
  getServerSnapshot = () => ({ tabs: [], expanded: [], query: '' }) as FileWorkspaceState
  subscribe = (listener: () => void) => { this.load(); this.listeners.add(listener); return () => this.listeners.delete(listener) }
  update(next: FileWorkspaceState) { this.state = next; writePersistentValue(localStorage, this.key, JSON.stringify(next), 'session-ui'); for (const listener of this.listeners) listener() }
}
export function getFileWorkspace(serverKey: string, directory: string) {
  const id = `${serverKey}:${directory}`; const existing = stores.get(id); if (existing) return existing
  const store = new FileWorkspaceStore(`opencode-web-lite:file-workspace:v1:${id}`); stores.set(id, store); return store
}
