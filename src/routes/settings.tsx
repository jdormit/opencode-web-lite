import { createFileRoute } from '@tanstack/react-router'

import { PageIntro } from '~/components/page-intro'
import { strings } from '~/lib/strings'

export const Route = createFileRoute('/settings')({
  head: () => ({ meta: [{ title: `Settings | ${strings.productName}` }] }),
  component: Settings,
})

function Settings() {
  return (
    <main id="main-content" className="workspace-shell">
      <PageIntro {...strings.settings} />
      <section className="settings-list" aria-label="Settings categories">
        <article>
          <p className="eyebrow">Connection</p>
          <h2>OpenCode server</h2>
          <p>The default connection will use http://localhost:4096.</p>
        </article>
        <article>
          <p className="eyebrow">Appearance</p>
          <h2>Color scheme</h2>
          <p>Choose System, Light, or Dark from the route bar.</p>
        </article>
      </section>
    </main>
  )
}
