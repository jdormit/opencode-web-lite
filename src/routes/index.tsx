import { Link, createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { PageIntro } from '~/components/page-intro'
import { getHomeIndex } from '~/functions/home-index'
import { strings } from '~/lib/strings'
import { getNotificationStore } from '~/lib/notifications'

export const Route = createFileRoute('/')({
  loader: async () => {
    try {
      return await getHomeIndex()
    } catch {
      return {
        projects: [],
        sessions: [],
        projectsLimited: false,
        errors: { projects: true, sessions: true },
      }
    }
  },
  head: () => ({ meta: [{ title: `Home | ${strings.productName}` }] }),
  component: Home,
})

function Home() {
  const { connection } = getRouteApi('__root__').useLoaderData()
  const index = Route.useLoaderData()
  const router = useRouter()
  const sessionGroups = (['Today', 'Yesterday', 'Older'] as const)
    .map((label) => ({
      label,
      sessions: index.sessions.filter((session) => session.group === label),
    }))
    .filter((group) => group.sessions.length)
  const connected = connection.state === 'connected'
  const [unseenSessions, setUnseenSessions] = useState<Set<string>>(new Set())
  const [errorSessions, setErrorSessions] = useState<Set<string>>(new Set())
  const [unseenDirectories, setUnseenDirectories] = useState<Set<string>>(new Set())
  const [errorDirectories, setErrorDirectories] = useState<Set<string>>(new Set())
  const [requestSessions, setRequestSessions] = useState<Set<string>>(new Set())
  useEffect(() => {
    const store = getNotificationStore(connection.server.key)
    const update = () => {
      const unseen = store.getSnapshot().entries.filter((entry) => !entry.viewed)
      setUnseenSessions(new Set(unseen.map((entry) => entry.sessionID)))
      setErrorSessions(new Set(unseen.filter((entry) => entry.kind === 'error').map((entry) => entry.sessionID)))
      setRequestSessions(new Set(unseen.filter((entry) => entry.kind === 'request').map((entry) => entry.sessionID)))
      setUnseenDirectories(new Set(unseen.map((entry) => entry.directory)))
      setErrorDirectories(new Set(unseen.filter((entry) => entry.kind === 'error').map((entry) => entry.directory)))
    }
    update()
    return store.subscribe(update)
  }, [connection.server.key])

  return (
    <main id="main-content" className="home-page">
      <div className="home-grid">
        <section className="hero">
        <PageIntro {...strings.home} />
        <div className="action-row">
          <Link className="button-primary" to="/new">
            {strings.navigation.newSession}
          </Link>
          <Link className="button-secondary" to="/settings">
            Configure server
          </Link>
        </div>
        </section>
        <aside className="connection-panel" aria-labelledby="connection-title">
        <div className="status-line">
          <span className={`status-dot ${connected ? 'is-connected' : ''}`} aria-hidden="true" />
          <span>{strings.home.connection[connection.state]}</span>
        </div>
        <h2 id="connection-title">One server. One clear path.</h2>
        <p>
          {connected
            ? `OpenCode ${connection.version ?? ''} is ready.`
            : strings.home.connectionDescription[connection.state]}
        </p>
        <dl>
          <div>
            <dt>Default address</dt>
            <dd>
              {connection.server.url
                ? connection.server.url.replace(/^https?:\/\//, '')
                : 'Not configured'}
            </dd>
          </div>
          <div>
            <dt>Protocol</dt>
            <dd>{connected ? 'OpenCode v1' : 'Not detected'}</dd>
          </div>
        </dl>
        </aside>
      </div>
      <div className="home-index">
        <section aria-labelledby="projects-heading">
          <p className="eyebrow">Projects</p>
          <h2 id="projects-heading">
            {index.errors.projects
              ? 'Projects could not be loaded'
              : index.projects.length
                ? `${index.projects.length} known${index.projectsLimited ? ' (limited)' : ''}`
                : 'No projects yet'}
          </h2>
          <ul className="project-list">
            {index.projects.map((project) => (
              <li key={project.id}>
                 <strong>{project.name}</strong>
                 {unseenDirectories.has(project.directory) ? <small className="notification-badge">{errorDirectories.has(project.directory) ? 'Error' : 'New activity'}</small> : null}
                 <span>{project.directory}</span>
                 {unseenDirectories.has(project.directory) ? <button type="button" onClick={() => getNotificationStore(connection.server.key).clearDirectory(project.directory)}>Clear project alerts</button> : null}
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="recent-heading">
          <p className="eyebrow">Recent work</p>
          <h2 id="recent-heading">{index.errors.sessions ? 'Sessions could not be loaded' : 'Root sessions'}</h2>
          {index.errors.projects || index.errors.sessions ? (
            <button type="button" onClick={() => void router.invalidate()}>Retry</button>
          ) : null}
          {!index.errors.sessions && !index.sessions.length ? <p className="empty-copy">No sessions yet.</p> : null}
          {sessionGroups.map((group) => (
            <div className="session-group" key={group.label}>
              <h3>{group.label}</h3>
              <ol className="session-list">
                {group.sessions.map((session) => (
                  <li key={session.id}>
                    <Link
                      to="/server/$serverKey/session/$sessionId"
                      params={{ serverKey: connection.server.key, sessionId: session.id }}
                    >
                       <strong>{session.title}</strong>
                       {unseenSessions.has(session.id) ? <small className="notification-badge">{errorSessions.has(session.id) ? 'Error' : requestSessions.has(session.id) ? 'Waiting for you' : 'New activity'}</small> : null}
                       <span>{session.updatedLabel}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </section>
      </div>
    </main>
  )
}
