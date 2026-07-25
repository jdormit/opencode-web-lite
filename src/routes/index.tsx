import { Link, createFileRoute } from '@tanstack/react-router'

import { PageIntro } from '~/components/page-intro'
import { strings } from '~/lib/strings'

export const Route = createFileRoute('/')({
  head: () => ({ meta: [{ title: `Home | ${strings.productName}` }] }),
  component: Home,
})

function Home() {
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
          <span className="status-dot" aria-hidden="true" />
          <span>Not configured</span>
        </div>
        <h2 id="connection-title">One server. One clear path.</h2>
        <p>{strings.home.connectionPending}</p>
        <dl>
          <div>
            <dt>Default address</dt>
            <dd>localhost:4096</dd>
          </div>
          <div>
            <dt>Protocol</dt>
            <dd>OpenCode v1</dd>
          </div>
        </dl>
      </aside>
    </main>
  )
}
