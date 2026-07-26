import { useDeferredValue, useEffect, useRef, useState } from 'react'

import { findSessionFiles, getSessionFile, getSessionFiles } from '~/functions/files'
import { FilePreviewCache, type FileEntry, type FilePreview } from '~/lib/files'
import { promptContextID } from '~/lib/prompt-context'

const previewCache = new FilePreviewCache()

export function SessionFiles({ serverKey, sessionId }: { serverKey: string; sessionId: string }) {
  const [directory, setDirectory] = useState('')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [listLimited, setListLimited] = useState(false)
  const [selected, setSelected] = useState<FilePreview>()
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query.trim())
  const [results, setResults] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const listRequest = useRef(0)
  const searchRequest = useRef(0)
  const openRequest = useRef(0)

  useEffect(() => {
    const id = ++listRequest.current
    setBusy(true)
    setError(undefined)
    void getSessionFiles({ data: { serverKey, sessionID: sessionId, path: directory } })
      .then((value) => {
        if (listRequest.current !== id) return
        setEntries(value.entries)
        setListLimited(value.limited)
      })
      .catch(() => listRequest.current === id && setError('This directory could not be loaded.'))
      .finally(() => listRequest.current === id && setBusy(false))
  }, [directory, serverKey, sessionId])

  useEffect(() => {
    if (!deferredQuery) {
      searchRequest.current += 1
      setResults([])
      return
    }
    const id = ++searchRequest.current
    const timer = setTimeout(() => {
      void findSessionFiles({ data: { serverKey, sessionID: sessionId, query: deferredQuery } })
        .then((value) => searchRequest.current === id && setResults(value.paths))
        .catch(() => searchRequest.current === id && setError('File search failed.'))
    }, 150)
    return () => clearTimeout(timer)
  }, [deferredQuery, serverKey, sessionId])

  async function openFile(path: string, refresh = false) {
    const id = ++openRequest.current
    const key = `${serverKey}:${sessionId}:${path}`
    const cached = refresh ? undefined : previewCache.get(key)
    if (cached) {
      setSelected(cached)
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const value = await getSessionFile({ data: { serverKey, sessionID: sessionId, path } })
      if (id !== openRequest.current) return
      previewCache.set(key, value)
      setSelected(value)
    } catch {
      if (id === openRequest.current) setError('This file could not be previewed. It may be missing, too large, or inaccessible.')
    } finally {
      if (id === openRequest.current) setBusy(false)
    }
  }

  const segments = directory ? directory.split('/') : []
  return (
    <section className="files-view" aria-labelledby="files-heading">
      <header><h2 id="files-heading">Files</h2><p>{busy ? 'Loading...' : `${entries.length} entries`}</p></header>
      <label className="file-search">Search files
        <input type="search" value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} />
      </label>
      {error ? <p role="alert" className="message-error">{error}</p> : null}
      {results.length ? <ul className="file-search-results">{results.map((path) => (
        <li key={path}><button type="button" onClick={() => void openFile(path)}>{path}</button></li>
      ))}</ul> : null}
      <nav className="file-breadcrumbs" aria-label="Current directory">
        <button type="button" onClick={() => setDirectory('')}>Root</button>
        {segments.map((segment, index) => {
          const path = segments.slice(0, index + 1).join('/')
          return <button type="button" key={path} onClick={() => setDirectory(path)}>{segment}</button>
        })}
      </nav>
      <div className="file-workspace">
        <ul className="file-list">
          {entries.map((entry) => <li key={entry.path}>
            <button type="button" onClick={() => entry.type === 'directory' ? setDirectory(entry.path) : void openFile(entry.path)}>
              <span aria-hidden="true">{entry.type === 'directory' ? '/' : '#'}</span>
              <span>{entry.name}</span><small>{entry.type}{entry.ignored ? ' / ignored' : ''}</small>
            </button>
          </li>)}
        </ul>
        {listLimited ? <p className="history-note">Showing the first 200 entries.</p> : null}
        {selected ? <FilePreviewPanel key={selected.path} storageKey={`opencode-web-lite:file-comments:v1:${serverKey}:${sessionId}:${selected.path}`} preview={selected} onRefresh={() => void openFile(selected.path, true)} /> : <p className="empty-copy">Choose a file to preview it.</p>}
      </div>
    </section>
  )
}

function FilePreviewPanel({ preview, storageKey, onRefresh }: { preview: FilePreview; storageKey: string; onRefresh: () => void }) {
  const [start, setStart] = useState(1)
  const [end, setEnd] = useState(1)
  const [note, setNote] = useState('')
  const [comments, setComments] = useState<Array<{ id: string; start: number; end: number; note: string }>>([])
  const [commentsLoaded, setCommentsLoaded] = useState(false)
  const [editing, setEditing] = useState<string>()
  const [contextError, setContextError] = useState<string>()
  const lineCount = Math.max(1, preview.content.split('\n').length)
  useEffect(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
      setComments(Array.isArray(value) ? value.slice(0, 20) : [])
    } catch { setComments([]) }
    setCommentsLoaded(true)
  }, [storageKey])
  useEffect(() => {
    if (!commentsLoaded) return
    try { localStorage.setItem(storageKey, JSON.stringify(comments)) } catch {}
  }, [comments, commentsLoaded, storageKey])

  function saveComment() {
    if (!editing && comments.length >= 20) {
      setContextError('A file can have at most 20 pending comments.')
      return
    }
    const first = Math.max(1, Math.min(start, end, lineCount))
    const last = Math.max(first, Math.min(Math.max(start, end), lineCount))
    const value = { id: editing ?? crypto.randomUUID(), start: first, end: last, note: note.trim() }
    setComments((current) => editing
      ? current.map((comment) => comment.id === editing ? value : comment)
      : [...current, value])
    setEditing(undefined)
    setNote('')
  }

  function addContext() {
    if (!comments.length) return
    const source = preview.content.split('\n')
    const text = comments.map((comment) => {
      const lines = source.slice(comment.start - 1, comment.end).join('\n').slice(0, 12_000)
      return `<file_context path="${preview.path}" lines="${comment.start}-${comment.end}">${comment.note ? `\nComment: ${comment.note}` : ''}\n${lines}\n</file_context>`
    }).join('\n\n')
    if (text.length > 32_000) {
      setContextError('These comments are too large to add together. Delete or shorten some comments.')
      return
    }
    const accepted = window.dispatchEvent(new CustomEvent('opencode:add-context', {
      detail: { context: {
        id: promptContextID('file', preview.path),
        type: 'file',
        label: `${preview.path} (${comments.length} comment${comments.length === 1 ? '' : 's'})`,
        text,
      } }, cancelable: true,
    }))
    if (accepted) setComments([])
  }

  return <article className="file-preview">
    <header><h3>{preview.path}</h3><span>{preview.type}{preview.mimeType ? ` / ${preview.mimeType}` : ''}</span><button type="button" onClick={onRefresh}>Refresh</button></header>
    {preview.type === 'binary' ? <p>Binary files cannot be previewed as text.</p> : <pre><code>{preview.content}</code></pre>}
    {preview.limited ? <p className="content-limit">This preview is truncated at 256 KiB.</p> : null}
    {preview.type === 'text' ? <fieldset><legend>Add line context to the prompt</legend>
      <label>Start line <input type="number" min="1" max={lineCount} value={start} onChange={(event) => setStart(Number(event.target.value))} /></label>
      <label>End line <input type="number" min="1" max={lineCount} value={end} onChange={(event) => setEnd(Number(event.target.value))} /></label>
      <label>Comment <textarea value={note} maxLength={2_000} onChange={(event) => setNote(event.target.value)} /></label>
      <button type="button" onClick={saveComment}>{editing ? 'Update comment' : 'Save comment'}</button>
    </fieldset> : null}
    {comments.length ? <section className="file-comments"><h4>Prompt comments</h4><ul>{comments.map((comment) => (
      <li key={comment.id}><span>Lines {comment.start}-{comment.end}{comment.note ? `: ${comment.note}` : ''}</span>
        <button type="button" onClick={() => { setStart(comment.start); setEnd(comment.end); setNote(comment.note); setEditing(comment.id) }}>Edit</button>
        <button type="button" onClick={() => { setComments((current) => current.filter((item) => item.id !== comment.id)); if (editing === comment.id) setEditing(undefined) }}>Delete</button>
      </li>
    ))}</ul><button type="button" onClick={addContext}>Add comments to prompt</button>{contextError ? <p role="alert">{contextError}</p> : null}</section> : null}
  </article>
}
