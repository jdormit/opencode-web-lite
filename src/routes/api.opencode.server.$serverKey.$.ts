import { createFileRoute } from '@tanstack/react-router'
import { proxyOpenCodeRequest } from '~/server/opencode-proxy.server'

const handler = ({ request, params }: {
  request: Request
  params: { serverKey: string; _splat?: string }
}) => proxyOpenCodeRequest(request, params._splat, { serverKey: params.serverKey })

export const Route = createFileRoute('/api/opencode/server/$serverKey/$')({
  server: { handlers: { GET: handler, HEAD: handler, POST: handler, PUT: handler, PATCH: handler, DELETE: handler } },
})
