import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import { useServerFn } from '@tanstack/react-start'

import { PageIntro } from '~/components/page-intro'
import { strings } from '~/lib/strings'
import { getNotificationStore, playNotificationSound, type NotificationKind, type NotificationPreferences } from '~/lib/notifications'
import { defaultConnectionMutation, getConnections, removeConnectionMutation, saveConnectionMutation } from '~/functions/connections'
import type { ConnectionRegistrySnapshot, PublicServerConnection } from '~/lib/connection'
import { ProviderSettings } from '~/components/provider-settings'
import { ModelVisibilitySettings } from '~/components/model-picker'
import { ShortcutSettings } from '~/components/command-palette'
import { appCommands } from '~/lib/app-commands'
import { getHomeIndex } from '~/functions/home-index'
import { getComposerOptions } from '~/functions/composer-options'

export const Route = createFileRoute('/settings')({
  loader: async () => {
    const registry = await getConnections()
    const serverKey = registry.defaultKey
    const index = await getHomeIndex({ data: { serverKey, limit: 1 } }).catch(() => undefined)
    const directory = index?.projects[0]?.directory
    const composer = directory
      ? await getComposerOptions({ data: { serverKey, directory } }).catch(() => undefined)
      : undefined
    return { registry, serverKey, directory, composer }
  },
  head: () => ({ meta: [{ title: `Settings | ${strings.productName}` }] }),
  component: Settings,
})

function Settings() {
  const { connection } = getRouteApi('__root__').useLoaderData()
  const { composer, directory, registry, serverKey } = Route.useLoaderData()
  return (
    <main id="main-content" className="workspace-shell">
      <PageIntro {...strings.settings} />
      <section className="settings-list" aria-label="Settings categories">
         <ServerSettings initial={registry} />
        <NotificationSettings serverKey={connection.server.key} />
        <article><ProviderSettings serverKey={serverKey} {...(directory ? { directory } : {})} /></article>
        {composer ? <article><ModelVisibilitySettings models={composer.models} /></article> : null}
        <article><ShortcutSettings commands={appCommands()} /></article>
        <article>
          <p className="eyebrow">Appearance</p>
          <h2>Color scheme</h2>
          <p>Choose System, Light, or Dark from the route bar.</p>
        </article>
      </section>
    </main>
  )
}

function ServerSettings({ initial }: { initial: ConnectionRegistrySnapshot }) {
  const save = useServerFn(saveConnectionMutation)
  const remove = useServerFn(removeConnectionMutation)
  const setDefault = useServerFn(defaultConnectionMutation)
  const load = useServerFn(getConnections)
  const [registry, setRegistry] = useState(initial)
  const [editing, setEditing] = useState<PublicServerConnection>()
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  async function refresh() { setRegistry(await load()) }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const element = event.currentTarget
    const form = new FormData(element)
    const url = String(form.get('url') ?? '')
    if (url.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/.test(url) && form.get('password')) {
      setMessage('Credentials cannot be sent to a non-loopback server over plain HTTP.')
      return
    }
    setPending(true); setMessage('')
    try {
      const password = String(form.get('password') ?? '')
      await save({ data: {
        ...(editing ? { key: editing.key } : {}),
        label: String(form.get('label') ?? ''), url,
        username: String(form.get('username') ?? ''), ...(password ? { password } : {}),
        clearCredentials: form.get('clearCredentials') === 'on',
      } })
      setEditing(undefined); element.reset(); await refresh(); setMessage('Server health verified and connection saved.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The server could not be saved.') }
    finally { setPending(false) }
  }
  return <article className="server-settings">
    <p className="eyebrow">Servers</p><h2>OpenCode connections</h2>
    <p>{registry.persistent ? 'Connections and credentials are encrypted at rest with AES-GCM.' : 'Connections and credentials are held in this server process. Set OPENCODE_WEB_ENCRYPTION_KEY to persist them across restarts.'}</p>
    <ul>{registry.servers.map((snapshot) => <li key={snapshot.server.key}>
      <div><strong>{snapshot.server.label}</strong><span>{snapshot.server.url}</span><small>{snapshot.state}{snapshot.version ? ` · OpenCode ${snapshot.version}` : ''}{snapshot.server.key === registry.defaultKey ? ' · Default' : ''}</small></div>
      <div className="compact-actions"><button type="button" onClick={() => setEditing(snapshot.server)}>Edit</button>{snapshot.server.key !== registry.defaultKey ? <button type="button" onClick={() => void setDefault({ data: { serverKey: snapshot.server.key } }).then(refresh).catch(() => setMessage('The default server could not be changed.'))}>Make default</button> : null}<button type="button" disabled={registry.servers.length === 1} onClick={() => { if (confirm(`Remove ${snapshot.server.label}? Open tabs for this server will stop working.`)) void remove({ data: { serverKey: snapshot.server.key } }).then(refresh).catch(() => setMessage('The server could not be removed.')) }}>Remove</button></div>
    </li>)}</ul>
    <form className="connection-form" key={editing?.key ?? 'new'} onSubmit={submit}>
      <h3>{editing ? `Edit ${editing.label}` : 'Add server'}</h3>
      <label><span>Label</span><input name="label" maxLength={80} defaultValue={editing?.label ?? ''} /></label>
      <label><span>HTTP address</span><input name="url" type="url" required defaultValue={editing?.url ?? 'http://localhost:4096'} /></label>
      <label><span>Basic auth username</span><input name="username" autoComplete="username" /></label>
      <label><span>Basic auth password</span><input name="password" type="password" autoComplete="new-password" /><small>{editing ? 'Leave blank to retain the server-held password.' : 'Optional. Never returned to this page.'}</small></label>
      {editing ? <label><input name="clearCredentials" type="checkbox" /> Remove saved credentials</label> : null}
      <div className="compact-actions"><button disabled={pending} type="submit">{pending ? 'Checking health...' : 'Check health and save'}</button>{editing ? <button type="button" onClick={() => setEditing(undefined)}>Cancel</button> : null}</div>
    </form>
    {message ? <p role="status">{message}</p> : null}
  </article>
}

function NotificationSettings({ serverKey }: { serverKey: string }) {
  const [preferences, setPreferences] = useState<NotificationPreferences>()
  const [status, setStatus] = useState('')
  useEffect(() => {
    const store = getNotificationStore(serverKey)
    const update = () => setPreferences(store.getSnapshot().preferences)
    update()
    return store.subscribe(update)
  }, [serverKey])
  if (!preferences) return null
  async function setSystem(kind: NotificationKind, enabled: boolean) {
    setStatus('')
    if (enabled) {
      if (typeof Notification === 'undefined') { setStatus('System notifications are unavailable in this browser.'); return }
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
      if (permission !== 'granted') { setStatus('Notification permission was not granted.'); return }
    }
    getNotificationStore(serverKey).setPreference(kind, enabled)
  }
  return <article className="notification-settings">
    <p className="eyebrow">Notifications</p>
    <h2>Session alerts</h2>
    <p>Alerts are stored in this browser for up to 30 days. System notifications are opt-in.</p>
    {(['completion', 'request', 'error'] as const).map((kind) => <fieldset key={kind}>
      <legend>{kind === 'completion' ? 'Completions' : kind === 'request' ? 'Permissions and questions' : 'Errors'}</legend>
      <label><input type="checkbox" checked={preferences[kind]} onChange={(event) => void setSystem(kind, event.target.checked)} /> System notification</label>
      <label><input type="checkbox" checked={preferences.sounds[kind]} onChange={(event) => {
        getNotificationStore(serverKey).setPreference(kind, event.target.checked, true)
        if (event.target.checked) playNotificationSound(kind)
      }} /> Sound</label>
      <button type="button" onClick={() => playNotificationSound(kind)}>Preview sound</button>
    </fieldset>)}
    {status ? <p role="status">{status}</p> : null}
  </article>
}
