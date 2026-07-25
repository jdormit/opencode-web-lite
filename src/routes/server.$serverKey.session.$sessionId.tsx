import { createFileRoute, notFound } from '@tanstack/react-router'

import { PageIntro } from '~/components/page-intro'
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
  head: ({ params }) => ({
    meta: [{ title: `${params.sessionId} | ${strings.productName}` }],
  }),
  component: Session,
})

function Session() {
  const { serverKey, sessionId } = Route.useParams()

  return (
    <main id="main-content" className="session-shell">
      <PageIntro
        eyebrow={strings.session.eyebrow}
        title={strings.session.loadingTitle}
        description={strings.session.description}
      />
      <dl className="identity-list">
        <div>
          <dt>Server</dt>
          <dd>{serverKey}</dd>
        </div>
        <div>
          <dt>Session</dt>
          <dd>{sessionId}</dd>
        </div>
      </dl>
    </main>
  )
}
