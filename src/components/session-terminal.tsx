import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { SerializeAddon } from '@xterm/addon-serialize'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

import {
  decodeTerminalMetadata,
  isPtyInfo,
  nextTerminalTitle,
  persistTerminalSnapshot,
  readTerminalWorkspace,
  reconcileTerminals,
  terminalHeights,
  terminalStorageKey,
  type PtyInfo,
  type SavedTerminal,
  type TerminalWorkspaceState,
  writeTerminalWorkspace,
} from '~/lib/terminal'

type ConnectionState =
  | 'connecting'
  | 'reconnecting'
  | 'connected'
  | 'disconnected'
  | 'exited'
  | 'stale'
  | 'error'

type Store = { key: string; state: TerminalWorkspaceState }

const stateCopy: Record<ConnectionState, string> = {
  connecting: 'Connecting to the terminal.',
  reconnecting: 'Reconnecting to the terminal.',
  connected: 'Connected.',
  disconnected: 'Disconnected from the terminal.',
  exited: 'This terminal process has exited.',
  stale: 'This terminal no longer exists on the OpenCode server.',
  error: 'The terminal connection failed.',
}

const maximumAttempts = 8
const heightLabels: Record<number, string> = { 280: 'Small', 360: 'Medium', 520: 'Large' }

export function SessionTerminal({
  serverKey,
  directory,
}: {
  serverKey: string
  directory: string
}) {
  const storageKey = terminalStorageKey(serverKey, directory)
  const [store, setStore] = useState<Store>(() => ({
    key: storageKey,
    state: { version: 1, terminals: [], height: 360 },
  }))
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string>()
  const loaded = store.key === storageKey

  // Load persisted workspace state whenever the server or directory changes, then
  // reconcile it against the sessions the OpenCode server still reports.
  useEffect(() => {
    let current = true
    setBusy(true)
    setError(undefined)
    const restored = readTerminalWorkspace(storageKey)
    setStore({ key: storageKey, state: restored })

    void (async () => {
      try {
        const running = await ptyRequest<PtyInfo[]>(directory, '/pty', { method: 'GET' })
        if (!current) return
        const reconciled = reconcileTerminals(restored.terminals, running)
        const created = reconciled.length ? undefined : await createPty(directory, 'Terminal 1')
        if (!current) return
        setStore((previous) => {
          if (previous.key !== storageKey) return previous
          const terminals = reconcileTerminals(previous.state.terminals, running)
          if (created && !terminals.some((item) => item.id === created.id)) {
            terminals.push({ id: created.id, title: created.title })
          }
          const active =
            previous.state.active && terminals.some((item) => item.id === previous.state.active)
              ? previous.state.active
              : terminals[0]?.id
          return {
            key: storageKey,
            state: { ...previous.state, terminals, ...(active ? { active } : {}) },
          }
        })
      } catch {
        if (current) {
          setError('Terminals could not be loaded. Check the OpenCode connection, then retry.')
        }
      } finally {
        if (current) setBusy(false)
      }
    })()

    return () => {
      current = false
    }
  }, [storageKey, directory])

  // Persist only state that belongs to the currently selected workspace key.
  useEffect(() => {
    if (store.key !== storageKey) return
    try {
      writeTerminalWorkspace(storageKey, store.state)
    } catch {
      setError('Terminal layout could not be saved. The terminal still works for this visit.')
    }
  }, [store, storageKey])

  function update(updater: (previous: TerminalWorkspaceState) => TerminalWorkspaceState) {
    setStore((previous) =>
      previous.key === storageKey ? { key: previous.key, state: updater(previous.state) } : previous,
    )
  }

  async function retry() {
    setBusy(true)
    setError(undefined)
    try {
      const running = await ptyRequest<PtyInfo[]>(directory, '/pty', { method: 'GET' })
      const reconciled = reconcileTerminals(store.state.terminals, running)
      const created = reconciled.length ? undefined : await createPty(directory, 'Terminal 1')
      update((previous) => {
        const terminals = reconcileTerminals(previous.terminals, running)
        if (created && !terminals.some((item) => item.id === created.id)) {
          terminals.push({ id: created.id, title: created.title })
        }
        const active =
          previous.active && terminals.some((item) => item.id === previous.active)
            ? previous.active
            : terminals[0]?.id
        return { ...previous, terminals, ...(active ? { active } : {}) }
      })
    } catch {
      setError('Terminals could not be loaded. Check the OpenCode connection, then retry.')
    } finally {
      setBusy(false)
    }
  }

  async function addTerminal() {
    if (busy) return
    setBusy(true)
    setError(undefined)
    try {
      const pty = await createPty(directory, nextTerminalTitle(store.state.terminals))
      update((previous) => ({
        ...previous,
        terminals: [...previous.terminals, { id: pty.id, title: pty.title }],
        active: pty.id,
      }))
    } catch {
      setError('The terminal could not be created.')
    } finally {
      setBusy(false)
    }
  }

  async function replaceTerminal(id: string) {
    if (busy) return
    setBusy(true)
    setError(undefined)
    try {
      const title =
        store.state.terminals.find((item) => item.id === id)?.title ??
        nextTerminalTitle(store.state.terminals)
      const pty = await createPty(directory, title)
      update((previous) => ({
        ...previous,
        terminals: previous.terminals.map((item) =>
          item.id === id ? { id: pty.id, title: pty.title } : item,
        ),
        active: pty.id,
      }))
    } catch {
      setError('The replacement terminal could not be created.')
    } finally {
      setBusy(false)
    }
  }

  async function closeTerminal(id: string) {
    setError(undefined)
    update((previous) => {
      const index = previous.terminals.findIndex((item) => item.id === id)
      const terminals = previous.terminals.filter((item) => item.id !== id)
      const active =
        previous.active === id
          ? terminals[Math.min(Math.max(index - 1, 0), terminals.length - 1)]?.id
          : previous.active
      return { ...previous, terminals, ...(active ? { active } : {}) }
    })
    try {
      await ptyRequest(directory, `/pty/${encodeURIComponent(id)}`, { method: 'DELETE' })
    } catch {
      setError('The terminal closed here, but OpenCode did not confirm that it stopped.')
    }
  }

  async function renameTerminal(id: string, title: string) {
    const previousTitle = store.state.terminals.find((item) => item.id === id)?.title
    if (!title || title === previousTitle) return
    setError(undefined)
    update((previous) => ({
      ...previous,
      terminals: previous.terminals.map((item) => (item.id === id ? { ...item, title } : item)),
    }))
    try {
      await ptyRequest(directory, `/pty/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify({ title }),
      })
    } catch {
      update((previous) => ({
        ...previous,
        terminals: previous.terminals.map((item) =>
          item.id === id && previousTitle ? { ...item, title: previousTitle } : item,
        ),
      }))
      setError('The terminal could not be renamed.')
    }
  }

  function moveTerminal(id: string, offset: number) {
    update((previous) => {
      const from = previous.terminals.findIndex((item) => item.id === id)
      const to = Math.max(0, Math.min(previous.terminals.length - 1, from + offset))
      if (from < 0 || from === to) return previous
      const terminals = [...previous.terminals]
      const [item] = terminals.splice(from, 1)
      if (item) terminals.splice(to, 0, item)
      return { ...previous, terminals }
    })
  }

  const syncInstance = useEffectEvent((value: SavedTerminal) => {
    update((previous) => ({
      ...previous,
      terminals: previous.terminals.map((item) =>
        item.id === value.id ? { ...value, title: item.title } : item,
      ),
    }))
  })

  const terminals = loaded ? store.state.terminals : []
  const active = terminals.find((item) => item.id === store.state.active) ?? terminals[0]

  return (
    <section
      className="terminal-panel"
      aria-labelledby="terminal-heading"
      style={{ height: `${store.state.height}px` }}
    >
      <header className="terminal-toolbar">
        <h2 id="terminal-heading">Terminal</h2>
        <button type="button" disabled={busy} onClick={() => void addTerminal()}>
          New terminal
        </button>
        <label>
          Panel height
          <select
            value={store.state.height}
            onChange={(event) =>
              update((previous) => ({ ...previous, height: Number(event.target.value) }))
            }
          >
            {terminalHeights.map((height) => (
              <option key={height} value={height}>
                {heightLabels[height]}
              </option>
            ))}
          </select>
        </label>
      </header>

      {error ? (
        <div className="terminal-error">
          <p role="alert">{error}</p>
          <button type="button" disabled={busy} onClick={() => void retry()}>
            Retry
          </button>
        </div>
      ) : null}

      {terminals.length ? (
        <ul className="terminal-tabs" aria-label="Open terminals">
          {terminals.map((item, index) => (
            <TerminalTab
              key={item.id}
              terminal={item}
              index={index}
              count={terminals.length}
              selected={item.id === active?.id}
              onSelect={() => update((previous) => ({ ...previous, active: item.id }))}
              onRename={(title) => void renameTerminal(item.id, title)}
              onMove={(offset) => moveTerminal(item.id, offset)}
              onClose={() => void closeTerminal(item.id)}
            />
          ))}
        </ul>
      ) : null}

      <div className="terminal-stage">
        {active ? (
          <TerminalInstance
            key={`${storageKey}:${active.id}`}
            storageKey={storageKey}
            directory={directory}
            saved={active}
            onSync={syncInstance}
            onReplace={() => void replaceTerminal(active.id)}
          />
        ) : (
          <p className="terminal-empty">
            {busy ? 'Loading terminals...' : 'No terminal is open.'}
          </p>
        )}
      </div>
    </section>
  )
}

function TerminalTab({
  terminal,
  index,
  count,
  selected,
  onSelect,
  onRename,
  onMove,
  onClose,
}: {
  terminal: SavedTerminal
  index: number
  count: number
  selected: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onMove: (offset: number) => void
  onClose: () => void
}) {
  const [renaming, setRenaming] = useState(false)

  return (
    <li className="terminal-tab">
      {renaming ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const value = new FormData(event.currentTarget).get('title')
            onRename(String(value ?? '').trim().slice(0, 200))
            setRenaming(false)
          }}
        >
          <label>
            <span>Terminal name</span>
            <input name="title" defaultValue={terminal.title} maxLength={200} autoFocus />
          </label>
          <button type="submit">Save</button>
          <button type="button" onClick={() => setRenaming(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          <button type="button" aria-pressed={selected} onClick={onSelect}>
            {terminal.title}
          </button>
          <button
            type="button"
            aria-label={`Rename ${terminal.title}`}
            onClick={() => setRenaming(true)}
          >
            Rename
          </button>
          <button
            type="button"
            aria-label={`Move ${terminal.title} earlier`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            Earlier
          </button>
          <button
            type="button"
            aria-label={`Move ${terminal.title} later`}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            Later
          </button>
          <button type="button" aria-label={`Close ${terminal.title}`} onClick={onClose}>
            Close
          </button>
        </>
      )}
    </li>
  )
}

function TerminalInstance({
  storageKey,
  directory,
  saved,
  onSync,
  onReplace,
}: {
  storageKey: string
  directory: string
  saved: SavedTerminal
  onSync: (value: SavedTerminal) => void
  onReplace: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<ConnectionState>('connecting')
  const [attempt, setAttempt] = useState(0)
  const sync = useEffectEvent((value: SavedTerminal) => onSync(value))

  useEffect(() => {
    const container = host.current
    if (!container) return

    let disposed = false
    let socket: WebSocket | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    let stableTimer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    let restoreReady = !saved.buffer
    let streamCursor = saved.cursor
    let renderedCursor = saved.cursor
    let pendingWrites = 0
    let metadataPending: { cursor: number; remaining: number } | undefined
    let lastSize = ''

    const terminal = new Terminal({
      convertEol: false,
      cursorBlink: true,
      screenReaderMode: true,
      scrollback: 10_000,
      theme: terminalTheme(),
    })
    const fit = new FitAddon()
    const serialize = new SerializeAddon()
    terminal.loadAddon(fit)
    terminal.loadAddon(serialize)
    terminal.loadAddon(
      new WebLinksAddon((event, uri) => {
        if (!/^https?:\/\//i.test(uri)) return
        const coarse = window.matchMedia?.('(pointer: coarse)').matches === true
        if (!coarse && !(event.ctrlKey || event.metaKey || event.shiftKey)) return
        window.open(uri, '_blank', 'noopener,noreferrer')
      }),
    )

    // Shift+Tab must leave the terminal so keyboard users are never trapped.
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && event.key === 'Tab' && event.shiftKey) return false
      return true
    })

    terminal.open(container)
    if (saved.buffer) {
      terminal.write(saved.buffer, () => {
        restoreReady = true
        if (!disposed && saved.scrollY !== undefined) terminal.scrollToLine(saved.scrollY)
      })
    }

    const snapshot = () => ({
      buffer: serialize.serialize(),
      ...(renderedCursor === undefined ? {} : { cursor: renderedCursor }),
      rows: terminal.rows,
      cols: terminal.cols,
      scrollY: terminal.buffer.active.viewportY,
    })

    const save = () => {
      if (!restoreReady) return undefined
      const value = snapshot()
      try {
        persistTerminalSnapshot(storageKey, saved.id, value)
      } catch {
        // Terminal recovery state is optional when storage is unavailable.
      }
      return value
    }

    const sendSize = () => {
      void ptyRequest(directory, `/pty/${encodeURIComponent(saved.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ size: { cols: terminal.cols, rows: terminal.rows } }),
      }).catch(() => undefined)
    }

    const resize = () => {
      try {
        fit.fit()
      } catch {
        return
      }
      const key = `${terminal.cols}:${terminal.rows}`
      if (key === lastSize) return
      lastSize = key
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(sendSize, 100)
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    window.visualViewport?.addEventListener('resize', resize)
    const onHide = () => save()
    window.addEventListener('pagehide', onHide)

    const input = terminal.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(data)
    })

    const stillExists = async (): Promise<boolean | undefined> =>
      ptyRequest(directory, `/pty/${encodeURIComponent(saved.id)}`, { method: 'GET' })
        .then(() => true)
        .catch((error: unknown) =>
          error instanceof PtyRequestError && error.status === 404 ? false : undefined,
        )

    const scheduleRetry = async () => {
      if (disposed) return
      if (attempts >= maximumAttempts) {
        setState('error')
        return
      }
      const exists = await stillExists()
      if (exists === false) {
        if (!disposed) setState('stale')
        return
      }
      if (disposed) return
      attempts += 1
      setAttempt(attempts)
      const delay = Math.min(4_000, 250 * 2 ** (attempts - 1))
      retryTimer = setTimeout(() => void connect(), delay)
    }

    const connect = async () => {
      if (disposed) return
      setState(attempts ? 'reconnecting' : 'connecting')
      // Each attachment replays from the last output xterm has actually parsed.
      // Do not carry the prior socket's ahead-of-render stream cursor forward.
      streamCursor = renderedCursor
      metadataPending = undefined
      try {
        const token = await ptyRequest<{ ticket: string }>(
          directory,
          `/pty/${encodeURIComponent(saved.id)}/connect-token`,
          { method: 'POST', headers: { 'x-opencode-ticket': '1' } },
        )
        if (disposed) return

        const url = new URL(
          `/api/opencode/pty/${encodeURIComponent(saved.id)}/connect`,
          location.origin,
        )
        url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
        url.searchParams.set('directory', directory)
        url.searchParams.set('ticket', token.ticket)
        url.searchParams.set(
          'cursor',
          renderedCursor === undefined
            ? (saved.buffer ? '-1' : '0')
            : String(renderedCursor),
        )

        const next = new WebSocket(url)
        socket = next
        next.binaryType = 'arraybuffer'

        next.addEventListener('open', () => {
          setState('connected')
          lastSize = ''
          resize()
          stableTimer = setTimeout(() => {
            attempts = 0
            setAttempt(0)
          }, 30_000)
        })
        next.addEventListener('message', (event) => {
          if (typeof event.data === 'string') {
            // The server cursor advances by emitted string length, so live output
            // must advance it too or a reconnect replays everything again.
            const end = (streamCursor ?? 0) + event.data.length
            streamCursor = end
            pendingWrites += 1
            terminal.write(event.data, () => {
              renderedCursor = end
              pendingWrites -= 1
              if (metadataPending) {
                metadataPending.remaining -= 1
                if (metadataPending.remaining === 0) {
                  renderedCursor = metadataPending.cursor
                  metadataPending = undefined
                }
              }
            })
            return
          }
          if (event.data instanceof ArrayBuffer) {
            const metadataCursor = decodeTerminalMetadata(event.data)
            if (metadataCursor === undefined) return
            streamCursor = metadataCursor
            if (pendingWrites === 0) renderedCursor = metadataCursor
            else metadataPending = { cursor: metadataCursor, remaining: pendingWrites }
          }
        })
        next.addEventListener('close', (event) => {
          if (disposed || socket !== next) return
          if (stableTimer) clearTimeout(stableTimer)
          if (event.code !== 1000 && event.code !== 4404) setState('disconnected')
          // Drain all writes from this attachment before persisting or choosing
          // the cursor for another attachment.
          terminal.write('', () => {
            if (disposed || socket !== next) return
            save()
            if (event.code === 4404) {
              setState('stale')
              return
            }
            if (event.code === 1000) {
              setState('exited')
              return
            }
            void scheduleRetry()
          })
        })
        next.addEventListener('error', () => {
          if (!disposed && socket === next) setState('error')
        })
      } catch {
        if (disposed) return
        setState('error')
        void scheduleRetry()
      }
    }

    void connect()

    return () => {
      disposed = true
      if (retryTimer) clearTimeout(retryTimer)
      if (resizeTimer) clearTimeout(resizeTimer)
      if (stableTimer) clearTimeout(stableTimer)
      observer.disconnect()
      window.visualViewport?.removeEventListener('resize', resize)
      window.removeEventListener('pagehide', onHide)
      input.dispose()
      socket?.close(1000, 'Terminal view closed')

      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        const value = save()
        if (value) sync({ id: saved.id, title: saved.title, ...value })
        terminal.dispose()
      }
      // Flush queued writes so the serialized buffer matches rendered output.
      terminal.write('', finish)
      setTimeout(finish, 50)
    }
  }, [saved.id, directory, storageKey])

  const recoverable = state === 'exited' || state === 'stale' || state === 'error'

  return (
    <div className="terminal-instance">
      <p className="terminal-state" role="status">
        {stateCopy[state]}
        {state === 'reconnecting' || state === 'disconnected' ? ` Attempt ${attempt}.` : ''}
      </p>
      {recoverable ? (
        <p className="terminal-recovery">
          <button type="button" onClick={onReplace}>
            Start replacement terminal
          </button>
        </p>
      ) : null}
      <div ref={host} className="terminal-host" />
      <p className="terminal-hint">Press Shift+Tab to move focus out of the terminal.</p>
    </div>
  )
}

async function createPty(directory: string, title: string) {
  return ptyRequest<PtyInfo>(directory, '/pty', {
    method: 'POST',
    body: JSON.stringify({ title }),
  })
}

async function ptyRequest<T = unknown>(
  directory: string,
  path: string,
  init: RequestInit,
): Promise<T> {
  const url = new URL(`/api/opencode${path}`, location.origin)
  url.searchParams.set('directory', directory)

  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  if (!response.ok) throw new PtyRequestError(response.status)

  const value: unknown = await response.json()
  if (path === '/pty' && init.method === 'GET') {
    if (!Array.isArray(value) || !value.every(isPtyInfo)) throw new Error('Invalid PTY list')
  } else if (path === '/pty' && init.method === 'POST') {
    if (!isPtyInfo(value)) throw new Error('Invalid PTY')
  } else if (path.endsWith('/connect-token')) {
    if (
      !value ||
      typeof value !== 'object' ||
      typeof (value as { ticket?: unknown }).ticket !== 'string'
    ) {
      throw new Error('Invalid PTY ticket')
    }
  }
  return value as T
}

class PtyRequestError extends Error {
  constructor(readonly status: number) {
    super(`PTY request failed with status ${status}`)
  }
}

function terminalTheme() {
  return {
    background: '#10120f',
    foreground: '#e7eadf',
    cursor: '#cfff67',
    selectionBackground: '#64703d88',
  }
}
