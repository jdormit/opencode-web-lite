export const queryKeys = {
  server: (serverKey: string) => ['server', serverKey] as const,
  projects: (serverKey: string) => ['server', serverKey, 'projects'] as const,
  directory: (serverKey: string, directory: string) =>
    ['server', serverKey, 'directory', directory] as const,
  sessions: (serverKey: string, directory: string) =>
    ['server', serverKey, 'directory', directory, 'sessions'] as const,
  session: (serverKey: string, directory: string, sessionId: string) =>
    ['server', serverKey, 'directory', directory, 'session', sessionId] as const,
  requests: (serverKey: string, directory: string) =>
    ['server', serverKey, 'directory', directory, 'requests'] as const,
  todos: (serverKey: string, directory: string, sessionId: string) =>
    ['server', serverKey, 'directory', directory, 'session', sessionId, 'todos'] as const,
  diffs: (serverKey: string, directory: string, sessionId: string) =>
    ['server', serverKey, 'directory', directory, 'session', sessionId, 'diffs'] as const,
}
