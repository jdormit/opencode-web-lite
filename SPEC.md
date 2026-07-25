# OpenCode Web Lite Specification

Status: Draft 0.2

Last updated: 2026-07-25

Reference implementation: `~/opencode/packages/app` at OpenCode `1.18.4`

## 1. Summary

OpenCode Web Lite is an alternate web client for OpenCode. It prioritizes fast initial rendering, low runtime overhead, a focused interface, and first-class use on phones without giving up the workflows available in the existing OpenCode client.

The application will use TanStack Start, React, and Bun with server-side rendering (SSR). The browser talks only to the Start server, which connects to a configurable OpenCode server. SSR renders bounded initial route data into the first response; live events, terminals, and browser-only behavior initialize after hydration.

This document defines the product, interaction, architecture, performance, security, accessibility, and delivery requirements. It is the baseline for implementation decisions and feature-parity tracking.

### 1.1 Normative language

- **Must** means the requirement is necessary for the stated release.
- **Should** means the requirement is expected unless implementation evidence supports a different choice.
- **May** means the requirement is optional.

## 2. Product principles

The following principles are ordered. When requirements conflict, prefer the earlier principle.

1. **Fast by default.** Return useful HTML quickly, ship little JavaScript, avoid unnecessary work, and keep interaction latency low as sessions grow.
2. **Simple by design.** Show the controls needed for the current task. Put infrequent controls behind clear menus, dialogs, or progressive disclosure.
3. **Mobile first.** Design every flow for touch, narrow viewports, virtual keyboards, and safe areas before adapting it to larger screens.
4. **Faithful to OpenCode.** Preserve OpenCode's server protocol, session model, safety prompts, tools, and core workflows. Visual parity is not required; behavioral parity is.
5. **Direct and predictable.** Navigation, persistence, optimistic updates, reconnect behavior, and errors must be visible and understandable. Avoid hidden state changes.
6. **Accessible to everyone.** Keyboard, screen-reader, reduced-motion, zoom, contrast, and touch use are core behavior, not later enhancements.
7. **Progressive enhancement.** SSR must produce an understandable page before JavaScript runs. Live operation may require JavaScript, but failure to hydrate must not produce a blank screen.

## 3. Goals and non-goals

### 3.1 Goals

- Provide a fast, contentful SSR response for every route.
- Connect the Start server to configurable local or remote OpenCode servers.
- Support the complete session workflow: create, prompt, stream, inspect tools, answer requests, review changes, use files, and use terminals.
- Reach behavioral feature parity with the current OpenCode web client in deliberate phases.
- Remain responsive with long sessions, rapid streaming, large projects, and multiple open tabs.
- Provide a coherent mobile information architecture rather than shrinking a desktop layout.
- Keep the initial client bundle and dependency surface small.
- Preserve user state across reloads without treating browser storage as authoritative data.
- Make security boundaries clear when handling server addresses, credentials, permissions, OAuth, terminals, and external links.

### 3.2 Non-goals

- Pixel-for-pixel reproduction of the existing client.
- Running the OpenCode backend inside the web application.
- Full use of an OpenCode session with JavaScript disabled. The no-JavaScript experience is an informative, contentful shell and recovery path.
- SSR of event streams, terminal sessions, browser-local files, or other live browser-lifetime state.
- Shipping desktop-native behavior such as native titlebars, app updates, WSL management, native file reveal, or renderer log export in the initial web release.
- Supporting the existing client's legacy visual layout or URL format. User workflows are in scope; its UI and routes are not.
- Offline session access or agent execution. A later PWA only needs an installable application shell.

## 4. Users and primary jobs

### 4.1 Primary users

- A developer using OpenCode on the same computer through `localhost`.
- A developer reaching an OpenCode server on another computer, development environment, or private network.
- A developer checking progress, answering a permission or question, reviewing changes, or sending a follow-up from a phone.
- A power user moving between many projects, sessions, servers, files, and terminals with a keyboard.

### 4.2 Primary jobs

1. Connect to an OpenCode server and understand its health.
2. Find or add a project.
3. Start a session with the intended agent and model.
4. Send prompts, commands, files, and code context.
5. Follow streaming progress without losing reading position.
6. Inspect tool activity and errors.
7. Answer permission requests and agent questions safely.
8. Review changed files and add line-specific context.
9. Use a project terminal without leaving the session.
10. Return to an existing session and recover the previous view.

## 5. Release scope

Feature parity will be delivered in stages. A stage may ship only when its acceptance criteria and the cross-cutting quality gates in this document pass.

### 5.1 Foundation

- TanStack Start application shell and deployment target.
- SSR document, typed routes, error boundaries, color scheme, and hydration.
- Same-origin OpenCode proxy and browser-safe persistence.
- OpenCode v1 SDK integration, finite bootstrap, and one live event stream per server.
- Connection and reconnect states.
- Mobile navigation shell and desktop adaptation.
- Automated unit, integration, browser, accessibility, and performance tests.

### 5.2 Minimum useful product

- One configured HTTP OpenCode server. All identifiers and caches are server-scoped from the start so multi-server support does not require a data migration.
- Project selection and addition.
- Session list, search, creation, opening, rename, and archive/delete.
- Streaming timeline with common tool renderers.
- Composer with model, explicit agent selection, normal prompts, shell mode, history, stop, and steering messages.
- Permissions, questions, todos, errors, and reconnect behavior.
- Basic changed-file review.
- Persistent drafts, navigation, and user preferences.

### 5.3 Web parity

- Multiple top-level tabs and recently closed tabs.
- Rich attachment and mention workflows.
- Full tool renderer parity, child sessions, undo/redo, fork, compact, and sharing.
- Full files, diffs, line comments, contextual prompt items, and review modes.
- Multi-terminal support and persistent terminal state.
- Providers, models, servers, appearance, notifications, sounds, and shortcuts settings.
- Command palette and complete keyboard command set.
- Multiple servers and project grouping.

### 5.4 Later platform parity

- Basic installable progressive web app (PWA) support. Offline session data and offline agent operation are not required.
- Optional SSH or other proxy connections when the deployment provides a safe transport.
- Host adapters for desktop-only capabilities if this client is later embedded in a desktop shell.

### 5.5 Deployment model

The initial product is a single-user Bun web application. The browser connects only to the TanStack Start server. The Start server connects to a configurable OpenCode server URL and proxies HTTP, event-stream, and terminal WebSocket traffic.

- The OpenCode URL may use any valid `http:` or `https:` origin, including a non-default port, localhost, or a private-network address.
- The default OpenCode URL is `http://localhost:4096`.
- The Start server stores OpenCode credentials and never returns them to the browser after submission.
- The Start server binds to loopback by default. Exposing it to a network requires application authentication and an explicit listen-address configuration.
- Proxy requests may target only a saved OpenCode connection. A browser request cannot provide an arbitrary per-request target URL.
- This same-origin browser architecture avoids OpenCode CORS, mixed-content, and Private Network Access dependencies.

## 6. Information architecture and routes

The route tree must be static and typed. A persisted preference must not add or remove route definitions.

| Route | Purpose | SSR behavior |
|---|---|---|
| `/` | Projects, recent sessions, and connection state | Render theme, connection state, and bounded initial home data |
| `/new` | New-session draft | Render draft shell; resolve browser-persisted draft after hydration |
| `/server/$serverKey/session/$sessionId` | Canonical session | Validate parameters and render the initial session data through SSR |
| `/settings` | Settings | Render settings and connection-management shell |

### 6.1 Route requirements

- `serverKey` must be a canonical URL-safe encoding of a stable, non-secret server connection key.
- Credentials must never appear in a path, search parameter, fragment sent to the server, loader response, or rendered HTML.
- Session URLs must remain stable across project renames and tab changes.
- Invalid route parameters must return a clear route error and an appropriate HTTP status.
- A direct session URL must work after reload.
- Draft URLs need not be portable between browsers. A missing draft must recover to a new empty draft or home with a clear explanation.
- Search parameters must be schema-validated and canonicalized.

## 7. Application shell and navigation

### 7.1 Mobile shell

The mobile shell must optimize for one task at a time.

- The main session view shows the timeline and composer.
- A compact route bar exposes Back, project/session identity, status, and an overflow menu.
- Primary session destinations are **Chat**, **Changes**, **Files**, and **Terminal**.
- Destinations may use a bottom bar, compact tab row, or sheet according to available height. The design must account for safe-area insets.
- The virtual keyboard must not hide the active composer, question, permission, or terminal input.
- Side panels become full-width views, drawers, or sheets. They must not create a squeezed multi-column layout.
- Back navigation first closes the topmost sheet/dialog, then returns to the previous in-app view, then follows browser history.

### 7.2 Desktop shell

- The timeline remains the primary surface.
- A resizable secondary panel may show Changes, Files, Context, or Terminal.
- Terminal and review may be stacked or side by side when the viewport allows it.
- Open sessions and drafts may appear in a compact, horizontally scrollable tab strip.
- Panel state must be preserved per server or session at the narrowest meaningful scope.

### 7.3 Top-level tabs

- Desktop and tablet layouts support session and unsaved draft tabs.
- Add, select, close, reorder, and reopen recently closed session tabs.
- Closing the active tab selects the tab to its right, otherwise the tab to its left, otherwise Home, without a blank frame.
- A draft becomes a real session tab atomically after successful session creation.
- Tabs must carry server identity so equal session IDs on different servers cannot collide.
- Same-workspace session switches must preserve terminal and file state.
- Browser history and tabs must agree. A route is always deep-linkable even when it was not already open as a tab.
- Phones must not show a compressed top-level tab strip. They use a readable session switcher that shows session titles and status in a full-width list or sheet.

## 8. Functional requirements

### 8.1 Server connections

- Add, edit, remove, select, label, and choose a default HTTP server.
- Normalize URLs and prevent accidental duplicates.
- Show connection state, health, protocol version, server version when available, and authenticated username when applicable.
- Target the legacy v1 API used by `@opencode-ai/sdk/v2`. The SDK name is historical and does not mean the current `/api/*` protocol.
- Probe `/global/health` with a bounded timeout. A missing or incompatible v1 endpoint produces an unsupported-server error.
- Support OpenCode Basic authentication through the Start server.
- Keep credentials in server-side session or encrypted server-side storage; never return stored credential values to the browser.
- Show a useful connection screen when the default server is unavailable. It must support retry, edit, and choosing another server.
- During the minimum product, use one reconnect loop and one global event stream for the selected server. At web parity, keep one stream for every configured server with an open tab, active operation, or enabled background notifications; suspend other server streams after an idle grace period.
- Use exponential backoff with full jitter, starting near 500 ms and capped at 30 seconds.
- Refresh finite state after reconnect without duplicating or reordering events.
- Warn before sending credentials to a non-loopback server over plain HTTP.

### 8.2 Projects

- Show projects grouped by server when more than one server is configured.
- Add one or more directories through a server-backed directory picker.
- Remember the last project used on each server.
- Search and select projects quickly on mobile and desktop.
- Reorder projects and support touch-safe drag activation. An accessible non-drag reorder control must also exist.
- Edit project name and visual identity when the server supports it.
- Close and reopen recently closed projects.
- Show working, waiting, unread, and error status at project level.
- Clear project notifications explicitly.
- Native file reveal is optional and hidden when the host does not support it.

### 8.3 Session index

- List root sessions for the selected project or selected server scope.
- Group recent sessions by Today, Yesterday, and Older.
- Show title, project/worktree, relative update time, open state, unread state, active work, waiting requests, and errors.
- Search asynchronously by title and relevant metadata.
- Support keyboard selection and touch without hover-only actions.
- Opening with a modifier or middle click may open in the background on desktop.
- Prefetch only the first two likely next sessions and their first message pages.
- The minimum product requests a bounded recent index for the selected project and displays at most 64 root sessions.
- A server-wide or multi-project index is complete only when the server API can filter root, non-archived sessions and order them by update time. Without that capability, query projects separately within a bounded concurrency and page limit, label results as limited, and offer project selection. Never scan the full server session table automatically.
- Paginate or virtualize large result sets. Rendering limits do not replace network and memory limits.

### 8.4 Session lifecycle

- Create a session in the selected project and optional worktree.
- Create an optional worktree before creating the session.
- List available project worktrees and clearly identify the current worktree.
- Reset or remove a worktree only when the connected protocol exposes that operation. Confirm removal and explain what local changes will be lost.
- If worktree creation succeeds but session creation fails, retain and identify the worktree so the user can retry or remove it; do not leak an invisible worktree.
- Rename, archive, delete, fork, share, compact, interrupt, undo, and redo when supported.
- Navigate from a child/subagent session to its parent and from task activity to its child session.
- Remove or update tabs when a session or server disappears.
- Confirm destructive actions whose effects are not easily reversible.
- Missing or inaccessible sessions must show the server and session identity, a retry action, and a close-tab action.

### 8.5 Composer

- Use a multiline editor that handles input method editors, selection, paste, undo, spellcheck, and mobile autocorrect correctly.
- On hardware-keyboard layouts, Enter sends and Shift+Enter inserts a newline. Key repeat must not send duplicates.
- On touch/mobile layouts, Enter inserts a newline and only the send control submits the prompt.
- The send control becomes Stop while the current session is running.
- Escape and `Ctrl+G` stop a running session when focus context permits.
- Preserve drafts per tab and restore them after reload.
- Keep separate prompt histories for normal and shell modes.
- Up/Down browse history only when the caret is at a valid boundary.
- `!` at the beginning enters shell mode. Escape or Backspace from an empty shell prompt exits it.
- Submitting while the agent is busy sends a steering message immediately, matching the current official client behavior.
- Optimistic user messages must roll back or enter an explicit failed state when submission fails.
- Submission must be idempotent from the user's perspective.

### 8.6 Models and agents

- Populate direct agent selection from the directory-scoped `Agent.Info[]` returned by the OpenCode v1 `/agent` endpoint. Use each returned agent's `name`; do not hardcode an agent registry in the client.
- Include every non-hidden agent whose `mode` is `primary` or `all`. Exclude agents whose mode is `subagent` from direct session selection.
- Preserve the server's ordering. It places the configured default first, or Build first when no default is configured.
- Show the selector whenever at least two selectable agents exist. Do not hide it merely because all returned agents are built in.
- Build and Plan are built-in primary agents named `build` and `plan`, but either may be disabled, hidden, renamed, or reconfigured. Show them only when they appear in the server response.
- Custom agents with `mode: "primary"` or `mode: "all"` appear in the same selector. Agents with `mode: "all"` may also appear in `@` mentions.
- If the selected agent disappears after a configuration refresh, select the first eligible agent returned by the server and tell the user. If no eligible agent remains, disable prompt submission and show a configuration error.
- When Plan is present, describe it as planning-focused and edit-restricted, not as an absolute read-only sandbox.
- Select a model and model variant from the composer alongside the agent.
- Search models and group them by provider.
- Show the provider, capability-relevant metadata, and current selection clearly.
- Persist model visibility, recent models, selected variants, and workspace selection.
- Provide keyboard commands to choose/cycle models, variants, and agents.
- If a saved model is unavailable, explain the fallback rather than changing it silently.

### 8.7 Mentions and slash commands

- `@` suggestions include agents, project files/directories, recent files, references, and Model Context Protocol (MCP) resources.
- Mentions must become structured request parts, not ambiguous plain text.
- `/` suggestions include built-in commands, server commands, skills, and MCP commands.
- Suggestions support search, keyboard navigation, touch selection, loading, no-result, and error states.
- The selected suggestion must insert without losing surrounding text or caret position.

### 8.8 Attachments and context

- Attach multiple supported files from a browser file input.
- Support images, PDFs, and text-like files. Reject unsupported binary files before submission with a clear reason.
- Paste clipboard images/files where browser APIs permit it.
- Drag local files onto the composer on pointer-capable devices.
- Drag project files from the file tree into the composer as structured mentions.
- Show image previews and compact cards for other attachments, with filename, type, size when known, and remove action.
- Never upload an attachment until the user submits, unless the protocol requires an explicit staged upload that the UI discloses.
- Initially accept at most 10 attachments, 10 MiB per attachment, and 25 MiB total source bytes per prompt. A server-advertised lower limit takes precedence. Reject before reading the full file when browser metadata already exceeds a limit.
- Do not base64-encode attachments for persistence. Persist recoverable browser file handles or bounded blobs only when the user grants and the browser supports it; otherwise preserve prompt text and show that attachments must be reselected after reload.
- Attachment decoding and request construction must not create more than one full-size in-memory copy beyond unavoidable protocol encoding. If the protocol requires base64, account for its expansion against the request limit and perform conversion off the main interaction path.
- Add selected file or diff lines and line comments as structured prompt context.
- Selecting a context item reopens the corresponding file or diff location.
- Context items remain removable independently of editor text.

### 8.9 Message timeline

- Render user content, assistant Markdown, reasoning summaries, tool calls, attachments, errors, retries, compaction/interruption markers, and turn-level diff summaries.
- Stream text without replacing the entire timeline or causing visible reflow.
- Virtualize long timelines and cache measured row heights.
- Load older history near the top and preserve the reader's visual anchor when prepending it.
- Follow new content only while the user is at the end. Wheel, touch, pointer, selection, or keyboard scrolling must pause following.
- Show a Jump to latest control while the reader is away from the end.
- Preserve scroll position per session across tab switches and reloads.
- Provide copy actions for messages and assistant responses.
- Provide message-level revert where supported, with a visible restoration path.
- Announce completion, errors, and requests accessibly without reading every streamed token through a live region.

### 8.10 Tool rendering

The client must provide intentional renderers for these standard tools:

- `read`, `list`, `glob`, and `grep`
- `webfetch` and `websearch`
- `task`
- `bash` or `shell`
- `edit`, `write`, `patch`, and `apply_patch`
- `todowrite`
- `question`
- `skill`

Tool behavior must include:

- Pending, running, completed, and error states.
- Expand/collapse state that remains stable while output streams.
- Generic rendering for unknown and MCP tools.
- Dedicated, expandable error presentation.
- Grouping adjacent context-gathering tools into a compact summary.
- Shell output with ANSI handling, copying, bounded scroll regions, and optional default expansion.
- Edit/write/patch output with file identity, additions/deletions, diagnostics, and lazy rich diffs.
- Task tools linked to child sessions with agent identity and progress.
- Active todos shown in the composer dock rather than duplicated as noisy timeline cards.
- Interactive questions shown in the question dock while pending and as completed timeline output afterward.

### 8.11 Permissions

- Permission requests take precedence over the normal composer and remain visible until resolved.
- Show the requesting tool, operation, paths/patterns, and risk-relevant detail.
- Provide **Deny**, **Allow once**, and **Always allow** only when the server supports those scopes.
- Disable duplicate actions while a response is pending.
- An always-allow choice must state its scope, persistence, and revocation path.
- Persisted auto-accept must be scoped by server and directory or session; it must never cross servers.
- Enabling broad auto-accept requires confirmation.
- Auto-accept state must be visible and quickly revocable from the session.
- Failed responses remain actionable and display an error.

### 8.12 Questions

- Support one or several questions in one request.
- Support radio choices, multi-select choices, descriptions, and custom free-text answers.
- Preserve incomplete answers while navigating questions or temporarily minimizing the dock.
- Support Back, Next, direct step navigation, Submit, and Reject.
- Provide complete keyboard navigation without trapping focus.
- Failed replies remain intact and can be retried.

### 8.13 Todos and reverts

- Show todo progress and the active item in a compact dock.
- Expand to show pending, in-progress, completed, and cancelled items.
- Preserve collapsed state per session.
- Show reverted messages with individual restoration controls.
- Docks must have a deterministic priority and must not obscure permission or question requests.

### 8.14 Files

- Browse the full project tree and a changed-files tree.
- Show added, deleted, modified, and renamed states.
- Expand directories lazily and invalidate changed nodes from server events.
- Search files asynchronously with keyboard and touch selection.
- Limit and paginate results to prevent large project searches from blocking the UI.
- Click/tap previews a file; an explicit action pins it as an open file tab.
- Support preview and permanent file tabs, close, reorder, and active-file restoration.
- Cache file content within explicit entry and byte limits.
- Persist file scroll and selection positions where useful.
- Display binary, missing, too-large, and permission-denied states clearly.

### 8.15 Changes, diffs, and comments

- Support working tree, branch, and current-turn change scopes when available.
- Show changed-file count and aggregate additions/deletions.
- Support unified diff everywhere and split diff on viewports where it remains readable.
- Mobile Changes must use unified diffs.
- Virtualize or incrementally render large diffs.
- Fetch detailed diff content only when the summary or selected file needs it.
- Preserve the active review file, scope, expanded paths, and diff style per session.
- Select file or diff line ranges and add them to the prompt.
- Add, edit, and delete comments tied to a file, side, and line range.
- Comments are local prompt context unless the OpenCode protocol later defines shared review comments.
- Turn summaries initially show a bounded number of files with Show all and Show less controls.

### 8.16 Terminal

- Create a project PTY when the terminal opens and none exists.
- Support multiple terminal tabs, create, close, select, rename where supported, and reorder.
- Preserve PTYs across same-workspace session switches.
- Connect through the server's ticket-authenticated WebSocket endpoint.
- Do not put durable credentials in a WebSocket URL.
- Support input, selection, copy, paste, modifier-click links, theme changes, resize synchronization, and reconnect recovery.
- Constrain the mobile terminal to the usable visual viewport and keep its input visible above the virtual keyboard.
- Allow the terminal panel to resize and collapse with an accessible non-drag alternative.
- Restore bounded terminal buffer, cursor, dimensions, and scroll state when practical.
- Show disconnected, reconnecting, exited, and stale-PTY states explicitly.

### 8.17 Sharing

- Hide sharing when disabled by server configuration.
- Publish, copy URL, open externally, and unpublish.
- Show pending and error states for every operation.
- Existing shared sessions use Share to copy the current URL.
- External share links must be validated and opened with `noopener,noreferrer`.

### 8.18 Notifications

- Track completion and error notifications separately per server and session.
- Show unseen and error state at project, session-list, and tab levels.
- Mark notifications viewed when the relevant session is viewed or explicitly cleared.
- Ignore child-session completion notifications unless the parent needs attention.
- Support opt-in system notifications for completion, permissions, and errors.
- Support separately configurable sounds with a preview action.
- Do not request browser notification permission until a direct user action.
- Bound retained notifications by age and count.

### 8.19 Settings

Settings must include these sections:

- **General:** permission behavior, preferred shell, reasoning summaries, default tool expansion, mobile navigation position, and selected visibility options.
- **Appearance:** light/dark/system scheme, theme, interface font, code font, and terminal font.
- **Notifications:** completion, permission, and error notifications and sounds.
- **Servers:** connection management, health, labels, and default server.
- **Providers:** connected providers, credential source, connect/disconnect, OAuth/API-key flows, and custom OpenAI-compatible providers where supported.
- **Models:** search, provider grouping, and visibility toggles.
- **Shortcuts:** search, recording, conflict detection, clearing, and reset.

Settings must be searchable or shallow enough to scan on a phone. Desktop-only settings must not appear in the standalone web client.

### 8.20 Providers

- Show connected providers and whether their credentials come from environment, API key, config, or custom configuration.
- Environment-provided credentials cannot be disconnected in the client.
- Show recommended providers and an all-providers search.
- Support server-described API-key and OAuth connection methods.
- For OAuth, show the authorization URL, code entry or polling state, cancellation, timeout, and server errors.
- Support custom OpenAI-compatible provider ID, name, base URL, optional API key, models, and headers only when the protocol supports it.
- Never render or log existing secrets after submission.
- Validate external OAuth URLs against safe schemes before opening them.

### 8.21 Command palette and shortcuts

- `Mod+K` opens a global command palette.
- Commands include dynamic title, category, description, shortcut, disabled state, and contextual availability.
- Search commands, files, and sessions according to current route.
- Support recent items, loading, no-result, and error states.
- Keyboard navigation wraps predictably; Escape closes and restores focus.
- Normal shortcuts must not steal unmodified typing from editable controls.
- Provide commands for navigation, tabs, sessions, composer focus, models/agents, review, files, terminal, messages, MCP, sharing, and permission behavior.
- Support user shortcut overrides, conflict warnings, clear, and reset.
- Browser Back and Forward remain functional and have command equivalents.

### 8.22 System status and session context

- Provide a compact status surface for MCP servers, Language Server Protocol (LSP) servers, and legacy plugins where the protocol exposes them.
- MCP entries show connected, disabled, failed, authentication-required, and client-registration-required states.
- Connect, disconnect, and authenticate MCP servers when supported. Authentication must use the server's safe integration flow.
- LSP entries show identity and connected/error status.
- Plugin status is read-only.
- Session context shows current model/provider, token usage and breakdown, context-window usage, cost when supplied, and relevant timestamps.
- Context values must identify whether they are current, estimated, or unavailable.

## 9. UX states and feedback

Every asynchronous surface must define four states: initial/loading, success, empty, and error. Where stale content exists, keep it visible during refresh and label it when necessary instead of replacing it with a spinner.

### 9.1 Connection states

- Connecting
- Connected
- Reconnecting with attempt timing
- Offline
- Authentication failed
- Incompatible protocol
- Server unavailable
- Server removed

### 9.2 Session states

- Loading initial snapshot
- Streaming/working
- Waiting for permission
- Waiting for question answer
- Idle
- Interrupted
- Retry scheduled
- Failed
- Missing or deleted

### 9.3 Error handling

- Route, loader, application, and component errors require separate boundaries.
- User-facing errors must state what failed, whether work was preserved, and what action can recover.
- Preserve detailed error data behind a Copy details action.
- Do not expose credentials, authorization headers, prompt attachments, or private file contents in diagnostics by default.
- Fatal errors provide Reload, Return home, and Copy details. Log export appears only if a host implements it.
- Toasts are for brief confirmation or nonblocking failure. Requests requiring a decision belong in persistent docks or dialogs.

## 10. Visual and interaction design

### 10.1 Visual direction

- Use a restrained palette, strong typography, whitespace, and subtle boundaries rather than decorative cards around every region.
- The content, prompt, code, and current system state are the visual focus.
- Avoid permanent labels when an icon is conventional and has an accessible name, but do not trade clarity for icon density.
- Use motion only to explain state or spatial change.
- Keep elevation rare and reserve it for transient layers.
- Use one coherent visual language across Markdown, code, tools, files, diffs, and terminal chrome.

### 10.2 Responsive requirements

- Design and test at 320, 360, 390, 430, 768, 1024, and 1440 CSS pixels.
- The main mobile/desktop layout transition should occur near 768 px but content, not device labels, decides secondary breakpoints.
- No horizontal document overflow at any required width or 200% zoom.
- Primary touch targets must be at least 44 by 44 CSS pixels or have an equivalent hit area.
- Support portrait and landscape safe-area insets.
- Use dynamic viewport units with tested fallbacks.
- A virtual keyboard must not hide required controls.
- Hover may enhance an interaction but may not be the only way to discover or execute it.

### 10.3 Loading presentation

- SSR should render stable structure rather than a full-screen spinner.
- Skeletons must match final geometry closely enough to avoid layout shift.
- Avoid skeletons for actions whose availability is already known.
- Keep previous list/search results visible during a short refetch.
- Never flash content from the previously active session while navigating to another.

## 11. Accessibility

The target is WCAG 2.2 AA.

- Initial HTML must contain correct landmarks, heading structure, page title, `lang`, and `dir`.
- Every action must work with keyboard alone.
- Focus must be visible and have at least 3:1 contrast.
- Dialogs and sheets must trap focus while open, close with Escape when safe, and return focus to their trigger.
- Async updates must use restrained, deduplicated announcements.
- Streaming text must not announce each token. Announce important status changes and response completion.
- Text must meet 4.5:1 contrast and controls/non-text boundaries 3:1.
- The interface must remain usable at 200% zoom and a 320 CSS pixel viewport.
- Respect `prefers-reduced-motion` and remove nonessential animation.
- Support forced colors and high-contrast modes.
- Drag-and-drop operations require keyboard-accessible alternatives.
- Terminal accessibility limitations must be documented and controls around the terminal must remain accessible.
- Automated accessibility checks must report zero serious or critical violations on all core routes and decision flows.

## 12. Language

- The initial client supports US English only.
- User-facing strings should remain centralized enough to permit future translation, but no translation framework or locale bundles are required initially.
- Dates, numbers, and relative times use `Intl` with `en-US`.

## 13. Theming and fonts

- Support light, dark, and system color schemes.
- Resolve the initial scheme on the server from a cookie where possible.
- A small nonce- or hash-authorized preload may reconcile system preference before paint.
- No visible theme flash is allowed under a cold cache.
- Theme failure or blocked storage must not prevent rendering.
- Prefer system interface fonts for the initial release unless a bundled font materially improves the product.
- If fonts are bundled, subset them, use WOFF2, set `font-display`, and keep the initial font transfer within budget.
- Custom themes should be represented as validated design tokens. Do not inject arbitrary persisted CSS.

## 14. Technical architecture

### 14.1 Technology baseline

- TanStack Start
- React
- Bun as the development, build, test, and production runtime
- TypeScript with strict checking
- TanStack Router through Start's file-based routes
- TanStack Query for finite server state and loader hydration
- OpenCode JavaScript SDK and generated protocol types
- A small schema-validation library at external and persistence boundaries
- CSS with a minimal build-time approach; any utility framework must justify its runtime and output cost

Version choices must be pinned when the application is bootstrapped. This specification does not pin versions before implementation begins.

### 14.2 Rendering model

The TanStack Start server owns the OpenCode connection. SSR loaders fetch initial route data from OpenCode and render it directly into the first HTML response. This avoids waiting for hydration and a second browser request before showing useful content.

**Server request responsibilities:**

- Validate routes and search parameters.
- Resolve the color scheme and other server-known preferences.
- Render the document and stable application shell.
- Create request-scoped query and logging contexts.
- Fetch the bounded initial data needed by the requested route from the configured OpenCode server.
- Set security and cache headers.

**Client responsibilities after hydration:**

- Read and migrate non-secret browser persistence.
- Hydrate the server-rendered route data.
- Connect to the Start server's same-origin event endpoint and reconcile newer events with loader data.
- Initialize notifications, files, terminals, clipboard, drag/drop, and viewport observers.

### 14.3 OpenCode proxy

The browser never connects to OpenCode directly. The Start server provides same-origin HTTP, event-stream, and terminal WebSocket endpoints backed by the selected OpenCode connection.

- Server loaders may call the OpenCode SDK directly through a shared connection service.
- Browser API calls go to a namespaced Start server endpoint, which forwards only supported OpenCode requests to the selected saved origin.
- The Start server adds OpenCode authorization and directory context. It strips browser cookies and unrelated headers before forwarding.
- Event streams remain open between OpenCode and the Start server and between the Start server and browser. The proxy must not buffer events.
- Terminal WebSocket upgrades are proxied bidirectionally using short-lived OpenCode terminal tickets.
- Implement and verify a custom Bun server entry that gives the proxy access to `Bun.serve().upgrade()`. A standard Fetch-style TanStack Start route is not sufficient for WebSocket upgrades. This spike is a Foundation requirement.
- Changing the OpenCode URL is an authenticated configuration operation, not a URL supplied to each proxy request.
- Personalized HTML and loader responses use `Cache-Control: private, no-store`.

### 14.4 Data layers

Use four explicit layers:

1. **Loader data:** finite, request-scoped, serializable initial route data for HTML rendering and hydration.
2. **Query cache:** finite HTTP resources with server identity in every key.
3. **Live store:** normalized sessions, messages, parts, statuses, requests, todos, diffs, MCP, Language Server Protocol (LSP), and version-control events.
4. **Local UI state:** tabs, drafts, panel dimensions, scroll anchors, selections, preferences, and bounded terminal/file caches.

Do not put event streams, PTYs, DOM measurements, secrets, or large live message caches into dehydrated loader data.

### 14.5 Server and directory scope

- A stable connection key identifies each server but contains no secret.
- All caches, queries, events, notifications, and persistence include server scope.
- Directory/workspace stores are created lazily.
- Active stores may be pinned. Idle stores must be evicted with explicit count and time limits.
- Initial limits should match proven reference behavior unless measurement supports lower limits: at most 30 directory stores and a 20-minute idle lifetime.
- Session metadata and messages use separate bounded caches.
- Switching sessions in one workspace must not remount the workspace's terminal and file roots.

### 14.6 Event synchronization

- Maintain one global asynchronous event stream per connected server.
- Batch rapid events to animation-frame cadence.
- Coalesce consecutive text deltas and redundant updates.
- Maintain monotonic revisions or observed-at metadata so an older HTTP response cannot overwrite a newer streamed event.
- On reconnect, refresh global finite state and active directories, then resume events without duplicates.
- Stop or suspend streams during page lifecycle transitions and restore correctly from the back-forward cache.
- Stream failures must not destroy the last valid snapshot.
- At web parity, configured servers with enabled background notifications remain stream-pinned even when no tab is selected. Disabling background notifications allows an otherwise idle server stream to suspend.

### 14.7 State ownership

- URL state owns route identity and validated filters that should be shareable.
- Query state owns finite server resources.
- Live normalized state owns streamed OpenCode entities.
- Component state owns ephemeral interaction.
- Persistent local state owns user preferences and recoverable drafts.
- The server remains authoritative for projects, sessions, messages, permissions, questions, todos, files, diffs, PTYs, provider state, and configuration.

Avoid a monolithic global store. Expose narrow hooks/selectors so streaming one part does not rerender unrelated timeline rows or shell controls.

### 14.8 Persistence

- Use versioned server-side and browser-side persistence schemas and migrations.
- Separate global, window/tab, server, workspace, session, and draft scopes.
- Include server identity in every server-derived key.
- Persist only reconstructible UI state and user-authored unsent drafts.
- Local storage is acceptable for non-secret UI state and drafts. It is origin-scoped but is readable by any script running on that origin, so passwords, access tokens, OAuth codes, terminal tickets, and authorization headers must remain server-side.
- Persistent credentials require encrypted server-side storage with a key supplied outside that storage. Without an encryption key, credentials remain in the server process session and must be re-entered after restart.
- Enforce entry and byte limits for prompt, file, terminal, notification, and session caches.
- On quota failure, evict explicitly classified cache data before user-authored drafts or preferences.
- Surface unrecoverable draft persistence failure to the user.
- Server connections and global settings are server-side. Drafts, open tabs, panel state, and scroll state are browser-window state. Cross-tab live synchronization is not required initially.

### 14.9 Browser-only code

Browser APIs such as notifications, clipboard, file selection, drag/drop, viewport observers, and terminal rendering must load only in the browser. Desktop-only capabilities remain out of scope. A general cross-platform abstraction is not required unless a second host is actually added.

### 14.10 Code splitting

- The home shell and basic navigation form the initial client entry.
- Session timeline, Markdown highlighting, rich diff, terminal, provider dialogs, and settings sections load independently.
- Loading a session must not download terminal or provider-management code until needed.
- Avoid barrel imports that pull complete icon, editor, syntax, or component libraries into the initial chunk.
- Prefetch based on high-confidence intent, not every visible link.

### 14.11 OpenCode API target

- The initial client supports the v1 HTTP API selected by the official client against OpenCode 1.18.4.
- Use `@opencode-ai/sdk/v2` for this API despite the package's confusing name.
- The current `/api/*` v2 protocol is out of initial scope. It is still under migration and lacks some parity features, including sharing, full worktree lifecycle, and LSP status.
- Add v2 only after the initial client is stable or OpenCode makes v2 the primary complete protocol. That work requires a separate design update; the initial architecture does not include a capability registry or dual-protocol adapters.

## 15. Performance requirements

Performance is a release feature. CI must enforce stable synthetic budgets. The application does not collect production telemetry.

### 15.1 Web vitals

CI uses pinned Playwright Chromium on Linux x64, a 4x CPU slowdown, 150 ms round-trip latency, 1.6 Mbps download, 750 Kbps upload, an empty HTTP cache, and five runs after one discarded warm-up. The fixture contains 320 turns, 160 streamed deltas, 100 project files, and a 20-file diff. CI compares the median and records every run; a protected metric fails after a greater-than-10% regression and budget breach in two consecutive CI attempts.

Target synthetic medians:

| Metric | Budget |
|---|---:|
| Time to First Byte | 800 ms or less |
| First Contentful Paint | 1.8 s or less |
| Largest Contentful Paint | 2.5 s or less |
| Cumulative Layout Shift | 0.1 or less |
| Interaction to Next Paint | 200 ms or less |

### 15.2 Transfer budgets

Measure Brotli-compressed production output:

| Resource | Initial route budget |
|---|---:|
| JavaScript | 120 KiB or less |
| CSS | 35 KiB or less |
| Fonts | 150 KiB or less |
| Any lazy feature chunk | 100 KiB or less, with documented exceptions for terminal or syntax engines |

### 15.3 Runtime budgets

- No normal streaming long task may exceed 100 ms; p95 long-task duration should remain at or below 50 ms on the test profile.
- First visible session content appears within 1 second of client navigation when data is available.
- A hot tab switch reaches stable correct content within 150 ms.
- A cold tab switch reaches stable correct content within 500 ms after its data is available.
- No blank or wrong-session frame appears during navigation.
- A 320-turn timeline remains scrollable and correctly ordered.
- A test burst of 160 text deltas loses no data and keeps p95 animation-frame gaps at or below 50 ms under the documented throttle.
- File content cache stays at or below 20 MiB and 40 entries unless later profiling establishes stricter limits.
- Performance CI fails on a statistically filtered median regression above 10% for protected scenarios.

### 15.4 SSR content requirements

- The HTML response must contain the route's title, primary landmark, main heading or session identity placeholder, navigation, and meaningful connection/loading/error copy.
- At least 90% of above-the-fold static text must exist in server HTML.
- Hydration must emit zero warnings in tests.
- The color scheme must not visibly change during hydration.

## 16. Resilience and offline behavior

### 16.1 Reconnect

- Detect network loss and server-stream loss separately.
- Preserve the last valid UI while reconnecting.
- Retry with bounded exponential backoff and jitter.
- Provide an immediate Retry action.
- Reconcile current session, requests, todos, diffs, provider state, and project index after reconnect.
- Deduplicate repeated and out-of-order events.
- Restore within five seconds of a healthy network under test conditions.

### 16.2 Offline

- The initial release shows a clear disconnected state and preserves browser drafts, but it does not provide offline session access.
- A later basic PWA should install and launch the application shell. Caching session data and supporting offline mutations remain out of scope.
- Never imply that a prompt was sent while disconnected.

## 17. Security and privacy

### 17.1 Secrets

- Never serialize secrets into SSR HTML, loader payloads, logs, analytics, error reports, URLs, traces, screenshots, or browser storage.
- The Start server authenticates to OpenCode and keeps those credentials server-side.
- Browser sessions use HttpOnly, Secure, SameSite cookies when the application is exposed beyond loopback.
- Remove any one-time bootstrap credential from the URL before application initialization.
- Terminal authentication must use short-lived tickets.

### 17.2 Network boundaries

- A signed-in user may configure an arbitrary `http:` or `https:` OpenCode origin. Validate and normalize it before saving.
- The proxy may connect only to a saved origin and supported OpenCode paths; it must not act as a general-purpose URL fetcher.
- Protect connection changes from cross-site request forgery and require reauthentication when the application is exposed beyond loopback.
- Require secure transport for non-loopback production connections.
- Apply timeouts and response-size limits to probes and finite loaders.
- Treat all OpenCode server strings, Markdown, tool output, file content, ANSI data, and diff content as untrusted.

### 17.3 Browser security

Production responses must define:

- Content Security Policy with nonces or hashes and no unrestricted inline script.
- `frame-ancestors 'none'` or an explicitly documented embedding policy.
- `X-Content-Type-Options: nosniff`.
- Strict referrer policy.
- Explicit Permissions Policy.
- HSTS on HTTPS deployments.

External links must allowlist safe schemes and use `noopener,noreferrer`. Rendered Markdown must sanitize links and HTML. Custom theme input must be constrained to validated tokens.

### 17.4 Permission safety

- Always-allow decisions must disclose scope and remain revocable.
- Permission responses must be tied to server, directory, session lineage, and request ID as required by protocol.
- Stale requests must not remain actionable after reconnect reconciliation.
- Destructive session, project, provider, and share operations require appropriate confirmation.

### 17.5 Privacy

- Do not include product analytics or telemetry.
- Error reporting must scrub sensitive fields and allow the user to inspect copied diagnostics.

## 18. Testing strategy

### 18.1 Unit tests

Cover pure behavior including:

- route encoding and validation
- v1 connection health and error mapping
- event normalization, ordering, and coalescing
- session lineage and cycle detection
- cache eviction and persistence migration
- prompt request construction and optimistic rollback
- history and draft behavior
- permission scope matching
- search ranking
- responsive layout calculations
- terminal URL and ticket rules

### 18.2 Integration tests

Use a deterministic mock OpenCode server to test:

- finite bootstrap plus stream reconciliation
- reconnect and refresh
- supported v1 behavior
- session creation and draft promotion
- prompt, command, shell, stop, and steering messages
- permissions and questions
- file, diff, comment, and terminal APIs
- provider and OAuth states
- server removal and cross-server identity isolation

### 18.3 Browser tests

Run Playwright against Chromium, WebKit, and Firefox. Include at least one iPhone and one Android emulation profile.

Core journeys:

1. Connect a server, add a project, and create a session.
2. Stream a response with tool calls while scrolling away and back.
3. Send a steering message while a response is active.
4. Answer permissions and multi-step questions with keyboard and touch.
5. Review a diff, comment on lines, and add context to a prompt.
6. Open, resize, switch, reconnect, and close terminals.
7. Reload and restore route, draft, tabs, timeline position, and panels.
8. Switch between two servers with equal session IDs without state leakage.
9. Complete provider API-key and OAuth flows without exposing secrets.
10. Navigate all primary mobile views with the virtual keyboard open.

### 18.4 Accessibility tests

- Run automated axe checks on home, session, settings, server connection, provider auth, permission, question, file review, terminal shell, and fatal error states.
- Test full keyboard journeys and focus restoration.
- Test 200% zoom, reduced motion, and forced colors.
- Include screen-reader-oriented DOM assertions for status announcements and active-descendant widgets.

### 18.5 Performance and stability tests

- Use production builds, fixed fixtures, documented CPU/network profiles, and repeated trials.
- Track first navigation, home/session switches, streaming throughput, long tasks, frame gaps, layout shift, remount counts, and memory/cache bounds.
- Test narrow/wide resizing, history prepend, tool expansion mutation, image/diff loading, terminal visibility, review switching, and stream interruption.
- Preserve the useful benchmark and timeline-stability scenarios from the reference client while enforcing portable budgets.

### 18.6 Security tests

- Verify secrets never appear in URLs, history, storage, console output, server logs, traces, screenshots, rendered HTML, or error payloads.
- Verify unsafe external and Markdown links are blocked.
- Verify the proxy rejects unsaved destinations and unsupported paths.
- Verify Content Security Policy and other response headers.
- Verify stale permissions and expired terminal tickets cannot be reused.

## 19. Build, deployment, and operations

- Produce separate client and server artifacts and manifests.
- Pin the JavaScript runtime and package manager.
- Typecheck all source, tests, route definitions, and generated interfaces.
- Build reproducibly from a clean checkout.
- Report compressed chunk sizes in CI and reject budget violations.
- Never serve production source maps publicly. Keep them as private build artifacts only when needed for local debugging.
- Hash static assets and serve them with long immutable caching.
- Serve HTML with revalidation or no-cache semantics appropriate to user-specific preferences.
- Document the Bun deployment target before the first deploy.
- Document reverse-proxy behavior for streaming responses, Server-Sent Events, WebSockets, timeouts, and buffering.
- Provide health and readiness endpoints that do not expose configured OpenCode servers.
- Log request IDs, route templates, status, duration, and coarse failure categories without private content.

## 20. Data and cache limits

Initial limits should be conservative and configurable in code:

| Data | Initial limit |
|---|---:|
| Active directory stores | 30 |
| Idle directory lifetime | 20 minutes |
| Initial session message page | 20 messages |
| Older history page | 200 messages |
| Retained file content | 40 entries or 20 MiB |
| Retained prompt sessions | 20 |
| Retained terminal workspaces | 20 |
| Persisted session UI keys | 50 |
| Notifications | 500 entries and 30 days |

Limits must use least-recently-used or domain-aware eviction where appropriate. Pending permissions, active sessions, user drafts, and active workspace state must not be evicted as ordinary cache data.

## 21. Feature-parity matrix

This matrix tracks behavior, not visual structure.

| Area | Required parity | Target stage |
|---|---|---|
| HTTP servers | Add/edit/remove/default, health, auth, configurable v1 origin | Minimum useful product |
| Multiple servers | Grouped projects, scoped state, cross-server tabs | Web parity |
| Projects | Add/select/reorder/edit/close/reopen/status | Minimum useful product |
| Session index | Recent groups, search, status, background open | Minimum useful product |
| Session lifecycle | Create/rename/archive/delete/interrupt | Minimum useful product |
| Advanced lifecycle | Fork/compact/undo/redo/child navigation | Web parity |
| Composer | Prompt, shell, history, stop, steering, drafts | Minimum useful product |
| Composer context | Mentions, slash commands, files, clipboard, line context | Web parity |
| Models and agents | Server-provided primary/all-agent selection including Build/Plan when available, variants, search, persistence | Minimum useful product |
| Timeline | Streaming, Markdown, virtualization, history, anchoring | Minimum useful product |
| Tool renderers | Common tools and generic fallback | Minimum useful product |
| Rich tools | Complete renderer and child-session parity | Web parity |
| Permissions | Respond, auto-accept scope, persistence, safety | Minimum useful product |
| Questions | Multi-step, custom answers, minimize, keyboard | Minimum useful product |
| Todos/steering/reverts | Docks and active-session steering | Minimum useful product |
| Files | Tree, search, tabs, cache, scroll restoration | Web parity |
| Changes | Scopes, diff styles, large diffs, summaries | Web parity |
| Line comments | Add/edit/delete and prompt context | Web parity |
| Terminal | Multiple PTYs, tickets, persistence, restore, responsive layout | Web parity |
| Sharing | Publish/copy/open/unpublish through v1 | Web parity |
| System status | MCP control/auth, LSP and plugin status | Web parity |
| Session context | Model, tokens, context window, cost, timestamps | Web parity |
| Notifications | In-app, system, sounds, unseen/error state | Web parity |
| Settings | General/appearance/servers/providers/models/shortcuts | Web parity |
| Providers | API key, OAuth, custom compatible provider | Web parity |
| Command palette | Commands/files/sessions and shortcut overrides | Web parity |
| Top-level tabs | Draft/session/reorder/reopen/persist | Web parity |
| Language | US English | Foundation |
| Connection loss | Clear disconnected state and preserved drafts | Minimum useful product |
| Basic PWA | Installable application shell | Later platform parity |
| Desktop-native features | Host-dependent adapters | Later platform parity |

## 22. Definition of done

A feature is done only when:

- Its user flow works on required mobile and desktop viewports.
- Loading, success, empty, stale, disconnected, and error states are defined as applicable.
- Keyboard and screen-reader behavior is implemented.
- Unit or integration coverage protects its domain logic.
- At least one browser test protects its critical path.
- It does not violate bundle, runtime, or cache budgets.
- It does not expose sensitive data.
- User-facing text is centralized and consistent.
- Persistence has a versioned schema when used.
- Relevant documentation and parity status are updated.

The web parity release is done when every Web parity row is complete, all cross-cutting quality gates pass, and remaining differences from the reference client are documented as intentional product decisions.

## 23. Open decisions

These choices should be resolved with prototypes before their implementation phase:

1. Which Markdown, syntax-highlighting, diff, and terminal libraries meet the bundle and accessibility budgets.
2. Which server-side credential store to use and how operators provide its encryption key.
3. Which built-in or external authentication mechanism protects the single-user application when it is exposed beyond loopback.

## 24. Reference implementation notes

The existing OpenCode client is a SolidJS Vite single-page application. The new client should learn from its behavior and tests without copying architecture that conflicts with SSR or the performance goals.

Key reference areas:

- Routes and provider composition: `~/opencode/packages/app/src/app.tsx`
- Server connections and scopes: `~/opencode/packages/app/src/context/server.tsx`
- SDK and global event stream: `~/opencode/packages/app/src/context/server-sdk.tsx`
- Server/directory synchronization: `~/opencode/packages/app/src/context/server-sync.tsx`
- Session cache and event reconciliation: `~/opencode/packages/app/src/context/server-session.ts`
- Persistence: `~/opencode/packages/app/src/utils/persist.ts`
- Home and session index: `~/opencode/packages/app/src/pages/home.tsx` and `src/pages/home/`
- Session composition: `~/opencode/packages/app/src/pages/session.tsx`
- Timeline: `~/opencode/packages/app/src/pages/session/timeline/`
- Composer and submission: `~/opencode/packages/app/src/components/prompt-input*`
- Files, review, and terminal: `~/opencode/packages/app/src/pages/session/`
- Settings: `~/opencode/packages/app/src/components/settings-v2/`
- Tool rendering: `~/opencode/packages/session-ui/src/components/message-part.tsx`
- Unit and browser tests: `~/opencode/packages/app/src/**/*.test.ts*` and `test-browser/`
- End-to-end and performance tests: `~/opencode/packages/app/e2e/`

Notable reference constraints:

- The current browser client commonly connects directly to `http://localhost:4096`.
- Its live stream batches and coalesces events at frame cadence.
- It virtualizes the timeline and file surfaces.
- It bounds directory, session, file, prompt, terminal, and persistence caches.
- It supports both v1 and v2 server protocols through compatibility adapters.
- This client intentionally targets only the v1 protocol initially because it is the official client's preferred path and currently has broader feature coverage.
- It stores substantial UI state in browser or desktop persistence.
- It contains both a current tabbed layout and a legacy sidebar layout; this specification targets one simpler responsive layout.
- Rich tool rendering lives in the shared `session-ui` package and must be accounted for during parity work.

These details are behavior to preserve where they improve correctness and performance. Framework-specific providers, Solid components, browser-only startup assumptions, conditional route trees, and plaintext credential persistence are not architecture to reproduce.
