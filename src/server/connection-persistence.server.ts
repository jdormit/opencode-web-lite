import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export type StoredConnection = {
  key: string
  label: string
  url: string
  username?: string
  password?: string
}

export type StoredConnectionRegistry = {
  version: 1
  defaultKey: string
  connections: StoredConnection[]
}

export type ConnectionStoreReadResult =
  | { status: 'missing' }
  | { status: 'unreadable' }
  | { status: 'valid'; store: StoredConnectionRegistry }

type LegacyEncryptedEnvelope = {
  version: 1
  algorithm: 'aes-256-gcm'
  iv: string
  tag: string
  ciphertext: string
}

type EncryptedEnvelope = {
  version: 2
  algorithm: 'aes-256-gcm'
  kdf: 'scrypt'
  salt: string
  iv: string
  tag: string
  ciphertext: string
}

export function connectionStorePath(env: Record<string, string | undefined> = process.env) {
  return env.OPENCODE_WEB_CONNECTIONS_FILE ?? join(homedir(), '.local', 'state', 'opencode-web-lite', 'connections.json')
}

export function readConnectionStore(
  encryptionKey: string | undefined,
  path: string,
): ConnectionStoreReadResult {
  if (!existsSync(path)) return { status: 'missing' }
  if (!encryptionKey) return { status: 'unreadable' }
  try {
    const envelope = JSON.parse(readFileSync(path, 'utf8')) as EncryptedEnvelope | LegacyEncryptedEnvelope
    if (envelope.algorithm !== 'aes-256-gcm') return { status: 'unreadable' }
    const key = envelope.version === 2 && envelope.kdf === 'scrypt'
      ? deriveKey(encryptionKey, Buffer.from(envelope.salt, 'base64'))
      : envelope.version === 1 ? deriveLegacyKey(encryptionKey) : undefined
    if (!key) return { status: 'unreadable' }
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8')
    const store = parseStore(JSON.parse(plaintext))
    return store ? { status: 'valid', store } : { status: 'unreadable' }
  } catch {
    return { status: 'unreadable' }
  }
}

export function writeConnectionStore(
  store: StoredConnectionRegistry,
  encryptionKey: string | undefined,
  path: string,
) {
  if (!encryptionKey) return
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(encryptionKey, salt), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(store)), cipher.final()])
  const envelope: EncryptedEnvelope = {
    version: 2,
    algorithm: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(envelope), { mode: 0o600 })
  renameSync(temporary, path)
}

function deriveKey(value: string, salt: Buffer) {
  return scryptSync(value, salt, 32)
}

function deriveLegacyKey(value: string) {
  return createHash('sha256').update(value).digest()
}

function parseStore(value: unknown): StoredConnectionRegistry | undefined {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1) return undefined
  if (!('defaultKey' in value) || typeof value.defaultKey !== 'string') return undefined
  if (!('connections' in value) || !Array.isArray(value.connections)) return undefined
  const connections = value.connections.flatMap((item): StoredConnection[] => {
    if (!item || typeof item !== 'object') return []
    if (!('key' in item) || typeof item.key !== 'string' || !/^server_[A-Za-z0-9_-]{1,64}$/.test(item.key)) return []
    if (!('label' in item) || typeof item.label !== 'string') return []
    if (!('url' in item) || typeof item.url !== 'string') return []
    const username = 'username' in item && typeof item.username === 'string' ? item.username : undefined
    const password = 'password' in item && typeof item.password === 'string' ? item.password : undefined
    let url: URL
    try { url = new URL(item.url) } catch { return [] }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== item.url || url.username || url.password) return []
    if (password !== undefined && url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return []
    return [{ key: item.key, label: item.label, url: item.url, ...(username !== undefined ? { username } : {}), ...(password !== undefined ? { password } : {}) }]
  })
  if (new Set(connections.map((connection) => connection.key)).size !== connections.length) return undefined
  if (new Set(connections.map((connection) => connection.url)).size !== connections.length) return undefined
  if (!connections.some((connection) => connection.key === value.defaultKey)) return undefined
  return { version: 1, defaultKey: value.defaultKey, connections }
}
