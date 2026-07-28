import { useEffect, useState } from 'react'

import { getWorkspaceStatus, mutateMcp } from '~/functions/workspace'
import type { WorkspaceStatus } from '~/lib/workspace-status'

export function WorkspaceStatusPanel({ serverKey, sessionId }: { serverKey: string; sessionId: string }) {
  const [status, setStatus] = useState<WorkspaceStatus>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [oauthName, setOauthName] = useState<string>()
  const [oauthCode, setOauthCode] = useState('')
  async function refresh() { try { setStatus(await getWorkspaceStatus({ data: { serverKey, sessionID: sessionId } })); setError(undefined) } catch { setError('Workspace status could not be loaded.') } }
  useEffect(() => { void refresh() }, [serverKey, sessionId])
  async function control(name: string, action: 'connect' | 'disconnect' | 'authenticate') {
    setBusy(name); setError(undefined)
    const popup = action === 'authenticate' ? window.open('about:blank', '_blank') : null
    if (popup) popup.opener = null
    try {
      const result = await mutateMcp({ data: { serverKey, sessionID: sessionId, name, action } })
      if (result.authorizationUrl) {
        if (popup) popup.location.href = result.authorizationUrl
        else window.open(result.authorizationUrl, '_blank', 'noopener,noreferrer')
        setOauthName(name)
      } else { popup?.close(); await refresh() }
    } catch { popup?.close(); setError(`MCP ${action} failed. The previous status is still shown.`) } finally { setBusy(undefined) }
  }
  async function completeOAuth() {
    if (!oauthName || !oauthCode.trim()) return
    setBusy(oauthName); setError(undefined)
    try { await mutateMcp({ data: { serverKey, sessionID: sessionId, name: oauthName, action: 'auth-callback', code: oauthCode } }); setOauthName(undefined); setOauthCode(''); await refresh() }
    catch { setError('MCP authorization code could not be completed.') }
    finally { setBusy(undefined) }
  }
  return <details className="workspace-status"><summary>System status{status ? ` / ${status.mcp.filter((item) => item.status === 'connected').length} MCP / ${status.lsp.length} LSP` : ''}</summary>
    {!status && !error ? <p>Loading status...</p> : null}{error ? <p role="alert">{error}</p> : null}
    {status ? <div className="status-columns">
      <section><h3>MCP</h3>{status.mcpError ? <p>{status.mcpError}</p> : null}<ul>{status.mcp.map((item) => <li key={item.name}><span><strong>{item.name}</strong> {item.status.replaceAll('_', ' ')}{item.error ? `: ${item.error}` : ''}</span><span>{item.status === 'connected' ? <button disabled={busy === item.name} type="button" onClick={() => void control(item.name, 'disconnect')}>Disconnect</button> : <button disabled={busy === item.name} type="button" onClick={() => void control(item.name, item.status === 'needs_auth' ? 'authenticate' : 'connect')}>{item.status === 'needs_auth' ? 'Authenticate' : 'Connect'}</button>}</span></li>)}</ul></section>
      {oauthName ? <form onSubmit={(event) => { event.preventDefault(); void completeOAuth() }}><label>Authorization code for {oauthName}<input value={oauthCode} required onChange={(event) => setOauthCode(event.target.value)} /></label><button disabled={busy === oauthName}>Complete authorization</button><button type="button" onClick={() => { setOauthName(undefined); setOauthCode('') }}>Cancel</button></form> : null}
      <section><h3>LSP</h3>{status.lspError ? <p>{status.lspError}</p> : null}<ul>{status.lsp.map((item) => <li key={item.id}><span><strong>{item.name}</strong> {item.status}</span><small>{item.root}</small></li>)}</ul></section>
      <section><h3>Plugins</h3>{status.pluginError ? <p>{status.pluginError}</p> : null}<ul>{status.plugins.map((plugin) => <li key={plugin}>{plugin}</li>)}</ul></section>
    </div> : null}
  </details>
}
