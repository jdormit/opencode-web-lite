import { createFileRoute } from '@tanstack/react-router'

import { PageIntro } from '~/components/page-intro'
import { strings } from '~/lib/strings'

export const Route = createFileRoute('/new')({
  head: () => ({ meta: [{ title: `New session | ${strings.productName}` }] }),
  component: NewSession,
})

function NewSession() {
  return (
    <main id="main-content" className="workspace-shell">
      <PageIntro {...strings.newSession} />
      <section className="placeholder-surface" aria-label="Session composer placeholder">
        <div className="placeholder-line short" />
        <div className="placeholder-line" />
        <p>Connect a server before starting a session.</p>
      </section>
    </main>
  )
}
