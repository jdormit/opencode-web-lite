import handler, { createServerEntry } from '@tanstack/react-start/server-entry'

const baseSecurityHeaders = {
  'Cache-Control': 'private, no-store',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
} as const

export default createServerEntry({
  async fetch(request) {
    const nonce = crypto.randomUUID().replaceAll('-', '')
    const response = await handler.fetch(request, { context: { nonce } })
    const headers = new Headers(response.headers)

    for (const [name, value] of Object.entries(baseSecurityHeaders)) {
      headers.set(name, value)
    }

    if (process.env.NODE_ENV === 'production') {
      headers.set(
        'Content-Security-Policy',
        [
          "default-src 'self'",
          "base-uri 'none'",
          "connect-src 'self'",
          "font-src 'self'",
          "form-action 'self'",
          "frame-ancestors 'none'",
          "img-src 'self' data:",
          `script-src 'self' 'nonce-${nonce}'`,
          "style-src 'self'",
        ].join('; '),
      )
    }

    if (new URL(request.url).protocol === 'https:') {
      headers.set('Strict-Transport-Security', 'max-age=31536000')
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  },
})
