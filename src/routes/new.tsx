import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { PageIntro } from '~/components/page-intro'
import { getAllHomeIndices } from '~/functions/home-index'
import { getComposerOptions } from '~/functions/composer-options'
import { createSessionMutation } from '~/functions/session-create'
import { strings } from '~/lib/strings'
import { tabStore } from '~/lib/tab-store'
import { readProjectState, writeProjectState } from '~/lib/project-state'
import { worktreeMutation } from '~/functions/projects'
import { removePersistentValue, writePersistentValue } from '~/lib/persistence'

export const Route = createFileRoute('/new')({
  loader: async () => {
    try {
       const index = await getAllHomeIndices({ data: { limit: 64 } })
       const serverKey = index.projects[0]?.serverKey ?? 'invalid'
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
  const mutateWorktree = useServerFn(worktreeMutation)
  const loadComposer = useServerFn(getComposerOptions)
  const navigate = useNavigate()
  const router = useRouter()
  const [error, setError] = useState('')
  const [storageError, setStorageError] = useState('')
  const [pending, setPending] = useState(false)
  const [availableProjects, setAvailableProjects] = useState(projects)
  const [directory, setDirectory] = useState(projects[0]?.directory ?? '')
  const [selectedServerKey, setSelectedServerKey] = useState(serverKey)
  const [projectSearch, setProjectSearch] = useState('')
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
  const draftRestored = useRef(false)
  const draftKey = `opencode-web-lite:new-session-draft:v1:${serverKey}`
  const draftId = `new_${serverKey}`

  useEffect(() => {
    tabStore.open({ type: 'draft', serverKey, draftId, title: title || 'New session', ...(directory ? { directory } : {}) })
  }, [directory, draftId, serverKey, title])

  useEffect(() => {
    let frame = 0
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey) ?? 'null') as unknown
      if (saved && typeof saved === 'object') {
        if ('title' in saved && typeof saved.title === 'string') setTitle(saved.title)
        if (
          'directory' in saved &&
          typeof saved.directory === 'string' &&
          projects.some((project) => project.worktrees.some((worktree) => worktree.directory === saved.directory))
         ) {
           const project = projects.find((item) => item.worktrees.some((worktree) => worktree.directory === saved.directory))
            if (project) void selectDirectory(project.serverKey, saved.directory, false)
         }
      }
      const state = readProjectState(localStorage)
      const preferred = projects.find((project) => state.last[project.serverKey] && project.worktrees.some((worktree) => worktree.directory === state.last[project.serverKey]))
      const preferredDirectory = preferred && state.last[preferred.serverKey]
       if (preferred && preferredDirectory) void selectDirectory(preferred.serverKey, preferredDirectory, false)
    } catch {}
    frame = requestAnimationFrame(() => { draftRestored.current = true })
    return () => cancelAnimationFrame(frame)
  }, [draftKey, projects])

  useEffect(() => {
    if (draftRestored.current) saveDraft(directory, title)
  }, [directory, title])

  function saveDraft(nextDirectory: string, nextTitle: string) {
    const saved = writePersistentValue(localStorage, draftKey, JSON.stringify({ directory: nextDirectory, title: nextTitle }), 'draft')
    setStorageError(saved ? '' : 'This draft could not be saved in your browser.')
  }

   async function selectDirectory(nextServerKey: string, nextDirectory: string, persist = true) {
     setSelectedServerKey(nextServerKey)
    setDirectory(nextDirectory)
    if (persist) saveDraft(nextDirectory, title)
    setError('')
    try {
       const next = await loadComposer({ data: { serverKey: nextServerKey, directory: nextDirectory } })
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
         serverKey: selectedServerKey,
        directory,
        title,
        agent,
        providerID,
        modelID,
        variant,
      },
    })
      .then(async (result) => {
        removePersistentValue(localStorage, draftKey)
        setCreated(result)
        tabStore.promoteDraft(draftId, {
          type: 'session', serverKey: result.serverKey, sessionId: result.sessionID,
          title: title.trim() || 'New session', directory, status: 'idle',
        })
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
             <input type="search" placeholder="Search projects and worktrees" value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} />
             <select name="directory" required value={`${selectedServerKey}\0${directory}`} onChange={(event) => { const [key = '', value = ''] = event.target.value.split('\0'); void selectDirectory(key, value); const state = readProjectState(localStorage); state.last[key] = value; try { writeProjectState(localStorage, state) } catch {} }}>
               {availableProjects.filter((project) => `${project.serverLabel} ${project.name} ${project.directory}`.toLowerCase().includes(projectSearch.toLowerCase())).flatMap((project) => project.worktrees.map((worktree) => (
                 <option key={`${project.serverKey}:${project.id}:${worktree.directory}`} value={`${project.serverKey}\0${worktree.directory}`}>
                   {project.serverLabel} · {project.name} · {worktree.current ? 'Main worktree' : worktree.directory.split('/').at(-1)}{worktree.orphaned ? ' · Orphan recovery' : ''}
                 </option>
               )))}
             </select>
           </label>
           <button type="button" onClick={() => {
             const project = availableProjects.find((item) => item.serverKey === selectedServerKey && item.worktrees.some((worktree) => worktree.directory === directory))
             if (!project) return
             const name = prompt('Worktree name (optional)') ?? undefined
             void mutateWorktree({ data: { serverKey: selectedServerKey, projectDirectory: project.directory, action: 'create', ...(name !== undefined ? { value: name } : {}) } }).then((result) => {
               if (!('directory' in result) || typeof result.directory !== 'string') return
               setAvailableProjects((current) => current.map((item) => item === project ? { ...item, worktrees: [...item.worktrees, { directory: result.directory, current: false, orphaned: true }] } : item))
               void selectDirectory(selectedServerKey, result.directory)
             }).catch(() => setError('The worktree could not be created. No session was created.'))
           }}>Create optional worktree</button>
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
       {storageError ? <p className="form-error" role="alert">{storageError}</p> : null}
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
