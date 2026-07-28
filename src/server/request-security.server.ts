import { getRequest } from '@tanstack/react-start/server'

export function assertSameOriginRequest(request: Request = getRequest()): void {
  const requestOrigin = new URL(request.url).origin
  const origin = request.headers.get('origin')
  if (origin) {
    if (origin === requestOrigin) return
    throw new Error('Cross-origin request rejected')
  }

  const referer = request.headers.get('referer')
  if (referer) {
    try {
      if (new URL(referer).origin === requestOrigin) return
    } catch {}
  }
  throw new Error('Cross-origin request rejected')
}
