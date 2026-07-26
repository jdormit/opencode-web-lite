import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { PageIntro } from '~/components/page-intro'
import { strings } from '~/lib/strings'
import { getNotificationStore, playNotificationSound, type NotificationKind, type NotificationPreferences } from '~/lib/notifications'

export const Route = createFileRoute('/settings')({
  head: () => ({ meta: [{ title: `Settings | ${strings.productName}` }] }),
  component: Settings,
})

function Settings() {
  const { connection } = getRouteApi('__root__').useLoaderData()
  return (
    <main id="main-content" className="workspace-shell">
      <PageIntro {...strings.settings} />
      <section className="settings-list" aria-label="Settings categories">
        <article>
          <p className="eyebrow">Connection</p>
          <h2>OpenCode server</h2>
          <p>The default connection will use http://localhost:4096.</p>
        </article>
        <NotificationSettings serverKey={connection.server.key} />
        <article>
          <p className="eyebrow">Appearance</p>
          <h2>Color scheme</h2>
          <p>Choose System, Light, or Dark from the route bar.</p>
        </article>
      </section>
    </main>
  )
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
