import { lazy, Suspense, useEffect, useEffectEvent, useRef, useState } from 'react'

import { getSessionHistoryPage } from '~/functions/session-snapshot'
import type { SessionSnapshot, SessionTimelineItem } from '~/lib/session-snapshot'

const SessionMarkdown = lazy(() =>
  import('./session-markdown').then((module) => ({ default: module.SessionMarkdown })),
)

export function SessionTimeline({
  serverKey,
  sessionId,
  snapshot,
}: {
  serverKey: string
  sessionId: string
  snapshot: SessionSnapshot
}) {
  const [older, setOlder] = useState<SessionTimelineItem[]>([])
  const [cursor, setCursor] = useState(snapshot.historyCursor)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [historyLimited, setHistoryLimited] = useState(false)
  const [historyStart, setHistoryStart] = useState(0)
  const [following, setFollowing] = useState(true)
  const anchor = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const previousCurrent = useRef(snapshot.items)
  const previousSignature = useRef(messageSignature(snapshot.items.at(-1)))
  const loadedHistory = useRef(false)

  useEffect(() => {
    const currentIds = new Set(snapshot.items.map((item) => item.id))
    const removed = new Set(snapshot.removedMessageIds)
    const displaced = previousCurrent.current.filter(
      (item) => !currentIds.has(item.id) && !removed.has(item.id),
    )
    if (displaced.length) setOlder((current) => {
      const merged = mergeMessages(current, displaced)
      if (merged.length > 1_000) {
        setHistoryLimited(true)
        setCursor(undefined)
      }
      return merged.slice(-1_000)
    })
    if (!loadedHistory.current) setCursor(snapshot.historyCursor)
    previousCurrent.current = snapshot.items
  }, [snapshot.historyCursor, snapshot.items, snapshot.removedMessageIds])

  useEffect(() => {
    const node = end.current
    if (!node) return
    const observer = new IntersectionObserver(
      ([entry]) => setFollowing(entry?.isIntersecting ?? false),
      { rootMargin: '0px 0px 120px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const followLatest = useEffectEvent(() => {
    end.current?.scrollIntoView({ block: 'end' })
  })
  useEffect(() => {
    const signature = messageSignature(snapshot.items.at(-1))
    if (signature !== previousSignature.current && following) followLatest()
    previousSignature.current = signature
  }, [following, snapshot.items])

  async function loadOlder() {
    if (!cursor || loading) return
    const remaining = 1_000 - older.length
    if (remaining <= 0) {
      setHistoryLimited(true)
      setCursor(undefined)
      return
    }
    setLoading(true)
    setError(undefined)
    const marker = anchor.current
    const beforeTop = marker?.getBoundingClientRect().top
    try {
      const page = await getSessionHistoryPage({
        data: { serverKey, sessionID: sessionId, cursor, limit: Math.min(200, remaining) },
      })
      const reachesLimit = mergeMessages(page.items, older).length >= 1_000 && !page.complete
      loadedHistory.current = true
      setOlder((current) => {
        const merged = mergeMessages(page.items, current)
        if (merged.length >= 1_000 && !page.complete) {
          setHistoryLimited(true)
        }
        return merged.slice(-1_000)
      })
      setCursor(reachesLimit ? undefined : page.cursor)
      setHistoryStart(0)
      requestAnimationFrame(() => {
        if (beforeTop === undefined || !marker) return
        const afterTop = marker.getBoundingClientRect().top
        window.scrollBy({ top: afterTop - beforeTop })
      })
    } catch {
      setError('Older messages could not be loaded. Your current timeline is unchanged.')
    } finally {
      setLoading(false)
    }
  }

  const currentIds = new Set(snapshot.items.map((item) => item.id))
  const removed = new Set(snapshot.removedMessageIds)
  const displacedCurrent = previousCurrent.current.filter(
    (item) => !currentIds.has(item.id) && !removed.has(item.id),
  )
  const historical = mergeMessages(older, displacedCurrent).filter(
    (item) => !currentIds.has(item.id) && !removed.has(item.id),
  )
  const visibleHistory = historical.slice(historyStart, historyStart + 400)
  const itemCount = visibleHistory.length + snapshot.items.length
  return (
    <section className="timeline" aria-label="Session timeline">
      <div className="history-controls">
        {cursor ? (
          <button type="button" disabled={loading} onClick={() => void loadOlder()}>
            {loading ? 'Loading older messages...' : 'Load older messages'}
          </button>
        ) : historyLimited ? <p>History retention limit reached.</p> : older.length ? <p>Start of session.</p> : snapshot.hasOlder ? (
          <p>Older messages are available, but this server did not provide a history cursor.</p>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        {historyLimited ? <p>History is limited to 1,000 retained messages.</p> : null}
        {historyStart > 0 ? <button type="button" onClick={() => setHistoryStart(Math.max(0, historyStart - 400))}>Show earlier loaded messages</button> : null}
        {historyStart + 400 < historical.length ? <button type="button" onClick={() => setHistoryStart(historyStart + 400)}>Show newer loaded messages</button> : null}
      </div>
      {!itemCount ? <p className="empty-copy">This session has no messages yet.</p> : null}
      {visibleHistory.map((item) => <TimelineMessage key={item.id} item={item} />)}
      {historical.length > visibleHistory.length ? <p className="history-window-note">Showing 400 of {historical.length} loaded older messages.</p> : null}
      <div ref={anchor} />
      {snapshot.items.map((item) => <TimelineMessage key={item.id} item={item} />)}
      <div ref={end} className="timeline-end" aria-hidden="true" />
      {!following ? (
        <button className="jump-latest" type="button" onClick={followLatest}>
          Jump to latest
        </button>
      ) : null}
    </section>
  )
}

function TimelineMessage({ item }: { item: SessionTimelineItem }) {
  const [copyStatus, setCopyStatus] = useState<string>()
  async function copyMessage() {
    const text = item.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n\n')
    if (!text) return
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setCopyStatus('Copied')
    } catch {
      setCopyStatus('Copy failed')
    }
  }

  return (
    <article className={`message message-${item.role}`}>
      <header>
        <h2>{item.role === 'user' ? 'You' : 'Assistant'}</h2>
        <time dateTime={new Date(item.createdAt).toISOString()}>{item.createdLabel}</time>
        <button type="button" onClick={() => void copyMessage()}>Copy</button>
        {copyStatus ? <span role="status">{copyStatus}</span> : null}
      </header>
      {item.error ? <p className="message-error">{item.error}</p> : null}
      {item.parts.map((part) => {
        if (part.type === 'text') {
          return <div className="message-markdown" key={part.id}>
            <Suspense fallback={<p>{part.text}</p>}><SessionMarkdown text={part.text} /></Suspense>
            {part.limited ? <p className="content-limit">This message is truncated at 100,000 characters.</p> : null}
          </div>
        }
        if (part.type === 'tool') {
          return <ToolDetail key={part.id} part={part} />
        }
        return <p className="part-status" key={part.id}>{part.label}</p>
      })}
    </article>
  )
}

function ToolDetail({ part }: {
  part: Extract<SessionTimelineItem['parts'][number], { type: 'tool' }>
}) {
  const [open, setOpen] = useState(false)
  return <details className="tool-detail" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><strong>{part.title ?? part.name}</strong><span>{part.status}</span></summary>
    {open ? <>
      {part.input ? <section><h3>Input</h3><pre><code>{part.input}</code></pre></section> : null}
      {part.output ? <section><h3>Output</h3><pre><code>{part.output}</code></pre></section> : null}
      {part.outputLimited ? <p className="content-limit">Tool output is truncated at 16,000 characters.</p> : null}
      {part.error ? <pre className="message-error"><code>{part.error}</code></pre> : null}
    </> : null}
  </details>
}

function mergeMessages(first: SessionTimelineItem[], second: SessionTimelineItem[]) {
  const seen = new Set<string>()
  return [...first, ...second].filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function messageSignature(item: SessionTimelineItem | undefined) {
  if (!item) return ''
  const parts = item.parts.map((part) =>
    part.type === 'text'
      ? `${part.id}:text:${part.text.length}`
      : part.type === 'tool'
        ? `${part.id}:tool:${part.status}:${part.output?.length ?? 0}:${part.error?.length ?? 0}`
        : `${part.id}:status:${part.label}`,
  ).join('|')
  return `${item.id}:${parts}`
}
