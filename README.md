# OpenCode Web Lite

OpenCode Web Lite is a small, mobile-first web client for an OpenCode v1 server. The browser connects only to this app. The Bun server proxies approved OpenCode HTTP, Server-Sent Events (SSE), and terminal WebSocket requests.

## Develop

Requirements: Bun 1.3.14 and an OpenCode 1.18.4-compatible v1 server.

```sh
bun install --frozen-lockfile
bun run dev
```

The default OpenCode origin is `http://localhost:4096`. Set `OPENCODE_SERVER_URL` to another plain `http:` or `https:` origin. Use `OPENCODE_SERVER_USERNAME` and `OPENCODE_SERVER_PASSWORD` for Basic authentication. The app refuses plaintext credentials for a non-loopback OpenCode origin.

## Verify

```sh
bun run check
bun run test:performance
```

`check` runs TypeScript, unit and integration tests, a production build, Brotli bundle budgets, production-host tests, and the Chromium, Firefox, WebKit, Pixel 7, and iPhone 15 browser matrix. Browser and performance tests use the deterministic fixture in `tests/fixtures/mock-opencode.ts`.

See [Deployment](docs/deployment.md), [Security](docs/security.md), [Troubleshooting](docs/troubleshooting.md), and [Parity](docs/parity.md) before release.

## PWA scope

The Progressive Web App (PWA) installs a launchable shell. Its service worker caches only the generic offline page, manifest, and icons. It never caches personalized route HTML, OpenCode API responses, sessions, prompts, files, or terminal data. Offline agent work is not supported.
