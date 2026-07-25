import { Link, createFileRoute, getRouteApi } from '@tanstack/react-router'

import { PageIntro } from '~/components/page-intro'
import { strings } from '~/lib/strings'

export const Route = createFileRoute('/')({
  head: () => ({ meta: [{ title: `Home | ${strings.productName}` }] }),
  component: Home,
})

function Home() {
  const { connection } = getRouteApi('__root__').useLoaderData()
  const connected = connection.state === 'connected'

  return (
    <main id="main-content" className="home-grid">
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
    </main>
  )
}
