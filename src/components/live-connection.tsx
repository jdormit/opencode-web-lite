import { useEffect, useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import type { ConnectionSnapshot } from '~/lib/connection'
import { getGlobalEventStream, type StreamState } from '~/lib/global-event-stream'
import { getLiveStore, reconciliationTarget, type NormalizedGlobalEvent } from '~/lib/live-store'
import { queryKeys } from '~/lib/query-keys'
import { getNotificationStore, type SessionNotification } from '~/lib/notifications'
import { getNotificationContext } from '~/functions/notification-context'

export function LiveConnection({ connection }: Readonly<{ connection: ConnectionSnapshot }>) {
  const [state, setState] = useState<StreamState>({ status: 'idle' })
  const router = useRouter()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (connection.state !== 'connected' && connection.state !== 'unavailable') return
    const stream = getGlobalEventStream(connection.server.key)
    const liveStore = getLiveStore(connection.server.key)
    let refreshedRecovery = false
    let reconcileTimer: ReturnType<typeof setTimeout> | undefined
    const pendingSessions = new Set<string>()
    let pendingHome = false
    let pendingAllSessions = false
    const completionQueue = new Map<string, NormalizedGlobalEvent>()
    const completionInFlight = new Set<string>()
    const completionGeneration = new Map<string, number>()
    const completionEpoch = Date.now().toString(36)
    let activeCompletionRequests = 0
    let disposed = false
    const processCompletions = () => {
      while (activeCompletionRequests < 4 && completionQueue.size) {
        const next = completionQueue.entries().next().value
        if (!next) break
        const [token, event] = next
        const sessionID = typeof event.properties.sessionID === 'string' ? event.properties.sessionID : ''
        completionQueue.delete(token)
        completionInFlight.add(token)
        activeCompletionRequests += 1
        void getNotificationContext({ data: { serverKey: connection.server.key, sessionID } })
          .then((context) => {
            if (disposed) return
            const viewed = router.state.matches.some((match) =>
              match.routeId === '/server/$serverKey/session/$sessionId' &&
              match.params.serverKey === connection.server.key && match.params.sessionId === sessionID)
            getNotificationStore(connection.server.key).apply([{
              ...event,
              properties: { ...event.properties, notificationRoot: context.root, notificationViewed: viewed, notificationToken: token },
            }])
          })
          .catch(() => {})
          .finally(() => {
            activeCompletionRequests -= 1
            completionInFlight.delete(token)
            processCompletions()
          })
      }
    }
    const enqueueCompletion = (event: NormalizedGlobalEvent) => {
      const sessionID = typeof event.properties.sessionID === 'string' ? event.properties.sessionID : ''
      if (!sessionID) return
      const token = `${completionEpoch}:${sessionID}:${completionGeneration.get(sessionID) ?? 0}`
      if (completionInFlight.has(token)) return
      completionQueue.delete(token)
      completionQueue.set(token, event)
      while (completionQueue.size > 100) completionQueue.delete(completionQueue.keys().next().value!)
      processCompletions()
    }
    const unsubscribe = stream.subscribe(() => {
      const next = stream.getSnapshot()
      setState(next)
      if (
        connection.state === 'unavailable' &&
        next.status === 'connected' &&
        !refreshedRecovery
      ) {
        refreshedRecovery = true
        void router.invalidate()
      }
    })
    const unsubscribeReconnect = stream.onReconnect(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.server(connection.server.key) })
      void router.invalidate()
    })
    const unsubscribeEvents = stream.onEvents((rawEvents) => {
      const events = liveStore.apply(rawEvents)
      const immediate: NormalizedGlobalEvent[] = []
      for (const event of events) {
        if (isBusyStatus(event)) {
          const sessionID = typeof event.properties.sessionID === 'string' ? event.properties.sessionID : ''
          if (sessionID) {
            const generation = (completionGeneration.get(sessionID) ?? 0) + 1
            completionGeneration.delete(sessionID)
            completionGeneration.set(sessionID, generation)
            while (completionGeneration.size > 100) completionGeneration.delete(completionGeneration.keys().next().value!)
          }
        }
        if (isCompletion(event)) enqueueCompletion(event)
        else immediate.push(event)
      }
      getNotificationStore(connection.server.key).apply(immediate)
      for (const sessionId of liveStore.drainOverflowedSessions()) pendingSessions.add(sessionId)
      for (const event of events) {
        const target = reconciliationTarget(event)
        if (target.home) {
          pendingHome = true
          void queryClient.invalidateQueries({
            queryKey: queryKeys.sessions(connection.server.key, event.directory),
          })
        }
        if (event.type.startsWith('permission.') || event.type.startsWith('question.')) {
          pendingAllSessions = true
        } else if (target.sessionId && requiresAuthoritativeRefresh(event)) {
          pendingSessions.add(target.sessionId)
          void queryClient.invalidateQueries({
            queryKey: queryKeys.requests(connection.server.key, event.directory),
          })
        }
      }
      if (!pendingHome && !pendingAllSessions && !pendingSessions.size) return
      if (reconcileTimer) return
      reconcileTimer = setTimeout(() => {
        reconcileTimer = undefined
        const refreshHome = pendingHome
        const sessions = new Set(pendingSessions)
        const refreshAllSessions = pendingAllSessions
        pendingHome = false
        pendingAllSessions = false
        pendingSessions.clear()
        void router.invalidate({
          filter: (match) =>
            (refreshHome && match.routeId === '/') ||
            (match.routeId === '/server/$serverKey/session/$sessionId' &&
              match.params.serverKey === connection.server.key &&
              (refreshAllSessions || sessions.has(match.params.sessionId ?? ''))),
        })
      }, 100)
    })
    const onPageHide = () => stream.stop()
    const onPageShow = () => stream.start()
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    stream.start()
    setState(stream.getSnapshot())
    return () => {
      disposed = true
      completionQueue.clear()
      unsubscribe()
      unsubscribeReconnect()
      unsubscribeEvents()
      if (reconcileTimer) clearTimeout(reconcileTimer)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
      stream.stop()
    }
  }, [connection, queryClient, router])

  if (connection.state !== 'connected' && connection.state !== 'unavailable') return null
  return <>
    <span className="live-status" role="status">
      {describeState(state)}
      {state.status === 'reconnecting' ? (
        <button type="button" onClick={() => getGlobalEventStream(connection.server.key).retryNow()}>
          Retry
        </button>
      ) : null}
    </span>
    <NotificationCenter serverKey={connection.server.key} />
  </>
}

function NotificationCenter({ serverKey }: { serverKey: string }) {
  const [entries, setEntries] = useState<SessionNotification[]>([])
  useEffect(() => {
    const store = getNotificationStore(serverKey)
    const update = () => setEntries([...store.getSnapshot().entries])
    update()
    const unsubscribe = store.subscribe(update)
    const timer = setInterval(() => store.pruneExpired(), 60_000)
    return () => { unsubscribe(); clearInterval(timer) }
  }, [serverKey])
  const unseen = entries.filter((entry) => !entry.viewed)
  return (
    <details className="notification-center">
      <summary aria-label={`${unseen.length} unseen notifications`}>Alerts{unseen.length ? ` (${unseen.length})` : ''}</summary>
      <span className="sr-status" role="status">{unseen.at(-1) ? notificationLabel(unseen.at(-1)!) : ''}</span>
      <div>
        <strong>Notifications</strong>
        {entries.length ? <ul>{entries.slice(-10).reverse().map((entry) => <li key={entry.id}>
          <Link to="/server/$serverKey/session/$sessionId" params={{ serverKey, sessionId: entry.sessionID }}>
            {notificationLabel(entry)}{entry.viewed ? '' : ' (new)'}
          </Link>
        </li>)}</ul> : <p>No notifications.</p>}
        {entries.length ? <button type="button" onClick={() => getNotificationStore(serverKey).clear()}>Clear all</button> : null}
      </div>
    </details>
  )
}

function isCompletion(event: { type: string; properties: Record<string, unknown> }) {
  const status = event.properties.status
  return event.type === 'session.idle' || (event.type === 'session.status' &&
    Boolean(status && typeof status === 'object' && (status as { type?: unknown }).type === 'idle'))
}

function isBusyStatus(event: { type: string; properties: Record<string, unknown> }) {
  const status = event.properties.status
  return event.type === 'session.status' && Boolean(status && typeof status === 'object' &&
    (status as { type?: unknown }).type === 'busy')
}

function notificationLabel(entry: SessionNotification) {
  if (entry.kind === 'completion') return `Response ready in ${entry.sessionID}`
  if (entry.kind === 'request') return `Attention needed in ${entry.sessionID}`
  return `Error in ${entry.sessionID}`
}

function requiresAuthoritativeRefresh(event: { type: string; properties: Record<string, unknown> }) {
  const status = event.properties.status
  return (
    event.properties.oversized === true ||
    event.type === 'session.deleted' ||
    event.type === 'session.compacted' ||
    event.type === 'session.error' ||
    event.type === 'session.diff' ||
    event.type === 'session.idle' ||
    (event.type === 'session.status' &&
      Boolean(status && typeof status === 'object' && (status as { type?: unknown }).type === 'idle'))
  )
}

function describeState(state: StreamState) {
  if (state.status === 'connected') return 'Live'
  if (state.status === 'reconnecting') return `Retrying (${state.attempt})`
  if (state.status === 'disconnected') return 'Disconnected'
  if (state.status === 'authentication-failed') return 'Authentication failed'
  if (state.status === 'incompatible') return 'Incompatible server'
  return 'Connecting'
}
