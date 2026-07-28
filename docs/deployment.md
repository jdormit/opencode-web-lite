# Deployment

## Bun target

Build and run with the pinned Bun version:

```sh
bun install --frozen-lockfile
bun run build
NODE_ENV=production PORT=3000 OPENCODE_WEB_PUBLIC_ORIGIN=https://code.example bun run server.ts
```

The server binds to `127.0.0.1` by default. This release has no application authentication, so it refuses a non-loopback bind. Put an authenticated, TLS-terminating reverse proxy on the same host when remote access is required. Set `OPENCODE_WEB_PUBLIC_ORIGIN` to the exact browser-facing HTTPS origin; this explicitly trusted value drives mutation, WebSocket, and HSTS checks. Forwarded headers are otherwise ignored.

The build writes separate browser and server artifacts under `dist/client` and `dist/server`. Vite writes a browser manifest and disables production source maps. Hashed assets use immutable one-year caching. Personalized HTML uses `private, no-store`.

## Health checks

- `GET /healthz` reports that the process can answer HTTP requests.
- `GET /readyz` returns `200` while the host accepts traffic and `503` while it stops.

Neither endpoint probes, identifies, or returns the configured OpenCode server. Monitor OpenCode separately.

The process handles `SIGTERM` and `SIGINT`: it marks readiness as stopping, stops accepting new connections, and drains active requests. Set the platform termination grace period above the longest allowed finite request. SSE and terminal clients reconnect after deployment.

## Reverse proxy

The proxy must support HTTP/1.1 WebSocket upgrades and must not buffer SSE.

Example nginx location settings:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Host 127.0.0.1:3000;
  proxy_set_header Origin $http_origin;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $connection_upgrade;
  proxy_buffering off;
  proxy_read_timeout 1h;
}
```

Preserve streaming responses instead of compressing or collecting them at the proxy. Allow long read timeouts for `/api/opencode/server/*/global/event` and terminal WebSockets. Keep ordinary request body limits conservative. Send the Bun listener authority in `Host`; configure the exact browser-facing authority through `OPENCODE_WEB_PUBLIC_ORIGIN`, and preserve the browser's `Origin` header. Bun rejects other direct authorities.

## Logs

The server writes one JSON line per completed HTTP response with `requestId`, method, coarse route template, status, duration, and failure category. It does not log query strings, request or response bodies, headers, server addresses, project paths, prompts, file content, or credentials. Send an 8-to-128-character `X-Request-ID` to correlate requests; invalid values are replaced.
