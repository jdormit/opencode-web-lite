export type ProjectState = {
  version: 1
  order: Record<string, string[]>
  last: Record<string, string>
  closed: Record<string, string[]>
}

const emptyState = (): ProjectState => ({ version: 1, order: {}, last: {}, closed: {} })

export function readProjectState(storage: Pick<Storage, 'getItem'>): ProjectState {
  try {
    const value = JSON.parse(storage.getItem('opencode-web-lite:projects:v1') ?? 'null') as unknown
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1) return emptyState()
    const state = value as ProjectState
    return { version: 1, order: cleanRecord(state.order), last: cleanStrings(state.last), closed: cleanRecord(state.closed) }
  } catch { return emptyState() }
}

export function writeProjectState(storage: Pick<Storage, 'setItem'>, state: ProjectState) {
  storage.setItem('opencode-web-lite:projects:v1', JSON.stringify(state))
}

export function orderProjects<T extends { directory: string }>(projects: T[], serverKey: string, state: ProjectState) {
  const positions = new Map((state.order[serverKey] ?? []).map((directory, index) => [directory, index]))
  return projects.filter((project) => !(state.closed[serverKey] ?? []).includes(project.directory)).sort((a, b) =>
    (positions.get(a.directory) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.directory) ?? Number.MAX_SAFE_INTEGER))
}

function cleanRecord(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => Array.isArray(item) ? [[key, item.filter((entry): entry is string => typeof entry === 'string').slice(0, 128)]] : []))
}

function cleanStrings(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}
