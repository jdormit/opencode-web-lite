import { createServerFn } from '@tanstack/react-start'

import { parseRouteIdentity } from '~/lib/identity'
import { controlMcp, loadWorkspaceDiff, loadWorkspaceStatus } from '~/server/workspace.server'
import { assertSameOriginRequest } from '~/server/request-security.server'

function identity(data: { serverKey: string; sessionID: string }) { if (!parseRouteIdentity({ serverKey: data.serverKey, sessionId: data.sessionID })) throw new Error('Invalid session identity') }
export const getWorkspaceStatus = createServerFn({ method: 'GET' }).validator((data: { serverKey: string; sessionID: string }) => { identity(data); return data }).handler(({ data }) => loadWorkspaceStatus(data.serverKey, data.sessionID))
export const mutateMcp = createServerFn({ method: 'POST' }).validator((data: { serverKey: string; sessionID: string; name: string; action: 'connect' | 'disconnect' | 'authenticate' | 'auth-callback'; code?: string }) => { identity(data); if (!data.name || data.name.length > 300 || !['connect', 'disconnect', 'authenticate', 'auth-callback'].includes(data.action) || (data.code?.length ?? 0) > 4_000) throw new Error('Invalid MCP action'); return data }).handler(({ data }) => { assertSameOriginRequest(); return controlMcp(data.serverKey, data.sessionID, data.name, data.action, undefined, undefined, data.code) })
export const getWorkspaceDiff = createServerFn({ method: 'GET' }).validator((data: { serverKey: string; sessionID: string; mode: 'working' | 'branch'; file?: string }) => { identity(data); if (data.mode !== 'working' && data.mode !== 'branch' || (data.file?.length ?? 0) > 2_000) throw new Error('Invalid diff scope'); return data }).handler(({ data }) => loadWorkspaceDiff(data.serverKey, data.sessionID, data.mode, undefined, undefined, data.file))
