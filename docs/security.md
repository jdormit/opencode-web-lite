# Security

## Boundary

Treat this as a single-user application. The browser can call only same-origin app endpoints. The app proxies an allowlisted set of OpenCode v1 paths to the configured server and adds credentials on the server side. A browser request cannot choose another upstream origin.

Do not expose the Bun listener directly to a network. This release does not include app authentication or cross-site request forgery protection for remote users. Use an authenticated TLS reverse proxy and keep Bun on loopback.

## Secrets

Provide OpenCode credentials through `OPENCODE_SERVER_USERNAME` and `OPENCODE_SERVER_PASSWORD`. They remain process memory and must be provided again after restart. The app has no encrypted persistent credential store yet.

Never put credentials in `OPENCODE_SERVER_URL`, a route, query string, browser storage, screenshot, or support bundle. Request logs deliberately omit those values. Terminal WebSockets use short-lived, one-use tickets; durable Basic credentials are attached only to the server-to-server connection.

## Browser policy

Production HTML sets a nonce-based Content Security Policy, denies framing, disables camera, location, and microphone access, uses `nosniff` and `no-referrer`, and sends HTTP Strict Transport Security on HTTPS requests. Static assets also receive the host security headers. The PWA service worker bypasses every `/api/` request and does not cache personalized pages.

Run `bun run check` before deployment. Browser checks scan rendered HTML, URLs, console errors, history-facing URLs, and browser storage for fixture secrets. These checks reduce risk but do not replace a deployment review.
