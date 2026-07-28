import { Link, createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { startTransition, useDeferredValue, useEffect, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'

import { PageIntro } from '~/components/page-intro'
import { getAllHomeIndices } from '~/functions/home-index'
import { sessionLifecycleMutation } from '~/functions/session-lifecycle'
import { ProjectManager } from '~/components/project-manager'
import { strings } from '~/lib/strings'
import { getNotificationStore } from '~/lib/notifications'

export const Route = createFileRoute('/')({
  loader: async () => {
    try {
      return await getAllHomeIndices({ data: { limit: 32 } })
    } catch {
      return {
        projects: [],
        sessions: [],
        projectsLimited: false,
        sessionsLimited: false,
        errors: { projects: true, sessions: true },
      }
    }
  },
  head: () => ({ meta: [{ title: `Home | ${strings.productName}` }] }),
  component: Home,
})

function Home() {
  const { connection } = getRouteApi('__root__').useLoaderData()
  const index = Route.useLoaderData()
  const router = useRouter()
  const searchIndex = useServerFn(getAllHomeIndices)
  const lifecycle = useServerFn(sessionLifecycleMutation)
  const [displayIndex, setDisplayIndex] = useState(index)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [searching, setSearching] = useState(false)
  const [actionError, setActionError] = useState('')
  useEffect(() => setDisplayIndex(index), [index])
  useEffect(() => {
    let active = true
    setSearching(true)
    const timer = setTimeout(() => void searchIndex({ data: { search: deferredSearch, limit: 32 } }).then((result) => {
      if (active) startTransition(() => setDisplayIndex(result))
    }).catch(() => setActionError('Session search could not be completed.')).finally(() => { if (active) setSearching(false) }), 200)
    return () => { active = false; clearTimeout(timer) }
  }, [deferredSearch, searchIndex])
  const sessionGroups = (['Today', 'Yesterday', 'Older'] as const)
    .map((label) => ({
      label,
      sessions: displayIndex.sessions.filter((session) => session.group === label),
    }))
    .filter((group) => group.sessions.length)
  const connected = connection.state === 'connected'
  const [unseenSessions, setUnseenSessions] = useState<Set<string>>(new Set())
  const [errorSessions, setErrorSessions] = useState<Set<string>>(new Set())
  const [requestSessions, setRequestSessions] = useState<Set<string>>(new Set())
  const notificationServerKeys = [...new Set([
    connection.server.key,
    ...displayIndex.projects.map((project) => project.serverKey),
    ...displayIndex.sessions.map((session) => session.serverKey),
  ])].sort().join(',')
  useEffect(() => {
    const serverKeys = notificationServerKeys.split(',').filter(Boolean)
    const stores = serverKeys.map((serverKey) => ({ serverKey, store: getNotificationStore(serverKey) }))
    const update = () => {
      const unseen = stores.flatMap(({ serverKey, store }) => store.getSnapshot().entries.filter((entry) => !entry.viewed).map((entry) => ({ serverKey, entry })))
      setUnseenSessions(new Set(unseen.map(({ serverKey, entry }) => `${serverKey}:${entry.sessionID}`)))
      setErrorSessions(new Set(unseen.filter(({ entry }) => entry.kind === 'error').map(({ serverKey, entry }) => `${serverKey}:${entry.sessionID}`)))
      setRequestSessions(new Set(unseen.filter(({ entry }) => entry.kind === 'request').map(({ serverKey, entry }) => `${serverKey}:${entry.sessionID}`)))
    }
    update()
    const unsubscribes = stores.map(({ store }) => store.subscribe(update))
    return () => { for (const unsubscribe of unsubscribes) unsubscribe() }
  }, [notificationServerKeys])

  return (
    <main id="main-content" className="home-page">
      <div className="home-grid">
        <section className="hero">
        <PageIntro {...strings.home} />
        <div className="action-row">
          <Link className="button-primary" to="/new">
            {strings.navigation.newSession}
          </Link>
          <Link className="button-secondary" to="/settings">
            Configure server
          </Link>
        </div>
        </section>
        <aside className="connection-panel" aria-labelledby="connection-title">
        <div className="status-line">
          <span className={`status-dot ${connected ? 'is-connected' : ''}`} aria-hidden="true" />
          <span>{strings.home.connection[connection.state]}</span>
        </div>
        <h2 id="connection-title">One server. One clear path.</h2>
        <p>
          {connected
            ? `OpenCode ${connection.version ?? ''} is ready.`
            : strings.home.connectionDescription[connection.state]}
        </p>
        <dl>
          <div>
            <dt>Default address</dt>
            <dd>
              {connection.server.url
                ? connection.server.url.replace(/^https?:\/\//, '')
                : 'Not configured'}
            </dd>
          </div>
          <div>
            <dt>Protocol</dt>
            <dd>{connected ? 'OpenCode v1' : 'Not detected'}</dd>
          </div>
        </dl>
        </aside>
      </div>
       <div className="home-index">
         <ProjectManager projects={displayIndex.projects} onChanged={() => void router.invalidate()} />
         <section aria-labelledby="recent-heading">
          <p className="eyebrow">Recent work</p>
          <h2 id="recent-heading">{index.errors.sessions ? 'Sessions could not be loaded' : 'Root sessions'}</h2>
          {index.errors.projects || index.errors.sessions ? (
            <button type="button" onClick={() => void router.invalidate()}>Retry</button>
          ) : null}
           <label className="index-search"><span>Search sessions</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
           {searching ? <p role="status">Searching...</p> : null}
           {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
           {!displayIndex.errors.sessions && !displayIndex.sessions.length ? <p className="empty-copy">No matching sessions.</p> : null}
          {sessionGroups.map((group) => (
            <div className="session-group" key={group.label}>
              <h3>{group.label}</h3>
              <ol className="session-list">
                {group.sessions.map((session) => (
                   <li key={`${session.serverKey}:${session.id}`}>
                     <Link
                      to="/server/$serverKey/session/$sessionId"
                       params={{ serverKey: session.serverKey, sessionId: session.id }}
                     >
                       <strong>{session.title}</strong>
                       {unseenSessions.has(`${session.serverKey}:${session.id}`) ? <small className="notification-badge">{errorSessions.has(`${session.serverKey}:${session.id}`) ? 'Error' : requestSessions.has(`${session.serverKey}:${session.id}`) ? 'Waiting for you' : 'New activity'}</small> : null}
                        <span>{session.serverLabel} · {session.projectName} / {session.worktreeName} · {session.status} · {session.updatedLabel}</span>
                     </Link>
                     <div className="compact-actions"><button type="button" onClick={() => void sessionAction(session.serverKey, session.id, 'archive')}>Archive</button><button type="button" onClick={() => void sessionAction(session.serverKey, session.id, 'delete')}>Delete</button></div>
                   </li>
                ))}
              </ol>
            </div>
           ))}
           {displayIndex.sessionsLimited ? <button type="button" disabled={searching} onClick={() => {
             setSearching(true)
             void searchIndex({ data: { search: deferredSearch, start: displayIndex.nextStart ?? displayIndex.sessions.length, limit: 32 } }).then((result) => setDisplayIndex((current) => ({ ...result, sessions: [...current.sessions, ...result.sessions] }))).catch(() => setActionError('More sessions could not be loaded.')).finally(() => setSearching(false))
           }}>Load more sessions</button> : null}
         </section>
      </div>
    </main>
  )

  async function sessionAction(serverKey: string, sessionID: string, action: 'archive' | 'delete') {
    if (!confirm(action === 'delete' ? 'Permanently delete this session and its history?' : 'Archive this session?')) return
    setActionError('')
    try {
      await lifecycle({ data: { serverKey, sessionID, action } })
      setDisplayIndex((current) => ({ ...current, sessions: current.sessions.filter((session) => session.serverKey !== serverKey || session.id !== sessionID) }))
    } catch { setActionError(`The session could not be ${action === 'archive' ? 'archived' : 'deleted'}.`) }
  }
}
