import type { Config, LspStatus, McpStatus, Session, SnapshotFileDiff } from '@opencode-ai/sdk/v2/client'

import type { SessionChange } from '~/lib/session-snapshot'
import type { WorkspaceStatus } from '~/lib/workspace-status'
import { createSdkForConnection, resolveConnection, type ServerConnection } from './connections.server'
import { safeExternalUrl } from '~/lib/provider-settings'

type WorkspaceClient = {
  session: { get(parameters: { sessionID: string }, options?: { signal?: AbortSignal }): Promise<{ data: Session | undefined }> }
  vcs?: { diff(parameters: { directory: string; mode: 'git' | 'branch'; context?: number }, options?: { signal?: AbortSignal }): Promise<{ data: SnapshotFileDiff[] | undefined }> }
  mcp?: {
    status(parameters: { directory: string }, options?: { signal?: AbortSignal }): Promise<{ data: Record<string, McpStatus> | undefined }>
    connect(parameters: { name: string; directory: string }, options?: { signal?: AbortSignal }): Promise<{ data: boolean | undefined }>
    disconnect(parameters: { name: string; directory: string }, options?: { signal?: AbortSignal }): Promise<{ data: boolean | undefined }>
    auth: {
      start(parameters: { name: string; directory: string }, options?: { signal?: AbortSignal }): Promise<{ data: { authorizationUrl: string; oauthState: string } | undefined }>
      callback(parameters: { name: string; directory: string; code: string }, options?: { signal?: AbortSignal }): Promise<{ data: McpStatus | undefined }>
    }
  }
  lsp?: { status(parameters: { directory: string }, options?: { signal?: AbortSignal }): Promise<{ data: LspStatus[] | undefined }> }
  config?: { get(parameters: { directory: string }, options?: { signal?: AbortSignal }): Promise<{ data: Config | undefined }> }
}

export async function loadWorkspaceStatus(serverKey: string, sessionID: string, connection: ServerConnection = resolveConnection(serverKey), client: WorkspaceClient = createSdkForConnection(connection, { throwOnError: false })): Promise<WorkspaceStatus> {
  const { directory, signal } = await scope(serverKey, sessionID, connection, client)
  const [mcp, lsp, config] = await Promise.all([
    client.mcp?.status({ directory }, { signal }).catch(() => undefined),
    client.lsp?.status({ directory }, { signal }).catch(() => undefined),
    client.config?.get({ directory }, { signal }).catch(() => undefined),
  ])
  const mcpEntries = Object.entries(mcp?.data ?? {}).slice(0, 100).map(([name, value]) => ({
    name: name.slice(0, 300), status: value.status,
    ...('error' in value && value.error ? { error: value.error.slice(0, 4_000) } : {}),
  }))
  const plugins = (config?.data?.plugin ?? []).slice(0, 100).flatMap((value) => {
    const name = typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined
    return typeof name === 'string' ? [name.slice(0, 500)] : []
  })
  return {
    mcp: mcpEntries,
    lsp: (lsp?.data ?? []).slice(0, 100).map((item) => ({ id: item.id.slice(0, 300), name: item.name.slice(0, 300), root: item.root.slice(0, 2_000), status: item.status })),
    plugins,
    ...(!client.mcp || !mcp?.data ? { mcpError: 'MCP status is unavailable.' } : {}),
    ...(!client.lsp || !lsp?.data ? { lspError: 'LSP status is unavailable.' } : {}),
    ...(!client.config || !config?.data ? { pluginError: 'Plugin status is unavailable.' } : {}),
  }
}

export async function controlMcp(serverKey: string, sessionID: string, name: string, action: 'connect' | 'disconnect' | 'authenticate' | 'auth-callback', connection: ServerConnection = resolveConnection(serverKey), client: WorkspaceClient = createSdkForConnection(connection, { throwOnError: false }), code?: string) {
  if (!name || name.length > 300) throw new Error('Invalid MCP server')
  const { directory, signal } = await scope(serverKey, sessionID, connection, client)
  if (!client.mcp) throw new Error('MCP controls are unavailable')
  if (action === 'authenticate') {
    const result = await client.mcp.auth.start({ name, directory }, { signal })
    if (!result.data) throw new Error('MCP authenticate failed')
    const authorizationUrl = safeExternalUrl(result.data.authorizationUrl)
    if (!authorizationUrl) throw new Error('MCP authorization URL is invalid')
    return { ok: true, authorizationUrl }
  }
  const result = action === 'connect' ? await client.mcp.connect({ name, directory }, { signal })
    : action === 'disconnect' ? await client.mcp.disconnect({ name, directory }, { signal })
    : await client.mcp.auth.callback({ name, directory, code: code ?? '' }, { signal })
  if (result.data === undefined) throw new Error(`MCP ${action} failed`)
  return { ok: true }
}

export async function loadWorkspaceDiff(serverKey: string, sessionID: string, mode: 'working' | 'branch', connection: ServerConnection = resolveConnection(serverKey), client: WorkspaceClient = createSdkForConnection(connection, { throwOnError: false }), file?: string) {
  const { directory, signal } = await scope(serverKey, sessionID, connection, client)
  if (!client.vcs) throw new Error('Version-control diffs are unavailable')
  const result = await client.vcs.diff({ directory, mode: mode === 'working' ? 'git' : 'branch', context: 3 }, { signal })
  if (!result.data) throw new Error('Changes could not be loaded')
  const source = file ? result.data.filter((diff) => diff.file === file).slice(0, 1) : result.data.filter((diff) => Boolean(diff.file)).slice(0, 200)
  const changes: SessionChange[] = source.map((diff, index) => ({
    file: diff.file!.slice(0, 2_000), status: diff.status ?? 'modified', additions: finite(diff.additions), deletions: finite(diff.deletions),
    ...(diff.patch ? { patch: diff.patch.slice(0, file ? 1024 * 1024 : 256 * 1024) } : {}), patchLimited: (diff.patch?.length ?? 0) > (file ? 1024 * 1024 : 256 * 1024),
    patchOmitted: !file && Boolean(diff.patch) && index >= 40,
  })).map((item, index) => index < 40 ? item : (({ patch: _patch, ...rest }) => ({ ...rest, patchOmitted: true }))(item))
  return { changes, limited: result.data.length > 200, total: result.data.length, additions: changes.reduce((sum, item) => sum + item.additions, 0), deletions: changes.reduce((sum, item) => sum + item.deletions, 0) }
}

async function scope(serverKey: string, sessionID: string, connection: ServerConnection, client: WorkspaceClient) {
  if (serverKey !== connection.key) throw new Error('Unknown server')
  const signal = AbortSignal.timeout(3_000)
  const result = await client.session.get({ sessionID }, { signal })
  if (!result.data) throw new Error('Session could not be loaded')
  return { directory: result.data.directory, signal }
}
function finite(value: number | undefined) { return Number.isFinite(value) ? value ?? 0 : 0 }
