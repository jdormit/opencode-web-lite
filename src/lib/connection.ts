export type PublicServerConnection = {
  key: string
  label: string
  url: string
}

export type ConnectionSnapshot = {
  server: PublicServerConnection
  state:
    | 'connected'
    | 'authentication-failed'
    | 'incompatible'
    | 'invalid-configuration'
    | 'unavailable'
  version?: string
}
