import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouter,
} from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { ThemePicker } from '~/components/theme-picker'
import { getThemePreference } from '~/functions/preferences'
import { strings } from '~/lib/strings'
import { themePreloadScript } from '~/lib/theme'
import appCss from '~/styles/app.css?url'

export const Route = createRootRouteWithContext()({
  loader: () => getThemePreference(),
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
    ],
    scripts: [{ children: themePreloadScript }],
  }),
  component: App,
  errorComponent: RootError,
  notFoundComponent: NotFound,
  shellComponent: RootDocument,
})

function App() {
  const theme = Route.useLoaderData()

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
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
      </header>
      <Outlet />
    </div>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  const theme = Route.useLoaderData()

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
      </div>
      {import.meta.env.DEV ? <pre className="error-details">{error.message}</pre> : null}
    </main>
  )
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
