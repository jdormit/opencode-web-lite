import { createFileRoute, Link, notFound, useRouter } from '@tanstack/react-router'
import { lazy, startTransition, Suspense, useEffect, useState } from 'react'

import { getSessionSnapshot } from '~/functions/session-snapshot'
import { getComposerOptions } from '~/functions/composer-options'
import { SessionComposer } from '~/components/session-composer'
import { SessionTimeline } from '~/components/session-timeline'
import { strings } from '~/lib/strings'
import type { SessionSnapshot } from '~/lib/session-snapshot'
import { parseRouteIdentity } from '~/lib/identity'
import { getLiveStore } from '~/lib/live-store'
import { applyLiveSessionEvents } from '~/lib/live-session'
import { getNotificationStore } from '~/lib/notifications'

const SessionTerminal = lazy(() =>
  import('~/components/session-terminal').then((module) => ({
    default: module.SessionTerminal,
  })),
)
const SessionRequests = lazy(() =>
  import('~/components/session-requests').then((module) => ({ default: module.SessionRequests })),
)
const SessionFiles = lazy(() =>
  import('~/components/session-files').then((module) => ({ default: module.SessionFiles })),
)
const SessionChanges = lazy(() =>
  import('~/components/session-changes').then((module) => ({ default: module.SessionChanges })),
)
const loadSessionLifecycle = () => import('~/components/session-lifecycle')
const SessionLifecycle = lazy(() => loadSessionLifecycle().then((module) => ({ default: module.SessionLifecycle })))
const WorkspaceStatusPanel = lazy(() =>
  import('~/components/workspace-status').then((module) => ({ default: module.WorkspaceStatusPanel })),
)
const TopLevelTabs = lazy(() =>
  import('~/components/top-level-tabs').then((module) => ({ default: module.TopLevelTabs })),
)
const SessionContext = lazy(() =>
  import('~/components/session-context').then((module) => ({ default: module.SessionContext })),
)
const TodoDock = lazy(() => import('~/components/todo-dock').then((module) => ({ default: module.TodoDock })))
const SessionContextCollector = lazy(() => import('~/components/session-context-collector').then((module) => ({ default: module.SessionContextCollector })))

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
    const liveRevision = typeof window === 'undefined'
      ? 0
      : getLiveStore(params.serverKey).getSnapshot().revision
    const snapshot = await getSessionSnapshot({
      data: { serverKey: params.serverKey, sessionID: params.sessionId },
    })
    if (!snapshot) throw notFound()
    const composer = await getComposerOptions({ data: { serverKey: params.serverKey, directory: snapshot.directory, sessionID: params.sessionId } }).catch(
      () => ({ agents: [], models: [] }),
    )
    const contextModel = composer.models.find((model) =>
      model.providerID === snapshot.context.providerID && model.modelID === snapshot.context.modelID)
    const contextLimit = contextModel?.contextLimit
    const contextTotal = snapshot.context.tokens?.total
    return {
      snapshot: {
        ...snapshot,
        context: {
          ...snapshot.context,
          ...(contextLimit ? {
            contextLimit,
            ...(contextTotal !== undefined ? { contextPercent: Math.round((contextTotal / contextLimit) * 100) } : {}),
          } : {}),
        },
      },
      composer,
      liveRevision,
    }
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
  const [liveSnapshot, setLiveSnapshot] = useState(liveStore.getSnapshot)
  useEffect(() => {
    const update = () => startTransition(() => setLiveSnapshot(liveStore.getSnapshot()))
    const unsubscribe = liveStore.subscribe(update)
    update()
    return () => { unsubscribe() }
  }, [liveStore])
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
      <Suspense fallback={null}><TopLevelTabs serverKey={serverKey} sessionId={sessionId} title={snapshot.title} directory={snapshot.directory} status={snapshot.permission ? 'waiting' : snapshot.question ? 'waiting' : snapshot.busy ? 'working' : 'idle'} /></Suspense>
      <header className="session-header">
        <p className="eyebrow">{strings.session.eyebrow}</p>
        <h1>{snapshot.title}</h1>
        <p>{snapshot.directory}</p>
        <DeferredSessionLifecycle><SessionLifecycle
          key={`${serverKey}:${sessionId}`}
          serverKey={serverKey}
          sessionID={sessionId}
          title={snapshot.title}
          {...(snapshot.shareUrl ? { shareUrl: snapshot.shareUrl } : {})}
          sharingEnabled={snapshot.sharingEnabled}
          {...(snapshot.changeMessageId ? { undoMessageID: snapshot.changeMessageId } : {})}
           userMessages={snapshot.items.filter((item) => item.role === 'user').map((item) => ({
             id: item.id,
             label: messageText(item) ?? item.createdLabel,
          }))}
          {...(snapshot.revertMessageID ? { revertMessageID: snapshot.revertMessageID } : {})}
          {...(snapshot.revertUndoMessageID ? { revertUndoMessageID: snapshot.revertUndoMessageID } : {})}
          revertedTurns={snapshot.revertedTurns}
          revertsLimited={snapshot.revertsLimited}
          {...(snapshot.parentID ? { parentID: snapshot.parentID } : {})}
          children={snapshot.children}
          childrenLimited={snapshot.childrenLimited}
          forkPointsLimited={snapshot.hasOlder}
          initialOpen
        /></DeferredSessionLifecycle>
      </header>
      <div className="session-utilities"><Suspense fallback={<span>Context</span>}><SessionContext context={snapshot.context} /></Suspense><DeferredWorkspaceStatus><WorkspaceStatusPanel serverKey={serverKey} sessionId={sessionId} /></DeferredWorkspaceStatus></div>
      <nav className="session-destinations" aria-label="Session destinations">
        <Link to="." search={{}} aria-current={view === 'chat' ? 'page' : undefined}>Chat</Link>
        <Link to="." search={{ view: 'changes' }} aria-current={view === 'changes' ? 'page' : undefined}>
          Changes {snapshot.changesTotal ? `(${snapshot.changesTotal})` : ''}
        </Link>
        <Link to="." search={{ view: 'files' }} aria-current={view === 'files' ? 'page' : undefined}>Files</Link>
        <Link to="." search={{ view: 'terminal' }} aria-current={view === 'terminal' ? 'page' : undefined}>Terminal</Link>
      </nav>
      <Suspense fallback={<p>Loading pending requests...</p>}><SessionRequests
        key={`requests:${snapshot.permission?.id ?? ''}:${snapshot.question?.id ?? ''}`}
        serverKey={serverKey}
        directory={snapshot.directory}
        permission={snapshot.permission}
        question={snapshot.question}
        unavailable={snapshot.requestsUnavailable}
      /></Suspense>
      <Suspense fallback={null}><SessionContextCollector serverKey={serverKey} sessionId={sessionId} /></Suspense>
      {view === 'chat' ? <>
      {snapshot.todosUnavailable ? <p className="history-note">Todos are temporarily unavailable.</p> : null}
      {snapshot.todos.length ? <Suspense fallback={<p>Loading...</p>}><TodoDock sessionId={sessionId} snapshot={snapshot} /></Suspense> : null}
      <SessionTimeline key={`${serverKey}:${sessionId}`} serverKey={serverKey} sessionId={sessionId} snapshot={snapshot} />
      </> : view === 'changes' ? (
        <Suspense fallback={<p>Loading changes...</p>}><SessionChanges key={`${serverKey}:${sessionId}:${snapshot.changeMessageId ?? ''}`} serverKey={serverKey} sessionId={sessionId} snapshot={snapshot} /></Suspense>
      ) : view === 'files' ? (
        <Suspense fallback={<p>Loading files...</p>}><SessionFiles key={`${serverKey}:${snapshot.directory}`} serverKey={serverKey} sessionId={sessionId} workspaceDirectory={snapshot.directory} changedPaths={Object.fromEntries(snapshot.changes.map((change) => [change.file, change.status]))} /></Suspense>
      ) : <Suspense fallback={<p>Loading terminal...</p>}><SessionTerminal serverKey={serverKey} directory={snapshot.directory} /></Suspense>}
      <div className="composer-container" hidden={view !== 'chat'}>
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

function DeferredSessionLifecycle({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    const preload = () => { void loadSessionLifecycle() }
    const idleWindow = window as Window & { requestIdleCallback?: (callback: IdleRequestCallback) => number; cancelIdleCallback?: (id: number) => void }
    const id = idleWindow.requestIdleCallback ? idleWindow.requestIdleCallback(preload) : window.setTimeout(preload, 1_000)
    return () => { if (idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(id); else window.clearTimeout(id) }
  }, [])
  return loaded
    ? <Suspense fallback={<p>Loading session actions...</p>}>{children}</Suspense>
    : <button type="button" className="button-secondary" onClick={() => setLoaded(true)}>Session actions</button>
}

function DeferredWorkspaceStatus({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false)
  return loaded
    ? <Suspense fallback={<p>Loading...</p>}>{children}</Suspense>
    : <button type="button" className="button-secondary" onClick={() => setLoaded(true)}>System status</button>
}

function messageText(item: SessionSnapshot['items'][number]) {
  const part = item.parts.find((candidate) => candidate.type === 'text')
  return part && 'text' in part ? part.text.slice(0, 100) : undefined
}
