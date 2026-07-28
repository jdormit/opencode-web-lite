import { useEffect, useRef, useState } from 'react'

import { getSessionFileDiff } from '~/functions/session-snapshot'
import { getWorkspaceDiff } from '~/functions/workspace'
import { parseUnifiedDiff, type DiffLine } from '~/lib/diff'
import type { SessionChange, SessionSnapshot } from '~/lib/session-snapshot'
import { promptContextID } from '~/lib/prompt-context'
import { writePersistentValue } from '~/lib/persistence'

type Scope = 'working' | 'branch' | 'turn'
type Style = 'unified' | 'split'
type Comment = { id: string; file: string; side: 'old' | 'new'; start: number; end: number; note: string }

export function SessionChanges({ serverKey, sessionId, snapshot }: { serverKey: string; sessionId: string; snapshot: SessionSnapshot }) {
  const key = `opencode-web-lite:changes:v1:${serverKey}:${sessionId}`
  const [scope, setScope] = useState<Scope>('turn')
  const [style, setStyle] = useState<Style>('unified')
  const [active, setActive] = useState(snapshot.changes[0]?.file)
  const [changes, setChanges] = useState(snapshot.changes)
  const [limited, setLimited] = useState(snapshot.changesLimited)
  const [totals, setTotals] = useState({ total: snapshot.changesTotal, additions: snapshot.changesAdditions, deletions: snapshot.changesDeletions })
  const [details, setDetails] = useState<Record<string, { patch: string; limited: boolean }>>({})
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const pending = useRef(new Set<string>())

  useEffect(() => {
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>
      if (value.scope === 'working' || value.scope === 'branch' || value.scope === 'turn') setScope(value.scope)
      if (value.style === 'unified' || value.style === 'split') setStyle(value.style)
      if (typeof value.active === 'string') setActive(value.active)
      if (Array.isArray(value.comments)) setComments(value.comments.slice(0, 100) as Comment[])
    } catch {}
  }, [key])
  useEffect(() => { writePersistentValue(localStorage, key, JSON.stringify({ scope, style, active, comments }), 'session-ui') }, [active, comments, key, scope, style])
  useEffect(() => {
    if (scope === 'turn') {
      setChanges(snapshot.changes); setLimited(snapshot.changesLimited)
      setTotals({ total: snapshot.changesTotal, additions: snapshot.changesAdditions, deletions: snapshot.changesDeletions })
      setActive((current) => snapshot.changes.some((item) => item.file === current) ? current : snapshot.changes[0]?.file)
      return
    }
    let current = true; setLoading(true); setError(undefined)
    void getWorkspaceDiff({ data: { serverKey, sessionID: sessionId, mode: scope } }).then((result) => {
      if (!current) return
      setChanges(result.changes); setLimited(result.limited); setTotals({ total: result.total, additions: result.additions, deletions: result.deletions })
      setActive((selected) => result.changes.some((item) => item.file === selected) ? selected : result.changes[0]?.file)
    }).catch(() => current && setError(`${scope === 'working' ? 'Working tree' : 'Branch'} changes could not be loaded.`)).finally(() => current && setLoading(false))
    return () => { current = false }
  }, [scope, serverKey, sessionId, snapshot])

  async function loadDetail(change: SessionChange) {
    if (change.patch && !change.patchOmitted && !change.patchLimited || details[change.file] || pending.current.has(change.file)) return
    pending.current.add(change.file); setLoading(true)
    try {
      if (scope === 'turn') {
        if (!snapshot.changeMessageId) throw new Error('missing turn')
        const result = await getSessionFileDiff({ data: { serverKey, sessionID: sessionId, messageID: snapshot.changeMessageId, file: change.file } })
        if (!result) throw new Error('missing diff')
        setDetails((value) => ({ ...value, [change.file]: result }))
      } else {
        const result = await getWorkspaceDiff({ data: { serverKey, sessionID: sessionId, mode: scope, file: change.file } })
        const detail = result.changes[0]
        if (!detail?.patch) throw new Error('missing diff')
        setDetails((value) => ({ ...value, [change.file]: { patch: detail.patch!, limited: detail.patchLimited } }))
      }
    } catch { setError('The complete patch could not be loaded.') }
    finally { pending.current.delete(change.file); setLoading(false) }
  }

  const change = changes.find((item) => item.file === active)
  const patch = change ? details[change.file]?.patch ?? change.patch : undefined
  return <section className="changes-view" aria-labelledby="changes-heading">
    <header><div><h2 id="changes-heading">Changes</h2><p className="change-totals">{totals.total} files / +{totals.additions} / -{totals.deletions}</p></div>
      <label>Scope <select value={scope} onChange={(event) => setScope(event.target.value as Scope)}><option value="working">Working tree</option>{snapshot.branch && snapshot.defaultBranch && snapshot.branch !== snapshot.defaultBranch ? <option value="branch">Branch</option> : null}<option value="turn">Current turn</option></select></label>
      <label className="diff-style">Layout <select value={style} onChange={(event) => setStyle(event.target.value as Style)}><option value="unified">Unified</option><option value="split">Split</option></select></label>
    </header>
    {loading ? <p role="status">Refreshing changes...</p> : null}{error ? <p role="alert" className="message-error">{error}</p> : null}{limited ? <p>Changed files are limited.</p> : null}
    <div className="changes-workspace">
      <ChangedFileTree changes={changes} active={active} onSelect={(item) => { setActive(item.file); void loadDetail(item) }} />
      {change ? <DiffReview key={`${scope}:${change.file}`} change={change} patch={patch} patchIncomplete={!details[change.file] && (change.patchLimited || change.patchOmitted)} style={style} comments={comments.filter((item) => item.file === change.file)} onComments={(next) => setComments((current) => [...current.filter((item) => item.file !== change.file), ...next].slice(-100))} /> : <p className="empty-copy">No {scope === 'turn' ? 'current-turn' : scope} changes.</p>}
    </div>
  </section>
}

function ChangedFileTree({ changes, active, onSelect }: { changes: SessionChange[]; active?: string | undefined; onSelect: (change: SessionChange) => void }) {
  return <nav className="changed-tree" aria-label="Changed files"><ul>{changes.map((change) => <li key={change.file}><button type="button" aria-current={active === change.file ? 'true' : undefined} onClick={() => onSelect(change)}><span>{change.file}</span><small>{change.status} +{change.additions} -{change.deletions}</small></button></li>)}</ul></nav>
}

function DiffReview({ change, patch, patchIncomplete, style, comments, onComments }: { change: SessionChange; patch?: string | undefined; patchIncomplete: boolean; style: Style; comments: Comment[]; onComments: (comments: Comment[]) => void }) {
  const parsed = patch ? parseUnifiedDiff(patch) : undefined
  const [count, setCount] = useState(500)
  const [selection, setSelection] = useState<{ side: 'old' | 'new'; start: number; end: number }>()
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState<string>()
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    const query = matchMedia('(max-width: 767px)')
    const update = () => setMobile(query.matches)
    update(); query.addEventListener('change', update); return () => query.removeEventListener('change', update)
  }, [])
  const layout = mobile ? 'unified' : style
  function choose(line: DiffLine) {
    const side = line.kind === 'deletion' ? 'old' : 'new'; const number = side === 'old' ? line.oldLine : line.newLine
    if (!number) return
    setSelection((current) => current?.side === side ? { side, start: Math.min(current.start, number), end: Math.max(current.end, number) } : { side, start: number, end: number })
  }
  function save() {
    if (!selection || !note.trim()) return
    const comment = { id: editing ?? crypto.randomUUID(), file: change.file, ...selection, note: note.trim().slice(0, 2_000) }
    onComments(editing ? comments.map((item) => item.id === editing ? comment : item) : [...comments, comment])
    setEditing(undefined); setNote(''); setSelection(undefined)
  }
  function addContext() {
    if (!patch || !selection || patchIncomplete) return
    const selected = parsed!.lines.filter((line) => {
      const number = selection.side === 'old' ? line.oldLine : line.newLine
      return number !== undefined && number >= selection.start && number <= selection.end
    }).map((line) => line.text).join('\n')
    window.dispatchEvent(new CustomEvent('opencode:add-context', { cancelable: true, detail: { context: { id: promptContextID('diff', `${change.file}:${selection.side}:${selection.start}-${selection.end}`), type: 'diff', label: `${change.file} ${selection.side} ${selection.start}-${selection.end}`, text: `Diff context: ${change.file}\nSide: ${selection.side}\nLines: ${selection.start}-${selection.end}\n\n${selected.slice(0, 30_000)}` } } }))
  }
  function addCommentContext(comment: Comment) {
    if (!patch || patchIncomplete) return
    const selected = parsed!.lines.filter((line) => {
      const number = comment.side === 'old' ? line.oldLine : line.newLine
      return number !== undefined && number >= comment.start && number <= comment.end
    }).map((line) => line.text).join('\n')
    const accepted = window.dispatchEvent(new CustomEvent('opencode:add-context', { cancelable: true, detail: { context: { id: promptContextID('diff', `${change.file}:${comment.side}:${comment.start}-${comment.end}:${comment.id}`), type: 'diff', label: `${change.file} ${comment.side} ${comment.start}-${comment.end}: ${comment.note}`, text: `Diff review comment: ${comment.note}\nFile: ${change.file}\nSide: ${comment.side}\nLines: ${comment.start}-${comment.end}\n\n${selected.slice(0, 28_000)}` } } }))
    if (accepted) onComments(comments.filter((item) => item.id !== comment.id))
  }
  return <article className={`diff-review diff-${layout}`}><header><h3>{change.file}</h3><span>{change.status} / +{change.additions} -{change.deletions}</span></header>
    {patchIncomplete ? <p role="status">This patch is truncated. Select the file to load its full review content before adding context.</p> : null}
    {!patch ? <p>Patch content is unavailable.</p> : <div className="diff-lines" role="table" aria-label={`Diff for ${change.file}`}>{parsed!.lines.slice(0, count).map((line) => layout === 'split'
      ? <button type="button" role="row" key={line.key} className={`diff-line diff-${line.kind}`} onClick={() => choose(line)}><span>{line.oldLine ?? ''}</span><code>{line.kind === 'addition' ? ' ' : line.text || ' '}</code><span>{line.newLine ?? ''}</span><code>{line.kind === 'deletion' ? ' ' : line.text || ' '}</code></button>
      : <button type="button" role="row" key={line.key} className={`diff-line diff-${line.kind}`} onClick={() => choose(line)}><span className="old-line">{line.oldLine ?? ''}</span><span className="new-line">{line.newLine ?? ''}</span><code>{line.text || ' '}</code></button>)}</div>}
    {parsed && count < parsed.lines.length ? <button type="button" onClick={() => setCount((value) => value + 500)}>Show next 500 lines</button> : null}
    {selection ? <fieldset><legend>Selected {selection.side} lines {selection.start}-{selection.end}</legend><label>Comment <textarea maxLength={2_000} value={note} onChange={(event) => setNote(event.target.value)} /></label><button type="button" onClick={save}>{editing ? 'Update comment' : 'Save comment'}</button><button type="button" disabled={patchIncomplete} onClick={addContext}>Add lines to prompt</button></fieldset> : null}
    {comments.length ? <section className="diff-comments"><h4>Line comments</h4><ul>{comments.map((comment) => <li key={comment.id}><span>{comment.side} {comment.start}-{comment.end}: {comment.note}</span><button type="button" disabled={patchIncomplete} onClick={() => addCommentContext(comment)}>Add comment to prompt</button><button type="button" onClick={() => { setSelection({ side: comment.side, start: comment.start, end: comment.end }); setNote(comment.note); setEditing(comment.id) }}>Edit</button><button type="button" onClick={() => onComments(comments.filter((item) => item.id !== comment.id))}>Delete</button></li>)}</ul></section> : null}
  </article>
}
