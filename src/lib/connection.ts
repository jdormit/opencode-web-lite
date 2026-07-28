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

export type ConnectionRegistrySnapshot = {
  defaultKey: string
  servers: ConnectionSnapshot[]
  persistent: boolean
}

export type ConnectionInput = {
  key?: string
  label: string
  url: string
  username?: string
  password?: string
  clearCredentials?: boolean
}
