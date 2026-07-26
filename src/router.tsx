import { createRouter } from '@tanstack/react-router'
import { getGlobalStartContext } from '@tanstack/react-start'
import { QueryClient } from '@tanstack/react-query'

import { routeTree } from './routeTree.gen'

export function getRouter() {
  const nonce = getGlobalStartContext()?.nonce
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        gcTime: 20 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  })

  return createRouter({
    routeTree,
    context: { queryClient },
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
