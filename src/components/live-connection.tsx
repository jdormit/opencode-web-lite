import { useEffect, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import type { ConnectionSnapshot } from '~/lib/connection'
import { getGlobalEventStream, type StreamState } from '~/lib/global-event-stream'
import { getLiveStore, reconciliationTarget } from '~/lib/live-store'
import { queryKeys } from '~/lib/query-keys'

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
  return (
    <span className="live-status" role="status">
      {describeState(state)}
      {state.status === 'reconnecting' ? (
        <button type="button" onClick={() => getGlobalEventStream(connection.server.key).retryNow()}>
          Retry
        </button>
      ) : null}
    </span>
  )
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
