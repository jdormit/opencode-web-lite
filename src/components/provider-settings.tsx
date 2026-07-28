import { useServerFn } from '@tanstack/react-start'
import { useEffect, useState, type FormEvent } from 'react'

import {
  authorizeProviderOAuthMutation, completeProviderOAuthMutation, connectProviderKeyMutation,
  disconnectProviderMutation, getProviderSettings, pollProviderOAuthMutation, saveCustomProviderMutation,
} from '~/functions/provider-settings'
import type { SafeProvider } from '~/lib/provider-settings'

export function ProviderSettings({ serverKey, directory }: { serverKey: string; directory?: string }) {
  const getProviders = useServerFn(getProviderSettings)
  const connectKey = useServerFn(connectProviderKeyMutation)
  const disconnect = useServerFn(disconnectProviderMutation)
  const authorize = useServerFn(authorizeProviderOAuthMutation)
  const callback = useServerFn(completeProviderOAuthMutation)
  const pollOAuth = useServerFn(pollProviderOAuthMutation)
  const saveCustom = useServerFn(saveCustomProviderMutation)
  const [providers, setProviders] = useState<SafeProvider[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [oauth, setOauth] = useState<{ providerID: string; method: number; url: string; methodType: 'auto' | 'code'; instructions: string }>()
  const [busy, setBusy] = useState(false)
  const scope = { serverKey, ...(directory ? { directory } : {}) }
  const refresh = () => getProviders({ data: scope }).then(setProviders).catch((reason) => setError(message(reason)))
  useEffect(() => { void refresh() }, [serverKey, directory])
  useEffect(() => {
    if (!oauth || oauth.methodType !== 'auto') return
    const started = Date.now()
    let cancelled = false
    let timer: number | undefined
    const poll = async () => {
      if (cancelled) return
      if (Date.now() - started > 10 * 60 * 1_000) {
        setOauth(undefined); setError('OAuth authorization timed out. Start again.')
        return
      }
      try {
        await pollOAuth({ data: { ...scope, providerID: oauth.providerID, method: oauth.method } })
        if (!cancelled) { setOauth(undefined); await refresh() }
      } catch {
        if (!cancelled) timer = window.setTimeout(() => void poll(), 1_000)
      }
    }
    timer = window.setTimeout(() => void poll(), 1_000)
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer) }
  }, [oauth, pollOAuth, serverKey, directory])
  const act = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await operation(); await refresh() } catch (reason) { setError(message(reason)) } finally { setBusy(false) }
  }
  const filtered = providers.filter((provider) => `${provider.id} ${provider.name}`.toLowerCase().includes(query.toLowerCase()))
  return <section className="provider-settings"><h2>Providers</h2>
    <input type="search" value={query} placeholder="Search providers" onChange={(event) => setQuery(event.target.value)} />
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <ul>{filtered.map((provider) => <li key={provider.id}><span><strong>{provider.name}</strong><small>{provider.source} · {provider.modelCount} models</small></span>
      {provider.connected ? <button type="button" disabled={busy || !provider.disconnectable} title={!provider.disconnectable ? 'Environment credentials must be removed outside this app.' : undefined} onClick={() => void act(() => disconnect({ data: { ...scope, providerID: provider.id } }))}>Disconnect</button>
        : <ProviderConnect provider={provider} busy={busy} onKey={(key) => act(() => connectKey({ data: { ...scope, providerID: provider.id, key } }))} onOAuth={(method, inputs) => act(async () => {
          const result = await authorize({ data: { ...scope, providerID: provider.id, method, inputs } })
          setOauth({ providerID: provider.id, method, url: result.url, methodType: result.method, instructions: result.instructions })
        })} />}
    </li>)}</ul>
    {oauth ? <div className="oauth-panel"><p><a href={oauth.url} target="_blank" rel="noopener noreferrer">Open authorization page</a></p><p>{oauth.instructions}</p>
      {oauth.methodType === 'code' ? <form onSubmit={(event) => { event.preventDefault(); const code = new FormData(event.currentTarget).get('code'); if (typeof code === 'string') void act(() => callback({ data: { ...scope, providerID: oauth.providerID, method: oauth.method, code } }).then(() => setOauth(undefined))) }}><input name="code" required placeholder="Authorization code" /><button disabled={busy}>Complete</button></form> : <p>Complete authorization in the opened page, then refresh providers.</p>}
      <button type="button" className="button-secondary" onClick={() => setOauth(undefined)}>Cancel</button>
    </div> : null}
    <CustomProviderForm busy={busy} onSave={(provider) => act(() => saveCustom({ data: { ...scope, provider } }))} />
  </section>
}

function ProviderConnect({ provider, busy, onKey, onOAuth }: { provider: SafeProvider; busy: boolean; onKey(key: string): Promise<unknown>; onOAuth(index: number, inputs: Record<string, string>): Promise<unknown> }) {
  const oauth = provider.methods.find((method) => method.type === 'oauth')
  return <form className="provider-connect" onSubmit={(event) => { event.preventDefault(); const key = new FormData(event.currentTarget).get('key'); if (typeof key === 'string' && key) void onKey(key) }}>
    <input name="key" type="password" autoComplete="off" placeholder="API key" aria-label={`${provider.name} API key`} /><button disabled={busy}>Connect</button>
    {oauth ? oauth.prompts.length ? <details><summary>{oauth.label}</summary><div className="oauth-prompts">{oauth.prompts.map((prompt) => <label key={prompt.key}>{prompt.message}{prompt.type === 'text'
      ? <input name={`oauth:${prompt.key}`} placeholder={prompt.placeholder} />
      : <select name={`oauth:${prompt.key}`}>{prompt.options.map((option) => <option key={option.value} value={option.value}>{option.label}{option.hint ? ` · ${option.hint}` : ''}</option>)}</select>}</label>)}
      <button type="button" disabled={busy} onClick={(event) => { const form = event.currentTarget.closest('form'); if (!form) return; const data = new FormData(form); void onOAuth(oauth.index, Object.fromEntries(oauth.prompts.map((prompt) => [prompt.key, String(data.get(`oauth:${prompt.key}`) ?? '')]))) }}>Continue with OAuth</button>
    </div></details> : <button type="button" disabled={busy} onClick={() => void onOAuth(oauth.index, {})}>{oauth.label}</button> : null}
  </form>
}

function CustomProviderForm({ busy, onSave }: { busy: boolean; onSave(provider: { providerID: string; name: string; baseURL: string; apiKey?: string; models: Array<{ id: string; name: string }>; headers: Array<{ name: string; value: string }> }): Promise<unknown> }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget)
    const models = String(data.get('models') ?? '').split('\n').filter(Boolean).map((line) => { const [id = '', ...name] = line.split('|'); return { id: id.trim(), name: (name.join('|') || id).trim() } })
    const headers = String(data.get('headers') ?? '').split('\n').filter(Boolean).map((line) => { const [name = '', ...value] = line.split(':'); return { name: name.trim(), value: value.join(':').trim() } })
    const apiKey = String(data.get('apiKey') ?? '')
    void onSave({ providerID: String(data.get('providerID') ?? ''), name: String(data.get('name') ?? ''), baseURL: String(data.get('baseURL') ?? ''), ...(apiKey ? { apiKey } : {}), models, headers })
  }
  return <details><summary>Add an OpenAI-compatible provider</summary><form className="custom-provider" onSubmit={submit}>
    <label>Provider ID<input name="providerID" required /></label><label>Name<input name="name" required /></label><label>Base URL<input name="baseURL" type="url" required /></label>
    <label>API key<input name="apiKey" type="password" autoComplete="off" /></label><label>Models, one per line as ID | Name<textarea name="models" required placeholder="model-id | Model name" /></label><label>Headers, one per line as Name: Value<textarea name="headers" placeholder="X-Tenant: team" /></label>
    <button disabled={busy}>Save provider</button>
  </form></details>
}

function message(reason: unknown) { return reason instanceof Error ? reason.message : 'The provider request failed.' }
