import { useNavigate } from '@tanstack/react-router'
import { useEffect, useSyncExternalStore } from 'react'

import { tabStore } from '~/lib/tab-store'
import { tabKey } from '~/lib/tabs'
import { getLiveStore } from '~/lib/live-store'

export function TopLevelTabs({ serverKey, sessionId, title, directory, status }: { serverKey: string; sessionId: string; title: string; directory: string; status: string }) {
  const navigate = useNavigate()
  const state = useSyncExternalStore(tabStore.subscribe, tabStore.getSnapshot, tabStore.getServerSnapshot)
  const liveStore = getLiveStore(serverKey)
  const live = useSyncExternalStore(liveStore.subscribe, liveStore.getSnapshot, liveStore.getSnapshot)
  const active = `session:${serverKey}:${sessionId}`
  useEffect(() => { tabStore.open({ type: 'session', serverKey, sessionId, title, directory, status }) }, [directory, serverKey, sessionId, status, title])
  useEffect(() => {
    for (const event of live.latest.values()) {
      if (event.type !== 'session.deleted') continue
      const deleted = typeof event.properties.sessionID === 'string'
        ? event.properties.sessionID
        : event.properties.info && typeof event.properties.info === 'object' && 'id' in event.properties.info && typeof event.properties.info.id === 'string'
          ? event.properties.info.id
          : undefined
      if (deleted) tabStore.removeSession(serverKey, deleted)
    }
  }, [live, serverKey])
  function select(tab: (typeof state.tabs)[number]) {
    if (tab.type === 'session') void navigate({ to: '/server/$serverKey/session/$sessionId', params: { serverKey: tab.serverKey, sessionId: tab.sessionId } })
    else void navigate({ to: '/new' })
  }
  function close(key: string) {
    const next = tabStore.close(key)
    if (key !== active) return
    if (next) select(next); else void navigate({ to: '/' })
  }
  return <div className="top-tabs-shell">
    <label className="mobile-session-switcher">Open session
      <select value={active} onChange={(event) => { const tab = state.tabs.find((item) => tabKey(item) === event.target.value); if (tab) select(tab) }}>
        {state.tabs.map((tab) => <option key={tabKey(tab)} value={tabKey(tab)}>{tab.title}{tab.status ? ` (${tab.status})` : ''}</option>)}
      </select>
    </label>
    <nav className="top-tabs" aria-label="Open sessions and drafts">
      {state.tabs.map((tab) => { const key = tabKey(tab); return <div className="top-tab" key={key} role="presentation">
        <button type="button" aria-current={key === active ? 'page' : undefined} onClick={() => select(tab)}><span>{tab.title}</span><small>{tab.status ?? tab.type}</small></button>
        <button type="button" aria-label={`Move ${tab.title} left`} onClick={() => tabStore.reorder(key, -1)}>←</button>
        <button type="button" aria-label={`Move ${tab.title} right`} onClick={() => tabStore.reorder(key, 1)}>→</button>
        <button type="button" aria-label={`Close ${tab.title}`} onClick={() => close(key)}>×</button>
      </div> })}
      {state.closed.length ? <button type="button" onClick={() => { const tab = tabStore.reopen(); if (tab) select(tab) }}>Reopen closed</button> : null}
    </nav>
  </div>
}
