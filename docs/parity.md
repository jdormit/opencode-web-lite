# Parity status

The implementation targets the OpenCode 1.18.4 v1 HTTP API. `SPEC.md` remains the release authority. This page records cross-cutting differences that tests cannot make implicit.

| Area | Status | Remaining difference |
|---|---|---|
| Production SSR host and proxy | Implemented | Remote exposure still requires external authentication. |
| Health, readiness, request IDs, safe logs, shutdown | Implemented | OpenCode health is shown in the product, not readiness. |
| Browser matrix and accessibility automation | Implemented | Manual screen-reader and virtual-keyboard testing remains a release checklist item. |
| Deterministic v1 fixture | Implemented | It models supported client contracts, not every malformed upstream response. |
| Bundle and synthetic performance gates | Implemented | CI reports current medians; cross-run historical regression storage is not yet available. |
| Versioned bounded persistence policy | Implemented as a registry and migration boundary | Existing feature-local v1 storage will adopt the shared writer when those feature files are next changed. |
| Installable PWA shell | Implemented | No session data, API response, prompt, file, or terminal is available offline. |
| Terminal accessibility | Documented and automated around controls | xterm and full-screen terminal programs retain screen-reader limitations. |
| Multiple configured servers | Not implemented | The current deployment supports one configured server, so equal-ID isolation is covered at identity and fixture boundaries rather than an end-user switcher. |

The fixture includes 320 turns, 160 deterministic stream deltas, 100 files, a 20-file diff, pending permission and multi-step question requests, provider API-key and OAuth responses, one-use terminal tickets, mutable prompts and sessions, reconnect counters, and the same session ID for isolation tests.
