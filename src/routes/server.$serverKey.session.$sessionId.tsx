import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { getSessionSnapshot } from '~/functions/session-snapshot'
import { getComposerOptions } from '~/functions/composer-options'
import { SessionComposer } from '~/components/session-composer'
import { SessionRequests } from '~/components/session-requests'
import { strings } from '~/lib/strings'
import type { SessionSnapshot } from '~/lib/session-snapshot'

const safeIdentifier = /^[A-Za-z0-9_-]{1,128}$/

export const Route = createFileRoute('/server/$serverKey/session/$sessionId')({
  validateSearch: (search: Record<string, unknown>): { view?: 'changes' } =>
    search.view === 'changes' ? { view: 'changes' } : {},
  beforeLoad: ({ params }) => {
    if (
      !safeIdentifier.test(params.serverKey) ||
      !safeIdentifier.test(params.sessionId)
    ) {
      throw notFound()
    }
  },
  loader: async ({ params }) => {
    const snapshot = await getSessionSnapshot({
      data: { serverKey: params.serverKey, sessionID: params.sessionId },
    })
    if (!snapshot) throw notFound()
    const composer = await getComposerOptions({ data: { directory: snapshot.directory } }).catch(
      () => ({ agents: [], models: [] }),
    )
    return { snapshot, composer }
  },
  head: ({ loaderData, params }) => ({
    meta: [{ title: `${loaderData?.snapshot.title ?? params.sessionId} | ${strings.productName}` }],
  }),
  component: Session,
})

function Session() {
  const { serverKey, sessionId } = Route.useParams()
  const { composer, snapshot } = Route.useLoaderData()
  const view = Route.useSearch().view ?? 'chat'

  return (
    <main id="main-content" className="session-shell">
      <header className="session-header">
        <p className="eyebrow">{strings.session.eyebrow}</p>
        <h1>{snapshot.title}</h1>
        <p>{snapshot.directory}</p>
      </header>
      <nav className="session-destinations" aria-label="Session destinations">
        <Link to="." search={{}} aria-current={view === 'chat' ? 'page' : undefined}>Chat</Link>
        <Link to="." search={{ view: 'changes' }} aria-current={view === 'changes' ? 'page' : undefined}>
          Changes {snapshot.changesTotal ? `(${snapshot.changesTotal})` : ''}
        </Link>
      </nav>
      <SessionRequests
        key={`requests:${snapshot.permission?.id ?? ''}:${snapshot.question?.id ?? ''}`}
        serverKey={serverKey}
        directory={snapshot.directory}
        permission={snapshot.permission}
        question={snapshot.question}
        unavailable={snapshot.requestsUnavailable}
      />
      {view === 'chat' ? <>
      {snapshot.todosUnavailable ? <p className="history-note">Todos are temporarily unavailable.</p> : null}
      {snapshot.todos.length ? <TodoDock sessionId={sessionId} snapshot={snapshot} /> : null}
      <section className="timeline" aria-label="Session timeline">
        {snapshot.hasOlder ? <p className="history-note">Older messages are available.</p> : null}
        {!snapshot.items.length ? <p className="empty-copy">This session has no messages yet.</p> : null}
        {snapshot.items.map((item) => (
          <article className={`message message-${item.role}`} key={item.id}>
            <header>
              <h2>{item.role === 'user' ? 'You' : 'Assistant'}</h2>
              <time dateTime={new Date(item.createdAt).toISOString()}>
                {item.createdLabel}
              </time>
            </header>
            {item.error ? <p className="message-error">{item.error}</p> : null}
            {item.parts.map((part) =>
              part.type === 'text' ? (
                <p key={part.id}>{part.text}</p>
              ) : part.type === 'tool' ? (
                <div className="tool-summary" key={part.id}>
                  <strong>{part.title ?? part.name}</strong>
                  <span>{part.status}</span>
                </div>
              ) : (
                <p className="part-status" key={part.id}>{part.label}</p>
              ),
            )}
          </article>
        ))}
      </section>
      <SessionComposer
        key={`${serverKey}:${sessionId}`}
        serverKey={serverKey}
        sessionID={sessionId}
        options={composer}
        busy={snapshot.busy}
        blocked={Boolean(snapshot.permission || snapshot.question || snapshot.requestsUnavailable)}
      />
      </> : (
        <section className="changes-view" aria-labelledby="changes-heading">
          <h2 id="changes-heading">Changed files</h2>
          {snapshot.changesLimited ? <p className="history-note">Showing the first 40 changed files.</p> : null}
          {!snapshot.changes.length ? <p className="empty-copy">No session changes.</p> : null}
          {snapshot.changes.map((change) => (
            <details key={change.file}>
              <summary><strong>{change.file}</strong><span>{change.status} / +{change.additions} -{change.deletions}</span></summary>
              {change.patch ? <>
                {change.patchLimited ? <p className="history-note">This patch is truncated.</p> : null}
                <pre><code>{change.patch}</code></pre>
              </> : <p>{change.patchOmitted ? 'Patch omitted from the initial bounded view.' : 'Patch content is unavailable.'}</p>}
            </details>
          ))}
        </section>
      )}
      <footer className="session-identity">
        <span>{serverKey}</span><span>{sessionId}</span>
      </footer>
    </main>
  )
}

function TodoDock({ sessionId, snapshot }: { sessionId: string; snapshot: SessionSnapshot }) {
  const storageKey = `opencode-web-lite:todo-open:${sessionId}`
  const [open, setOpen] = useState(false)
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(storageKey) === 'true')
    } catch {
      setOpen(false)
    }
  }, [storageKey])
  const completed = snapshot.todos.filter((todo) => todo.status === 'completed').length
  const active = snapshot.todos.find((todo) => todo.status === 'in_progress')

  return (
    <details className="todo-dock" open={open} onToggle={(event) => {
      const next = event.currentTarget.open
      setOpen(next)
      try {
        localStorage.setItem(storageKey, String(next))
      } catch {
        // Persistence is optional when browser storage is unavailable.
      }
    }}>
      <summary>
        Todos ({completed}/{snapshot.todos.length}{snapshot.todosLimited ? '+' : ''})
        {active ? <small>{active.content}</small> : null}
      </summary>
      <ul>{snapshot.todos.map((todo, index) => (
        <li key={`${todo.content}-${index}`}><span>{todo.content}</span><small>{todo.status} / {todo.priority}</small></li>
      ))}</ul>
    </details>
  )
}
