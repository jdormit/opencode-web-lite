import { useEffect, useState } from 'react'
import { useRouter } from '@tanstack/react-router'

import type { ConnectionSnapshot } from '~/lib/connection'
import { getGlobalEventStream, type StreamState } from '~/lib/global-event-stream'

export function LiveConnection({ connection }: Readonly<{ connection: ConnectionSnapshot }>) {
  const [state, setState] = useState<StreamState>({ status: 'idle' })
  const router = useRouter()

  useEffect(() => {
    if (connection.state !== 'connected' && connection.state !== 'unavailable') return
    const stream = getGlobalEventStream(connection.server.key)
    let refreshedRecovery = false
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
    const unsubscribeReconnect = stream.onReconnect(() => void router.invalidate())
    const onPageHide = () => stream.stop()
    const onPageShow = () => stream.start()
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    stream.start()
    setState(stream.getSnapshot())
    return () => {
      unsubscribe()
      unsubscribeReconnect()
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
      stream.stop()
    }
  }, [connection, router])

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

function describeState(state: StreamState) {
  if (state.status === 'connected') return 'Live'
  if (state.status === 'reconnecting') return `Retrying (${state.attempt})`
  if (state.status === 'disconnected') return 'Disconnected'
  if (state.status === 'authentication-failed') return 'Authentication failed'
  if (state.status === 'incompatible') return 'Incompatible server'
  return 'Connecting'
}
