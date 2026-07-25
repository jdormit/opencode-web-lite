# OpenCode Web Lite

This project is a fast, minimal, mobile-first OpenCode web client. Read `SPEC.md` before making product or architecture decisions.

## Technical Baseline

- Use TanStack Start, React, TypeScript, and Bun.
- Render useful initial route data with SSR.
- The browser talks only to this app's server. The app server proxies a configurable OpenCode server, which defaults to `http://localhost:4096`.
- Target OpenCode's v1 HTTP API first through `@opencode-ai/sdk/v2`. The package name is misleading; the newer `/api/*` protocol is out of initial scope.
- Prioritize small bundles, low interaction latency, simple UI, and deliberate mobile behavior.

## Reference Source

The official OpenCode source is available read-only at `~/opencode`. Use it to understand behavior and data contracts, not as an architecture to copy.

Start in these locations:

- `~/opencode/packages/app`: official Solid web client, including workflows, state behavior, and browser tests.
- `~/opencode/packages/session-ui`: message and tool rendering behavior.
- `~/opencode/packages/opencode/src/server`: v1 server routes and handlers.
- `~/opencode/packages/sdk/js`: v1 client types and generated SDK. Despite the `v2` export name, this is the initial API target described in `SPEC.md`.

Before implementing a feature, inspect its official UI flow, server endpoint and types, and relevant tests. Preserve useful behavior and edge cases, but do not copy Solid-specific providers, client-only startup assumptions, legacy layouts, or visual complexity. Never edit files under `~/opencode` as part of this project.
