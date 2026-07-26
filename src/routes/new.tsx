import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { PageIntro } from '~/components/page-intro'
import { getHomeIndex } from '~/functions/home-index'
import { getComposerOptions } from '~/functions/composer-options'
import { createSessionMutation } from '~/functions/session-create'
import { getConnectionSnapshot } from '~/functions/connections'
import { strings } from '~/lib/strings'

export const Route = createFileRoute('/new')({
  loader: async () => {
    try {
      const connection = await getConnectionSnapshot()
      const serverKey = connection.server.key
      const index = await getHomeIndex({ data: { serverKey } })
      const firstDirectory = index.projects[0]?.directory
      const composer = firstDirectory
        ? await getComposerOptions({ data: { serverKey, directory: firstDirectory } })
        : undefined
      return {
        projects: index.projects,
        limited: index.projectsLimited,
        error: index.errors.projects,
        composer,
        serverKey,
      }
    } catch {
      return { projects: [], limited: false, error: true, composer: undefined, serverKey: 'invalid' }
    }
  },
  head: () => ({ meta: [{ title: `New session | ${strings.productName}` }] }),
  component: NewSession,
})

function NewSession() {
  const { composer: initialComposer, error: loadError, limited, projects, serverKey } = Route.useLoaderData()
  const createSession = useServerFn(createSessionMutation)
  const loadComposer = useServerFn(getComposerOptions)
  const navigate = useNavigate()
  const router = useRouter()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [directory, setDirectory] = useState(projects[0]?.directory ?? '')
  const [title, setTitle] = useState('')
  const [created, setCreated] = useState<{ serverKey: string; sessionID: string }>()
  const [composer, setComposer] = useState(initialComposer)
  const [agent, setAgent] = useState(initialComposer?.defaultAgent ?? '')
  const [modelKey, setModelKey] = useState(
    initialComposer?.defaultModel
      ? `${initialComposer.defaultModel.providerID}\0${initialComposer.defaultModel.modelID}`
      : '',
  )
  const [variant, setVariant] = useState('')
  const submitting = useRef(false)
  const draftKey = `opencode-web-lite:new-session-draft:v1:${serverKey}`

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey) ?? 'null') as unknown
      if (saved && typeof saved === 'object') {
        if ('title' in saved && typeof saved.title === 'string') setTitle(saved.title)
        if (
          'directory' in saved &&
          typeof saved.directory === 'string' &&
          projects.some((project) => project.worktrees.some((worktree) => worktree.directory === saved.directory))
        ) void selectDirectory(saved.directory)
      }
    } catch {}
  }, [draftKey, projects])

  function saveDraft(nextDirectory: string, nextTitle: string) {
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({ directory: nextDirectory, title: nextTitle }),
      )
    } catch {}
  }

  async function selectDirectory(nextDirectory: string) {
    setDirectory(nextDirectory)
    saveDraft(nextDirectory, title)
    setError('')
    try {
      const next = await loadComposer({ data: { serverKey, directory: nextDirectory } })
      setComposer(next)
      setAgent(next.defaultAgent ?? '')
      setModelKey(
        next.defaultModel
          ? `${next.defaultModel.providerID}\0${next.defaultModel.modelID}`
          : '',
      )
      setVariant('')
    } catch {
      setComposer(undefined)
      setAgent('')
      setModelKey('')
      setError('Agents and models could not be loaded for this project.')
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setError('')
    setCreated(undefined)
    setPending(true)
    const [providerID = '', modelID = ''] = modelKey.split('\0')
    void createSession({
      data: {
        serverKey,
        directory,
        title,
        agent,
        providerID,
        modelID,
        variant,
      },
    })
      .then(async (result) => {
        try {
          localStorage.removeItem(draftKey)
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
            <select name="directory" required value={directory} onChange={(event) => void selectDirectory(event.target.value)}>
              {projects.flatMap((project) => project.worktrees.map((worktree) => (
                <option key={`${project.id}:${worktree.directory}`} value={worktree.directory}>
                  {project.name} · {worktree.current ? 'Main worktree' : worktree.directory.split('/').at(-1)}
                </option>
              )))}
            </select>
          </label>
          <label>
            <span>Agent</span>
            <select value={agent} required onChange={(event) => setAgent(event.target.value)} disabled={!composer?.agents.length}>
              {composer?.agents.map((option) => (
                <option key={option.name} value={option.name}>{option.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Model</span>
            <select value={modelKey} required onChange={(event) => {
              setModelKey(event.target.value)
              setVariant('')
            }} disabled={!composer?.models.length}>
              {composer?.models.map((model) => (
                <option key={`${model.providerID}/${model.modelID}`} value={`${model.providerID}\0${model.modelID}`}>
                  {model.providerName} · {model.name}
                </option>
              ))}
            </select>
          </label>
          {composer?.models.find((model) => `${model.providerID}\0${model.modelID}` === modelKey)?.variants.length ? (
            <label>
              <span>Variant <small>Optional</small></span>
              <select value={variant} onChange={(event) => setVariant(event.target.value)}>
                <option value="">Default</option>
                {composer.models
                  .find((model) => `${model.providerID}\0${model.modelID}` === modelKey)
                  ?.variants.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          ) : null}
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
          <button type="submit" disabled={pending || !agent || !modelKey}>
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
