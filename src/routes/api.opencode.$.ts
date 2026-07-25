import { createFileRoute } from '@tanstack/react-router'

import { proxyOpenCodeRequest } from '~/server/opencode-proxy.server'

const handler = ({
  request,
  params,
}: {
  request: Request
  params: { _splat?: string }
}) => proxyOpenCodeRequest(request, params._splat)

export const Route = createFileRoute('/api/opencode/$')({
  server: {
    handlers: {
      GET: handler,
      HEAD: handler,
      POST: handler,
      PUT: handler,
      PATCH: handler,
      DELETE: handler,
    },
  },
})
