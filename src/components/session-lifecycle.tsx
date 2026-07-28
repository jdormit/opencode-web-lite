import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { sessionLifecycleMutation } from '~/functions/session-lifecycle'
import type { LifecycleAction } from '~/server/session-lifecycle.server'

export function SessionLifecycle({
  serverKey,
  sessionID,
  title,
  shareUrl: initialShareUrl,
  sharingEnabled,
  undoMessageID,
  userMessages,
  revertMessageID,
  revertUndoMessageID,
  revertedTurns,
  revertsLimited,
  parentID,
  children,
  childrenLimited,
  forkPointsLimited,
  initialOpen = false,
}: {
  serverKey: string
  sessionID: string
  title: string
  shareUrl?: string
  sharingEnabled: boolean
  undoMessageID?: string
  userMessages: Array<{ id: string; label: string }>
  revertMessageID?: string
  revertUndoMessageID?: string
  revertedTurns: Array<{ id: string; label: string }>
  revertsLimited: boolean
  parentID?: string
  children: Array<{ id: string; title: string }>
  childrenLimited: boolean
  forkPointsLimited: boolean
  initialOpen?: boolean
}) {
  const navigate = useNavigate()
  const router = useRouter()
  const [nextTitle, setNextTitle] = useState(title)
  const [shareUrl, setShareUrl] = useState(initialShareUrl)
  const [deleteConfirmed, setDeleteConfirmed] = useState(false)
  const [forkMessageID, setForkMessageID] = useState(userMessages.at(-1)?.id ?? '')
  const [pending, setPending] = useState<LifecycleAction>()
  const [status, setStatus] = useState('')
  const [open, setOpen] = useState(initialOpen)

  async function run(action: LifecycleAction, value?: string) {
    if (pending) return
    setPending(action)
    setStatus('')
    try {
      const result = await sessionLifecycleMutation({
        data: { serverKey, sessionID, action, ...(value !== undefined ? { value } : {}) },
      })
      if (action === 'delete' || action === 'archive') {
        await navigate({ to: '/' })
        return
      }
      if (action === 'fork') {
        await navigate({
          to: '/server/$serverKey/session/$sessionId',
          params: { serverKey, sessionId: result.sessionID },
        })
        return
      }
      if (action === 'share') setShareUrl(result.shareUrl)
      if (action === 'unshare') setShareUrl(undefined)
      setStatus(action === 'rename' ? 'Session renamed.' : action === 'share' ? 'Share link created.' : action === 'unshare' ? 'Session is private.' : 'Session updated.')
      await router.invalidate()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The session could not be updated.')
    } finally {
      setPending(undefined)
    }
  }

  const safeShareUrl = shareUrl && /^https:\/\//i.test(shareUrl) ? shareUrl : undefined
  const undoTarget = revertMessageID ? revertUndoMessageID : undoMessageID
  const nextRedoBoundary = revertedTurns[1]?.id
  async function copyShareUrl() {
    if (!safeShareUrl) return
    try {
      await navigator.clipboard.writeText(safeShareUrl)
      setStatus('Share link copied.')
    } catch {
      setStatus('The share link could not be copied.')
    }
  }
  return (
    <details className="session-actions" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Session actions</summary>
      <div className="session-action-grid">
        {pending ? <p role="status">{pending === 'compact' ? 'Compacting session...' : 'Updating session...'}</p> : null}
        <form onSubmit={(event) => { event.preventDefault(); void run('rename', nextTitle) }}>
          <label htmlFor="session-title">Title</label>
          <input id="session-title" value={nextTitle} maxLength={200} required onChange={(event) => setNextTitle(event.target.value)} />
          <button disabled={Boolean(pending) || nextTitle.trim() === title} type="submit">Rename</button>
        </form>
        <div className="session-action-buttons">
          <label className="fork-point">Fork point
            <select value={forkMessageID} onChange={(event) => setForkMessageID(event.target.value)}>
              {userMessages.map((message) => <option key={message.id} value={message.id}>{message.label}</option>)}
            </select>
          </label>
          {forkPointsLimited ? <small>Fork points are limited to the 20 most recent messages.</small> : null}
          <button disabled={Boolean(pending) || !forkMessageID} type="button" onClick={() => void run('fork', forkMessageID)}>Fork</button>
          <button disabled={Boolean(pending) || !undoTarget} type="button" onClick={() => void run('undo', undoTarget)}>Undo turn</button>
          <button disabled={Boolean(pending) || !revertMessageID || revertsLimited} type="button" onClick={() => void run('redo', nextRedoBoundary)}>Redo turn</button>
          <button disabled={Boolean(pending)} type="button" onClick={() => void run('compact')}>Compact</button>
          {sharingEnabled && (shareUrl
            ? <button disabled={Boolean(pending)} type="button" onClick={() => void run('unshare')}>Make private</button>
            : <button disabled={Boolean(pending)} type="button" onClick={() => void run('share')}>Create share link</button>)}
          <button disabled={Boolean(pending)} type="button" onClick={() => void run('archive')}>Archive</button>
        </div>
        {sharingEnabled && safeShareUrl ? <p className="share-actions"><button type="button" onClick={() => void copyShareUrl()}>Copy share link</button> <a href={safeShareUrl} target="_blank" rel="noopener noreferrer">Open shared session</a></p> : null}
        {sharingEnabled && shareUrl && !safeShareUrl ? <p className="form-error">The server returned an unsafe share URL.</p> : null}
        {revertedTurns.length ? <section className="revert-list" aria-labelledby="reverted-turns">
          <strong id="reverted-turns">Reverted turns</strong>
          {revertedTurns.map((message, index) => (
            <button key={message.id} disabled={Boolean(pending) || revertsLimited} type="button" onClick={() => void run('redo', revertedTurns[index + 1]?.id)}>
              Restore through {message.label}
            </button>
          ))}
          {revertsLimited ? <small>Revert history is limited to 1,000 messages. Some restore points may be unavailable.</small> : null}
        </section> : null}
        {parentID || children.length ? <nav aria-label="Related sessions">
          <strong>Related sessions</strong>
          {parentID ? <Link to="/server/$serverKey/session/$sessionId" params={{ serverKey, sessionId: parentID }}>Parent</Link> : null}
          {children.map((child) => <Link key={child.id} to="/server/$serverKey/session/$sessionId" params={{ serverKey, sessionId: child.id }}>{child.title}</Link>)}
          {childrenLimited ? <small>Only the first 50 child sessions are shown.</small> : null}
        </nav> : null}
        <fieldset className="danger-zone">
          <legend>Delete permanently</legend>
          <label><input type="checkbox" checked={deleteConfirmed} onChange={(event) => setDeleteConfirmed(event.target.checked)} /> I understand this cannot be undone.</label>
          <button disabled={Boolean(pending) || !deleteConfirmed} type="button" onClick={() => void run('delete')}>Delete session</button>
        </fieldset>
        {status ? <p role="status" className={status.includes('could not') || status.includes('Invalid') ? 'form-error' : undefined}>{status}</p> : null}
      </div>
    </details>
  )
}
