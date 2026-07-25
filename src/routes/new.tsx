import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { PageIntro } from '~/components/page-intro'
import { getHomeIndex } from '~/functions/home-index'
import { createSessionMutation } from '~/functions/session-create'
import { strings } from '~/lib/strings'

export const Route = createFileRoute('/new')({
  loader: async () => {
    try {
      const index = await getHomeIndex()
      return {
        projects: index.projects,
        limited: index.projectsLimited,
        error: index.errors.projects,
      }
    } catch {
      return { projects: [], limited: false, error: true }
    }
  },
  head: () => ({ meta: [{ title: `New session | ${strings.productName}` }] }),
  component: NewSession,
})

function NewSession() {
  const { error: loadError, limited, projects } = Route.useLoaderData()
  const createSession = useServerFn(createSessionMutation)
  const navigate = useNavigate()
  const router = useRouter()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [directory, setDirectory] = useState(projects[0]?.directory ?? '')
  const [title, setTitle] = useState('')
  const [created, setCreated] = useState<{ serverKey: string; sessionID: string }>()
  const submitting = useRef(false)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('opencode-web-lite:draft:v1') ?? 'null') as unknown
      if (saved && typeof saved === 'object') {
        if ('title' in saved && typeof saved.title === 'string') setTitle(saved.title)
        if (
          'directory' in saved &&
          typeof saved.directory === 'string' &&
          projects.some((project) => project.directory === saved.directory)
        ) setDirectory(saved.directory)
      }
    } catch {}
  }, [projects])

  function saveDraft(nextDirectory: string, nextTitle: string) {
    try {
      localStorage.setItem(
        'opencode-web-lite:draft:v1',
        JSON.stringify({ directory: nextDirectory, title: nextTitle }),
      )
    } catch {}
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setError('')
    setCreated(undefined)
    setPending(true)
    void createSession({
      data: {
        directory,
        title,
      },
    })
      .then(async (result) => {
        try {
          localStorage.removeItem('opencode-web-lite:draft:v1')
        } catch {}
        setCreated(result)
        await navigate({
            to: '/server/$serverKey/session/$sessionId',
            params: {
              serverKey: result.serverKey,
              sessionId: result.sessionID,
            },
        })
      })
      .catch(() => setError('The session or its page could not be opened. Your title is preserved.'))
      .finally(() => {
        submitting.current = false
        setPending(false)
      })
  }

  return (
    <main id="main-content" className="workspace-shell">
      <PageIntro {...strings.newSession} />
      {loadError ? (
        <section className="placeholder-surface">
          <p>Projects could not be loaded. Check the server connection and retry.</p>
          <button type="button" onClick={() => void router.invalidate()}>Retry</button>
        </section>
      ) : projects.length ? (
        <form className="new-session-form" onSubmit={submit}>
          <label>
            <span>Project</span>
            <select name="directory" required value={directory} onChange={(event) => {
              setDirectory(event.target.value)
              saveDraft(event.target.value, title)
            }}>
              {projects.map((project) => (
                <option key={project.id} value={project.directory}>{project.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Session title <small>Optional</small></span>
            <input name="title" maxLength={200} autoComplete="off" value={title} onChange={(event) => {
              setTitle(event.target.value)
              saveDraft(directory, event.target.value)
            }} />
          </label>
          {limited ? <p className="empty-copy">Showing the first 64 projects.</p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {created ? (
            <a href={`/server/${created.serverKey}/session/${created.sessionID}`}>Open the created session</a>
          ) : null}
          <button type="submit" disabled={pending}>
            {pending ? 'Creating session...' : 'Create session'}
          </button>
        </form>
      ) : (
        <section className="placeholder-surface">
          <p>Add or open a project in OpenCode before starting a session.</p>
        </section>
      )}
    </main>
  )
}
