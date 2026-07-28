import { useDeferredValue, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { findSessionFiles, getSessionFile, getSessionFiles } from '~/functions/files'
import { FilePreviewCache, type FileEntry, type FilePreview } from '~/lib/files'
import { promptContextID } from '~/lib/prompt-context'
import { closeFileTab, getFileWorkspace, openFileTab, pinFileTab, reorderFileTab } from '~/lib/file-workspace'
import { writePersistentValue } from '~/lib/persistence'

const previewCache = new FilePreviewCache()

export function SessionFiles({ serverKey, sessionId, workspaceDirectory, changedPaths = {} }: { serverKey: string; sessionId: string; workspaceDirectory: string; changedPaths?: Record<string, string> }) {
  const workspace = getFileWorkspace(serverKey, workspaceDirectory)
  const workspaceState = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getServerSnapshot)
  const [directory, setDirectory] = useState('')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [tree, setTree] = useState<Record<string, FileEntry[]>>({})
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
        setTree((current) => ({ ...current, [directory]: value.entries }))
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
      workspace.update(openFileTab(workspace.getSnapshot(), path))
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const value = await getSessionFile({ data: { serverKey, sessionID: sessionId, path } })
      if (id !== openRequest.current) return
      previewCache.set(key, value)
      setSelected(value)
      workspace.update(openFileTab(workspace.getSnapshot(), path))
    } catch {
      if (id === openRequest.current) setError('This file could not be previewed. It may be missing, too large, or inaccessible.')
    } finally {
      if (id === openRequest.current) setBusy(false)
    }
  }

  async function toggleDirectory(path: string) {
    const expanded = workspace.getSnapshot().expanded
    if (expanded.includes(path)) {
      workspace.update({ ...workspace.getSnapshot(), expanded: expanded.filter((item) => item !== path) })
      return
    }
    workspace.update({ ...workspace.getSnapshot(), expanded: [...expanded, path].slice(-200) })
    if (tree[path]) return
    try {
      const value = await getSessionFiles({ data: { serverKey, sessionID: sessionId, path } })
      setTree((current) => ({ ...current, [path]: value.entries }))
    } catch { setError(`The directory ${path} could not be loaded.`) }
  }

  useEffect(() => {
    if (workspaceState.active && selected?.path !== workspaceState.active) void openFile(workspaceState.active)
  // The active workspace tab is the source of truth when sessions switch.
  }, [workspaceState.active])

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
        <FileTree entries={tree[''] ?? entries} tree={tree} expanded={workspaceState.expanded} changedPaths={changedPaths} onDirectory={(path) => void toggleDirectory(path)} onOpen={(path) => void openFile(path)} />
        {listLimited ? <p className="history-note">Showing the first 200 entries.</p> : null}
        <div className="file-editor">
          {workspaceState.tabs.length ? <div className="file-tabs" role="tablist" aria-label="Open files">{workspaceState.tabs.map((tab) => <div key={tab.path}><button type="button" role="tab" aria-selected={workspaceState.active === tab.path} onClick={() => void openFile(tab.path)}>{tab.path}{tab.pinned ? '' : ' (preview)'}</button>{!tab.pinned ? <button type="button" onClick={() => workspace.update(pinFileTab(workspace.getSnapshot(), tab.path))}>Pin</button> : null}<button type="button" aria-label={`Move ${tab.path} left`} onClick={() => workspace.update(reorderFileTab(workspace.getSnapshot(), tab.path, -1))}>←</button><button type="button" aria-label={`Move ${tab.path} right`} onClick={() => workspace.update(reorderFileTab(workspace.getSnapshot(), tab.path, 1))}>→</button><button type="button" aria-label={`Close ${tab.path}`} onClick={() => workspace.update(closeFileTab(workspace.getSnapshot(), tab.path))}>×</button></div>)}</div> : null}
          {selected ? <FilePreviewPanel key={selected.path} storageKey={`opencode-web-lite:file-comments:v1:${serverKey}:${workspaceDirectory}:${selected.path}`} preview={selected} initialScroll={workspaceState.tabs.find((tab) => tab.path === selected.path)?.scrollTop ?? 0} onScroll={(scrollTop) => workspace.update({ ...workspace.getSnapshot(), tabs: workspace.getSnapshot().tabs.map((tab) => tab.path === selected.path ? { ...tab, scrollTop } : tab) })} onRefresh={() => void openFile(selected.path, true)} /> : <p className="empty-copy">Choose a file to preview it.</p>}
        </div>
      </div>
    </section>
  )
}

function FileTree({ entries, tree, expanded, changedPaths, onDirectory, onOpen, depth = 0 }: { entries: FileEntry[]; tree: Record<string, FileEntry[]>; expanded: string[]; changedPaths: Record<string, string>; onDirectory: (path: string) => void; onOpen: (path: string) => void; depth?: number }) {
  return <ul className="file-list" style={{ '--file-depth': depth } as React.CSSProperties}>{entries.map((entry) => {
    const open = entry.type === 'directory' && expanded.includes(entry.path)
    return <li key={entry.path}><button type="button" aria-expanded={entry.type === 'directory' ? open : undefined} onClick={() => entry.type === 'directory' ? onDirectory(entry.path) : onOpen(entry.path)}>
      <span aria-hidden="true">{entry.type === 'directory' ? open ? '−' : '+' : '#'}</span><span>{entry.name}</span><small>{changedPaths[entry.path] ?? entry.type}{entry.ignored ? ' / ignored' : ''}</small>
    </button>{open ? <FileTree entries={tree[entry.path] ?? []} tree={tree} expanded={expanded} changedPaths={changedPaths} onDirectory={onDirectory} onOpen={onOpen} depth={depth + 1} /> : null}</li>
  })}</ul>
}

function FilePreviewPanel({ preview, storageKey, initialScroll, onScroll, onRefresh }: { preview: FilePreview; storageKey: string; initialScroll: number; onScroll: (value: number) => void; onRefresh: () => void }) {
  const previewRef = useRef<HTMLPreElement>(null)
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
  useEffect(() => { if (previewRef.current) previewRef.current.scrollTop = initialScroll }, [initialScroll])
  useEffect(() => {
    if (!commentsLoaded) return
    writePersistentValue(localStorage, storageKey, JSON.stringify(comments), 'session-ui')
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
    {preview.type === 'binary' ? <p>Binary files cannot be previewed as text.</p> : <pre ref={previewRef} onScroll={(event) => onScroll(event.currentTarget.scrollTop)}><code>{preview.content}</code></pre>}
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
