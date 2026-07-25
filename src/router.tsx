import { createRouter } from '@tanstack/react-router'
import { getGlobalStartContext } from '@tanstack/react-start'

import { routeTree } from './routeTree.gen'

export function getRouter() {
  const nonce = getGlobalStartContext()?.nonce

  return createRouter({
    routeTree,
    scrollRestoration: true,
    ssr: nonce ? { nonce } : {},
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
    server: {
      requestContext: { nonce: string }
    }
  }
}
