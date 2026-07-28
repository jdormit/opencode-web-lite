import { lazy, memo, Suspense, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'

import { getSessionHistoryPage } from '~/functions/session-snapshot'
import type { SessionSnapshot, SessionTimelineItem, SessionTimelinePart, TimelineToolPart } from '~/lib/session-snapshot'
import { writePersistentValue } from '~/lib/persistence'

const SessionMarkdown = lazy(() => import('./session-markdown').then((module) => ({ default: module.SessionMarkdown })))
const ToolRenderer = lazy(() => import('./tool-renderers').then((module) => ({ default: module.ToolRenderer })))
const ContextToolGroup = lazy(() => import('./tool-renderers').then((module) => ({ default: module.ContextToolGroup })))
const measuredHeights = new Map<string, number>()
const contextTools = new Set(['read', 'list', 'glob', 'grep'])

export function SessionTimeline({ serverKey, sessionId, snapshot }: { serverKey: string; sessionId: string; snapshot: SessionSnapshot }) {
  const [older, setOlder] = useState<SessionTimelineItem[]>([])
  const [cursor, setCursor] = useState(snapshot.historyCursor)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [following, setFollowing] = useState(true)
  const viewport = useRef<HTMLDivElement>(null)
  const previousCurrent = useRef(snapshot.items)
  const loadedHistory = useRef(false)
  const scrollKey = `opencode-web-lite:timeline-scroll:v1:${serverKey}:${sessionId}`

  useEffect(() => {
    const ids = new Set(snapshot.items.map((item) => item.id))
    const removed = new Set(snapshot.removedMessageIds)
    const displaced = previousCurrent.current.filter((item) => !ids.has(item.id) && !removed.has(item.id))
    if (displaced.length) setOlder((current) => mergeMessages(current, displaced).slice(-1_000))
    if (!loadedHistory.current) setCursor(snapshot.historyCursor)
    previousCurrent.current = snapshot.items
  }, [snapshot.historyCursor, snapshot.items, snapshot.removedMessageIds])

  const restoreScroll = useEffectEvent(() => {
    const node = viewport.current
    if (!node) return
    try {
      const saved = JSON.parse(localStorage.getItem(scrollKey) ?? 'null') as { top?: unknown; end?: unknown } | null
      if (saved?.end === true) node.scrollTop = node.scrollHeight
      else if (typeof saved?.top === 'number') node.scrollTop = Math.max(0, saved.top)
    } catch { node.scrollTop = node.scrollHeight }
  })
  useLayoutEffect(() => restoreScroll(), [scrollKey])

  const loadOlder = useEffectEvent(async () => {
    if (!cursor || loading) return
    const node = viewport.current
    const previousHeight = node?.scrollHeight ?? 0
    const previousTop = node?.scrollTop ?? 0
    setLoading(true); setError(undefined)
    try {
      const page = await getSessionHistoryPage({ data: { serverKey, sessionID: sessionId, cursor, limit: Math.min(200, 1_000 - older.length) } })
      loadedHistory.current = true
      setOlder((current) => mergeMessages(page.items, current).slice(-1_000))
      setCursor(page.cursor)
      requestAnimationFrame(() => { if (node) node.scrollTop = previousTop + node.scrollHeight - previousHeight })
    } catch { setError('Older messages could not be loaded. Your current timeline is unchanged.') }
    finally { setLoading(false) }
  })

  const removed = new Set(snapshot.removedMessageIds)
  const currentIds = new Set(snapshot.items.map((item) => item.id))
  const items = mergeMessages(older, snapshot.items).filter((item) => !removed.has(item.id) && (currentIds.has(item.id) || older.some((old) => old.id === item.id)))
  const signature = messageSignature(items.at(-1))
  useEffect(() => {
    const node = viewport.current
    if (following && node) node.scrollTop = node.scrollHeight
  }, [following, signature])

  function onScroll() {
    const node = viewport.current
    if (!node) return
    if (node.scrollTop < 300 && cursor && !loading) void loadOlder()
    const atEnd = node.scrollHeight - node.scrollTop - node.clientHeight < 120
    setFollowing(atEnd)
    writePersistentValue(localStorage, scrollKey, JSON.stringify({ top: node.scrollTop, end: atEnd }), 'session-ui')
  }

  return <section className="timeline" aria-label="Session timeline">
    <div className="timeline-viewport" ref={viewport} onScroll={onScroll} onWheel={() => setFollowing(false)} onTouchMove={() => setFollowing(false)} onPointerDown={() => setFollowing(false)}>
      <div className="history-controls">
        {cursor ? <button type="button" disabled={loading} onClick={() => void loadOlder()}>{loading ? 'Loading older messages...' : 'Load older messages'}</button> : older.length ? <p>Start of session.</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {older.length >= 1_000 ? <p>History is limited to 1,000 retained messages.</p> : null}
      </div>
      {!items.length ? <p className="empty-copy">This session has no messages yet.</p> : null}
      <VirtualMessages items={items} serverKey={serverKey} sessionId={sessionId} streaming={snapshot.busy} {...(snapshot.revertMessageID ? { revertMessageID: snapshot.revertMessageID } : {})} viewport={viewport} />
    </div>
    {!following ? <button className="jump-latest" type="button" onClick={() => { const node = viewport.current; if (node) node.scrollTop = node.scrollHeight; setFollowing(true) }}>Jump to latest</button> : null}
  </section>
}

function VirtualMessages({ items, serverKey, sessionId, revertMessageID, viewport, streaming }: { items: SessionTimelineItem[]; serverKey: string; sessionId: string; revertMessageID?: string; viewport: React.RefObject<HTMLDivElement | null>; streaming: boolean }) {
  const [, rerender] = useState(0)
  const [range, setRange] = useState({ start: 0, end: items.length })
  const itemIDs = items.map((item) => item.id).join(':')
  const onMeasure = useEffectEvent(() => rerender((value) => value + 1))
  useEffect(() => {
    const node = viewport.current
    if (!node) return
    const calculate = () => {
      let offset = 0; let start = 0; let end = items.length
      const top = Math.max(0, node.scrollTop - node.clientHeight)
      const bottom = node.scrollTop + node.clientHeight * 2
      for (let index = 0; index < items.length; index += 1) {
        const height = measuredHeights.get(`${sessionId}:${items[index]!.id}`) ?? 260
        if (offset + height < top) start = index + 1
        if (offset <= bottom) end = index + 1
        offset += height
      }
      setRange({ start, end: Math.max(start + 1, end) })
    }
    calculate(); node.addEventListener('scroll', calculate, { passive: true }); window.addEventListener('resize', calculate)
    return () => { node.removeEventListener('scroll', calculate); window.removeEventListener('resize', calculate) }
  }, [itemIDs, sessionId, viewport])
  const before = items.slice(0, range.start).reduce((sum, item) => sum + (measuredHeights.get(`${sessionId}:${item.id}`) ?? 260), 0)
  const after = items.slice(range.end).reduce((sum, item) => sum + (measuredHeights.get(`${sessionId}:${item.id}`) ?? 260), 0)
  const streamingMessageID = streaming && items.at(-1)?.role === 'assistant' ? items.at(-1)?.id : undefined
  const latestTextLength = items.at(-1)?.parts.filter((part) => 'text' in part).reduce((total, part) => total + part.text.length, 0) ?? 0
  return <div className="timeline-window" data-message-count={items.length} data-latest-text-length={latestTextLength} style={{ paddingBlockStart: before, paddingBlockEnd: after }}>
    {items.slice(range.start, range.end).map((item) => <MeasuredMessage key={item.id} item={item} cacheKey={`${sessionId}:${item.id}`} onMeasure={onMeasure} serverKey={serverKey} sessionId={sessionId} streaming={item.id === streamingMessageID} reverted={Boolean(revertMessageID && item.id >= revertMessageID)} />)}
  </div>
}

function MeasuredMessage({ cacheKey, onMeasure, ...props }: Parameters<typeof TimelineMessage>[0] & { cacheKey: string; onMeasure: () => void }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      const height = Math.ceil(entry?.borderBoxSize[0]?.blockSize ?? node.getBoundingClientRect().height)
      if (height && measuredHeights.get(cacheKey) !== height) { measuredHeights.set(cacheKey, height); onMeasure() }
    })
    observer.observe(node); return () => observer.disconnect()
  }, [cacheKey, onMeasure])
  return <TimelineMessage {...props} articleRef={ref} />
}

const TimelineMessage = memo(function TimelineMessage({ item, reverted, serverKey, sessionId, articleRef, streaming }: { item: SessionTimelineItem; reverted: boolean; serverKey: string; sessionId: string; streaming: boolean; articleRef?: React.RefObject<HTMLElement | null> }) {
  const [copyStatus, setCopyStatus] = useState<string>()
  async function copyMessage() {
    const text = item.parts.flatMap((part) => part.type === 'text' && 'text' in part ? [part.text] : []).join('\n\n')
    if (!text) return
    try { await navigator.clipboard.writeText(text); setCopyStatus('Copied') } catch { setCopyStatus('Copy failed') }
  }
  const groups = groupParts(item.parts)
  return <article ref={articleRef} className={`message message-${item.role}${reverted ? ' message-reverted' : ''}`}>
    <header><h2>{item.role === 'user' ? 'You' : item.metadata.agent || 'Assistant'}</h2>{reverted ? <strong>Reverted</strong> : null}<time dateTime={new Date(item.createdAt).toISOString()}>{item.createdLabel}</time><button type="button" onClick={() => void copyMessage()}>Copy</button>{copyStatus ? <span role="status">{copyStatus}</span> : null}</header>
    {item.error ? <details className="message-error"><summary>{item.errorName ?? 'Response error'}</summary><p>{item.error}</p></details> : null}
    {groups.map((group) => group.type === 'context'
      ? <Suspense key={group.parts.map((part) => part.id).join(':')} fallback={<p>Tool details loading...</p>}><ContextToolGroup parts={group.parts} serverKey={serverKey} sessionId={sessionId} /></Suspense>
      : <TimelinePart key={group.part.id} part={group.part} serverKey={serverKey} sessionId={sessionId} streaming={streaming} />)}
    {item.role === 'assistant' && item.metadata.tokens ? <footer className="message-metadata">{item.metadata.modelID ?? 'Unknown model'} / {item.metadata.tokens.total.toLocaleString('en-US')} tokens{item.metadata.cost !== undefined ? ` / ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(item.metadata.cost)}` : ''}</footer> : null}
  </article>
}, (previous, next) => previous.reverted === next.reverted && previous.serverKey === next.serverKey && previous.sessionId === next.sessionId && previous.streaming === next.streaming && JSON.stringify(previous.item) === JSON.stringify(next.item))

function TimelinePart({ part, serverKey, sessionId, streaming }: { part: SessionTimelinePart; serverKey: string; sessionId: string; streaming: boolean }) {
  if ('text' in part) return <div className={`message-markdown part-${part.type}`}>{streaming
    ? <PacedStreamingText text={part.text} />
    : <Suspense fallback={<p>{part.text}</p>}><SessionMarkdown text={part.text} /></Suspense>}{part.limited ? <p className="content-limit">This part is truncated at 100,000 characters.</p> : null}</div>
  if (part.type === 'tool') return <Suspense fallback={<p className="part-status">{part.title ?? part.name}: {part.status}</p>}><ToolRenderer part={part} serverKey={serverKey} sessionId={sessionId} /></Suspense>
  if (part.type === 'file') return <p className="part-status">Attachment: {part.filename ?? part.mime}</p>
  if ('label' in part) return <p className="part-status"><strong>{part.label}</strong>{part.detail ? `: ${part.detail}` : ''}</p>
  return null
}

function isContextTool(part: TimelineToolPart) { return contextTools.has(part.name.toLowerCase()) }

function PacedStreamingText({ text }: { text: string }) {
  const [visible, setVisible] = useState(text)
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(text), 100)
    return () => window.clearTimeout(timer)
  }, [text])
  return <p className="streaming-text">{visible}</p>
}

type PartGroup = { type: 'context'; parts: TimelineToolPart[] } | { type: 'part'; part: SessionTimelinePart }
function groupParts(parts: SessionTimelinePart[]): PartGroup[] {
  const output: PartGroup[] = []
  for (const part of parts) {
    if (part.type === 'tool' && isContextTool(part)) {
      const previous = output.at(-1)
      if (previous?.type === 'context') previous.parts.push(part)
      else output.push({ type: 'context', parts: [part] })
    } else output.push({ type: 'part', part })
  }
  return output
}

function mergeMessages(first: SessionTimelineItem[], second: SessionTimelineItem[]) { const map = new Map(first.map((item) => [item.id, item])); for (const item of second) map.set(item.id, item); return [...map.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)) }
function messageSignature(item: SessionTimelineItem | undefined) { return item ? `${item.id}:${item.parts.map((part) => part.type === 'text' || part.type === 'reasoning' ? part.text.length : part.type === 'tool' ? `${part.status}:${part.output?.length ?? 0}` : part.id).join('|')}` : '' }
