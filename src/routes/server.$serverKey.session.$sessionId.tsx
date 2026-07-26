import { createFileRoute, Link, notFound, useRouter } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react'

import { getSessionSnapshot } from '~/functions/session-snapshot'
import { getComposerOptions } from '~/functions/composer-options'
import { SessionComposer } from '~/components/session-composer'
import { SessionRequests } from '~/components/session-requests'
import { SessionTimeline } from '~/components/session-timeline'
import { strings } from '~/lib/strings'
import type { SessionSnapshot } from '~/lib/session-snapshot'
import { parseRouteIdentity } from '~/lib/identity'
import { getLiveStore } from '~/lib/live-store'
import { applyLiveSessionEvents } from '~/lib/live-session'

const SessionTerminal = lazy(() =>
  import('~/components/session-terminal').then((module) => ({
    default: module.SessionTerminal,
  })),
)

export const Route = createFileRoute('/server/$serverKey/session/$sessionId')({
  validateSearch: (search: Record<string, unknown>): { view?: 'changes' | 'terminal' } =>
    search.view === 'changes' || search.view === 'terminal' ? { view: search.view } : {},
  beforeLoad: ({ params }) => {
    if (!parseRouteIdentity(params)) {
      throw notFound()
    }
  },
  loader: async ({ params }) => {
    const snapshot = await getSessionSnapshot({
      data: { serverKey: params.serverKey, sessionID: params.sessionId },
    })
    if (!snapshot) throw notFound()
    const liveRevision = typeof window === 'undefined'
      ? 0
      : getLiveStore(params.serverKey).getSnapshot().revision
    const composer = await getComposerOptions({ data: { directory: snapshot.directory } }).catch(
      () => ({ agents: [], models: [] }),
    )
    return { snapshot, composer, liveRevision }
  },
  head: ({ loaderData, params }) => ({
    meta: [{ title: `${loaderData?.snapshot.title ?? params.sessionId} | ${strings.productName}` }],
  }),
  component: Session,
})

function Session() {
  const { serverKey, sessionId } = Route.useParams()
  const { composer, snapshot: loaderSnapshot, liveRevision } = Route.useLoaderData()
  const liveStore = getLiveStore(serverKey)
  const liveSnapshot = useSyncExternalStore(
    liveStore.subscribe,
    liveStore.getSnapshot,
    liveStore.getSnapshot,
  )
  const snapshot = applyLiveSessionEvents(
    loaderSnapshot,
    liveSnapshot.revision > liveRevision
      ? liveStore.eventsForSession(sessionId).filter((event) => event.observedAt > liveRevision)
      : [],
  )
  const view = Route.useSearch().view ?? 'chat'
  const router = useRouter()
  const needsReconciliation = liveStore.needsSessionReconciliation(sessionId)
  useEffect(() => {
    liveStore.rebaseSession(sessionId, liveRevision)
  }, [liveRevision, liveStore, sessionId])
  useEffect(() => {
    if (!needsReconciliation) return
    liveStore.acknowledgeSessionReconciliation(sessionId)
    void router.invalidate({
      filter: (match) =>
        match.routeId === '/server/$serverKey/session/$sessionId' &&
        match.params.serverKey === serverKey &&
        match.params.sessionId === sessionId,
    })
  }, [liveStore, needsReconciliation, router, serverKey, sessionId])

  return (
    <main id="main-content" className="session-shell">
      <header className="session-header">
        <p className="eyebrow">{strings.session.eyebrow}</p>
        <h1>{snapshot.title}</h1>
        <p>{snapshot.directory}</p>
      </header>
      <nav className="session-destinations" aria-label="Session destinations">
        <Link to="." search={{}} aria-current={view === 'chat' ? 'page' : undefined}>Chat</Link>
        <Link to="." search={{ view: 'changes' }} aria-current={view === 'changes' ? 'page' : undefined}>
          Changes {snapshot.changesTotal ? `(${snapshot.changesTotal})` : ''}
        </Link>
        <Link to="." search={{ view: 'terminal' }} aria-current={view === 'terminal' ? 'page' : undefined}>Terminal</Link>
      </nav>
      <SessionRequests
        key={`requests:${snapshot.permission?.id ?? ''}:${snapshot.question?.id ?? ''}`}
        serverKey={serverKey}
        directory={snapshot.directory}
        permission={snapshot.permission}
        question={snapshot.question}
        unavailable={snapshot.requestsUnavailable}
      />
      {view === 'chat' ? <>
      {snapshot.todosUnavailable ? <p className="history-note">Todos are temporarily unavailable.</p> : null}
      {snapshot.todos.length ? <TodoDock sessionId={sessionId} snapshot={snapshot} /> : null}
      <SessionTimeline key={`${serverKey}:${sessionId}`} serverKey={serverKey} sessionId={sessionId} snapshot={snapshot} />
      <SessionComposer
        key={`${serverKey}:${sessionId}`}
        serverKey={serverKey}
        sessionID={sessionId}
        options={composer}
        busy={snapshot.busy}
        blocked={Boolean(snapshot.permission || snapshot.question || snapshot.requestsUnavailable)}
      />
      </> : view === 'changes' ? (
        <section className="changes-view" aria-labelledby="changes-heading">
          <h2 id="changes-heading">Changed files</h2>
          {snapshot.changesLimited ? <p className="history-note">Showing the first 40 changed files.</p> : null}
          {!snapshot.changes.length ? <p className="empty-copy">No session changes.</p> : null}
          {snapshot.changes.map((change) => (
            <details key={change.file}>
              <summary><strong>{change.file}</strong><span>{change.status} / +{change.additions} -{change.deletions}</span></summary>
              {change.patch ? <>
                {change.patchLimited ? <p className="history-note">This patch is truncated.</p> : null}
                <pre><code>{change.patch}</code></pre>
              </> : <p>{change.patchOmitted ? 'Patch omitted from the initial bounded view.' : 'Patch content is unavailable.'}</p>}
            </details>
          ))}
        </section>
      ) : <Suspense fallback={<p>Loading terminal...</p>}><SessionTerminal serverKey={serverKey} directory={snapshot.directory} /></Suspense>}
      <footer className="session-identity">
        <span>{serverKey}</span><span>{sessionId}</span>
      </footer>
    </main>
  )
}

function TodoDock({ sessionId, snapshot }: { sessionId: string; snapshot: SessionSnapshot }) {
  const storageKey = `opencode-web-lite:todo-open:${sessionId}`
  const [open, setOpen] = useState(false)
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(storageKey) === 'true')
    } catch {
      setOpen(false)
    }
  }, [storageKey])
  const completed = snapshot.todos.filter((todo) => todo.status === 'completed').length
  const active = snapshot.todos.find((todo) => todo.status === 'in_progress')

  return (
    <details className="todo-dock" open={open} onToggle={(event) => {
      const next = event.currentTarget.open
      setOpen(next)
      try {
        localStorage.setItem(storageKey, String(next))
      } catch {
        // Persistence is optional when browser storage is unavailable.
      }
    }}>
      <summary>
        Todos ({completed}/{snapshot.todos.length}{snapshot.todosLimited ? '+' : ''})
        {active ? <small>{active.content}</small> : null}
      </summary>
      <ul>{snapshot.todos.map((todo, index) => (
        <li key={`${todo.content}-${index}`}><span>{todo.content}</span><small>{todo.status} / {todo.priority}</small></li>
      ))}</ul>
    </details>
  )
}
