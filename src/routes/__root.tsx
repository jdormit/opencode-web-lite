import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouter,
  useNavigate,
} from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'

import { ThemePicker } from '~/components/theme-picker'
import { LiveConnection } from '~/components/live-connection'
import { getConnectionSnapshot } from '~/functions/connections'
import { getThemePreference } from '~/functions/preferences'
import { strings } from '~/lib/strings'
import { themePreloadScript } from '~/lib/theme'
import { appCommands } from '~/lib/app-commands'
import { DEFAULT_SHORTCUTS, effectiveShortcut, eventShortcut, isEditableTarget, type CommandDefinition, type ShortcutPreferences } from '~/lib/command-registry'
import appCss from '~/styles/app.css?url'

const CommandPalette = lazy(() => import('~/components/command-palette').then((module) => ({ default: module.CommandPalette })))

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: async () => {
    const [theme, connection] = await Promise.all([
      getThemePreference(),
      getConnectionSnapshot(),
    ])
    return { theme, connection }
  },
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', content: '#11120f' },
      {
        name: 'description',
        content: 'A fast, minimal, mobile-first OpenCode web client.',
      },
      { title: strings.productName },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'apple-touch-icon', href: '/pwa-icon.svg' },
    ],
    scripts: [{ children: themePreloadScript }, { src: '/pwa-register.js', defer: true }],
  }),
  component: App,
  errorComponent: RootError,
  notFoundComponent: NotFound,
  shellComponent: RootDocument,
})

function App() {
  const { connection, theme } = Route.useLoaderData()
  const { queryClient } = Route.useRouteContext()
  const navigate = useNavigate()
  const commands = useMemo(() => appCommands({
    home: () => void navigate({ to: '/' }),
    new: () => void navigate({ to: '/new' }),
    settings: () => void navigate({ to: '/settings' }),
    back: () => history.back(),
    forward: () => history.forward(),
  }), [navigate])

  return (
    <QueryClientProvider client={queryClient}>
      <div className="app-shell">
        <a className="skip-link" href="#main-content" onClick={() => {
          const main = document.getElementById('main-content')
          if (!main) return
          main.tabIndex = -1
          main.focus()
        }}>
          Skip to main content
        </a>
        <header className="route-bar">
          <Link className="wordmark" to="/" aria-label={strings.productName}>
            <span aria-hidden="true" className="wordmark-mark">
              /&#62;
            </span>
            <span>OpenCode</span>
            <span className="wordmark-lite">Lite</span>
          </Link>
          <nav aria-label="Primary navigation">
            <Link to="/" activeOptions={{ exact: true }}>
              {strings.navigation.home}
            </Link>
            <Link to="/new">{strings.navigation.newSession}</Link>
            <Link to="/settings">{strings.navigation.settings}</Link>
          </nav>
          <ThemePicker initialTheme={theme} />
          <LiveConnection connection={connection} />
        </header>
        <Outlet />
        <DeferredCommandPalette commands={commands} />
      </div>
    </QueryClientProvider>
  )
}

function DeferredCommandPalette({ commands }: { commands: CommandDefinition[] }) {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (loaded) return
    const keydown = (event: KeyboardEvent) => {
      let overrides: ShortcutPreferences = {}
      try { overrides = JSON.parse(localStorage.getItem('opencode-web-lite:shortcuts:v1') ?? '{}') as ShortcutPreferences } catch {}
      const shortcut = eventShortcut(event)
      const paletteShortcut = overrides['command.palette'] ?? DEFAULT_SHORTCUTS['command.palette']
      if (shortcut === paletteShortcut) {
        event.preventDefault(); setLoaded(true); return
      }
      if (isEditableTarget(event.target) && !event.ctrlKey && !event.metaKey && !event.altKey) return
      const command = commands.find((candidate) => effectiveShortcut(candidate, overrides).split(',').includes(shortcut))
      if (!command || (typeof command.disabled === 'function' ? command.disabled() : command.disabled)) return
      event.preventDefault(); void command.run()
    }
    document.addEventListener('keydown', keydown, true)
    return () => document.removeEventListener('keydown', keydown, true)
  }, [commands, loaded])
  return loaded ? <Suspense fallback={null}><CommandPalette commands={commands} initialOpen /></Suspense> : null
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  const { theme } = Route.useLoaderData()

  return (
    <html
      lang="en-US"
      dir="ltr"
      data-theme={theme === 'system' ? undefined : theme}
      suppressHydrationWarning
    >
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function RootError({ error }: ErrorComponentProps) {
  const router = useRouter()

  return (
    <main className="centered-state" id="main-content">
      <p className="eyebrow">Error</p>
      <h1>{strings.errors.title}</h1>
      <p>{strings.errors.description}</p>
      <div className="action-row">
        <button type="button" onClick={() => void router.invalidate()}>
          {strings.errors.reload}
        </button>
        <Link className="button-secondary" to="/">
          {strings.errors.returnHome}
        </Link>
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(errorDetails(error))}
        >
          {strings.errors.copyDetails}
        </button>
      </div>
      {import.meta.env.DEV ? <pre className="error-details">{error.message}</pre> : null}
    </main>
  )
}

function errorDetails(error: Error): string {
  const safeMessage = error.message
    .replaceAll(/https?:\/\/[^\s]+/gi, '[address removed]')
    .replaceAll(/(authorization|password|token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[removed]')
    .slice(0, 4_000)
  return `${strings.productName}\n${error.name}: ${safeMessage || 'Unknown error'}\nRoute: ${location.pathname}`
}

function NotFound() {
  return (
    <main className="centered-state" id="main-content">
      <p className="eyebrow">404</p>
      <h1>{strings.errors.notFoundTitle}</h1>
      <p>{strings.errors.notFoundDescription}</p>
      <Link className="button-secondary" to="/">
        {strings.errors.returnHome}
      </Link>
    </main>
  )
}
