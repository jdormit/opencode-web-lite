import { createFileRoute, Link, notFound, useRouter } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react'

import { getSessionSnapshot } from '~/functions/session-snapshot'
import { getComposerOptions } from '~/functions/composer-options'
import { SessionComposer } from '~/components/session-composer'
import { SessionRequests } from '~/components/session-requests'
import { SessionTimeline } from '~/components/session-timeline'
import { SessionChanges } from '~/components/session-changes'
import { SessionLifecycle } from '~/components/session-lifecycle'
import { strings } from '~/lib/strings'
import type { SessionSnapshot } from '~/lib/session-snapshot'
import { parseRouteIdentity } from '~/lib/identity'
import { getLiveStore } from '~/lib/live-store'
import { applyLiveSessionEvents } from '~/lib/live-session'
import { getNotificationStore } from '~/lib/notifications'
import { addPromptContext, parsePromptContexts, promptContextLocked } from '~/lib/prompt-context'

const SessionTerminal = lazy(() =>
  import('~/components/session-terminal').then((module) => ({
    default: module.SessionTerminal,
  })),
)
const SessionFiles = lazy(() =>
  import('~/components/session-files').then((module) => ({ default: module.SessionFiles })),
)

export const Route = createFileRoute('/server/$serverKey/session/$sessionId')({
  validateSearch: (search: Record<string, unknown>): { view?: 'changes' | 'files' | 'terminal' } =>
    search.view === 'changes' || search.view === 'files' || search.view === 'terminal'
      ? { view: search.view }
      : {},
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
    const composer = await getComposerOptions({ data: { serverKey: params.serverKey, directory: snapshot.directory } }).catch(
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
    getNotificationStore(serverKey).markViewed(sessionId)
  }, [liveRevision, liveStore, serverKey, sessionId])
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
        <SessionLifecycle
          key={`${serverKey}:${sessionId}`}
          serverKey={serverKey}
          sessionID={sessionId}
          title={snapshot.title}
          {...(snapshot.shareUrl ? { shareUrl: snapshot.shareUrl } : {})}
          sharingEnabled={snapshot.sharingEnabled}
          {...(snapshot.changeMessageId ? { undoMessageID: snapshot.changeMessageId } : {})}
          userMessages={snapshot.items.filter((item) => item.role === 'user').map((item) => ({
            id: item.id,
            label: item.parts.find((part) => part.type === 'text')?.type === 'text'
              ? item.parts.find((part) => part.type === 'text')!.text.slice(0, 100)
              : item.createdLabel,
          }))}
          {...(snapshot.revertMessageID ? { revertMessageID: snapshot.revertMessageID } : {})}
          {...(snapshot.revertUndoMessageID ? { revertUndoMessageID: snapshot.revertUndoMessageID } : {})}
          revertedTurns={snapshot.revertedTurns}
          revertsLimited={snapshot.revertsLimited}
          {...(snapshot.parentID ? { parentID: snapshot.parentID } : {})}
          children={snapshot.children}
          childrenLimited={snapshot.childrenLimited}
          forkPointsLimited={snapshot.hasOlder}
        />
      </header>
      <nav className="session-destinations" aria-label="Session destinations">
        <Link to="." search={{}} aria-current={view === 'chat' ? 'page' : undefined}>Chat</Link>
        <Link to="." search={{ view: 'changes' }} aria-current={view === 'changes' ? 'page' : undefined}>
          Changes {snapshot.changesTotal ? `(${snapshot.changesTotal})` : ''}
        </Link>
        <Link to="." search={{ view: 'files' }} aria-current={view === 'files' ? 'page' : undefined}>Files</Link>
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
      <SessionContextCollector serverKey={serverKey} sessionId={sessionId} />
      {view === 'chat' ? <>
      {snapshot.todosUnavailable ? <p className="history-note">Todos are temporarily unavailable.</p> : null}
      {snapshot.todos.length ? <TodoDock sessionId={sessionId} snapshot={snapshot} /> : null}
      <SessionTimeline key={`${serverKey}:${sessionId}`} serverKey={serverKey} sessionId={sessionId} snapshot={snapshot} />
      </> : view === 'changes' ? (
        <SessionChanges key={`${serverKey}:${sessionId}:${snapshot.changeMessageId ?? ''}`} serverKey={serverKey} sessionId={sessionId} snapshot={snapshot} />
      ) : view === 'files' ? (
        <Suspense fallback={<p>Loading files...</p>}><SessionFiles key={`${serverKey}:${sessionId}`} serverKey={serverKey} sessionId={sessionId} /></Suspense>
      ) : <Suspense fallback={<p>Loading terminal...</p>}><SessionTerminal serverKey={serverKey} directory={snapshot.directory} /></Suspense>}
      <div hidden={view !== 'chat'}>
        <SessionComposer
          key={`${serverKey}:${sessionId}`}
          serverKey={serverKey}
          sessionID={sessionId}
          options={composer}
          busy={snapshot.busy}
          blocked={Boolean(snapshot.permission || snapshot.question || snapshot.requestsUnavailable)}
        />
      </div>
      <footer className="session-identity">
        <span>{serverKey}</span><span>{sessionId}</span>
      </footer>
    </main>
  )
}

function SessionContextCollector({ serverKey, sessionId }: { serverKey: string; sessionId: string }) {
  const [status, setStatus] = useState<string>()
  useEffect(() => {
    const key = `opencode-web-lite:session-draft:v1:${serverKey}:${sessionId}`
    const contextKey = `opencode-web-lite:session-contexts:v1:${serverKey}:${sessionId}`
    const collect = (event: Event) => {
      if (promptContextLocked(contextKey)) {
        event.preventDefault()
        setStatus('Wait for the current prompt to be accepted before changing context.')
        return
      }
      const context = (event as CustomEvent<{ context?: unknown }>).detail?.context
      let current: unknown = []
      try { current = JSON.parse(localStorage.getItem(contextKey) ?? '[]') } catch {}
      const result = addPromptContext(parsePromptContexts(current), context)
      if (!result.ok) {
        event.preventDefault()
        setStatus('Context was not added because it exceeds the item or 32,000-character limit.')
        return
      }
      try {
        localStorage.setItem(contextKey, JSON.stringify(result.value))
        window.dispatchEvent(new CustomEvent('opencode:draft-updated', {
          detail: { key, contexts: result.value },
        }))
        setStatus('Context added to the prompt draft.')
      } catch {
        event.preventDefault()
        setStatus('Context could not be saved to the prompt draft.')
      }
    }
    window.addEventListener('opencode:add-context', collect)
    return () => window.removeEventListener('opencode:add-context', collect)
  }, [serverKey, sessionId])
  return status ? <p role="status">{status}</p> : null
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
