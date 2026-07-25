import { createFileRoute, notFound } from '@tanstack/react-router'

import { getSessionSnapshot } from '~/functions/session-snapshot'
import { strings } from '~/lib/strings'

const safeIdentifier = /^[A-Za-z0-9_-]{1,128}$/

export const Route = createFileRoute('/server/$serverKey/session/$sessionId')({
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
    return snapshot
  },
  head: ({ loaderData, params }) => ({
    meta: [{ title: `${loaderData?.title ?? params.sessionId} | ${strings.productName}` }],
  }),
  component: Session,
})

function Session() {
  const { serverKey, sessionId } = Route.useParams()
  const snapshot = Route.useLoaderData()

  return (
    <main id="main-content" className="session-shell">
      <header className="session-header">
        <p className="eyebrow">{strings.session.eyebrow}</p>
        <h1>{snapshot.title}</h1>
        <p>{snapshot.directory}</p>
      </header>
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
      <footer className="session-identity">
        <span>{serverKey}</span><span>{sessionId}</span>
      </footer>
    </main>
  )
}
