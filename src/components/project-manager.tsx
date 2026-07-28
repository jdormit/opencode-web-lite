import { useServerFn } from '@tanstack/react-start'
import { useEffect, useRef, useState } from 'react'
import type { HomeProject } from '~/lib/home-index'
import { orderProjects, readProjectState, writeProjectState, type ProjectState } from '~/lib/project-state'
import { getDirectories, openProjectMutation, renameProjectMutation, worktreeMutation } from '~/functions/projects'

export function ProjectManager({ projects, onChanged }: { projects: HomeProject[]; onChanged(): void }) {
  const browse = useServerFn(getDirectories)
  const openProject = useServerFn(openProjectMutation)
  const renameProject = useServerFn(renameProjectMutation)
  const worktree = useServerFn(worktreeMutation)
  const [state, setState] = useState<ProjectState>({ version: 1, order: {}, last: {}, closed: {} })
  const [search, setSearch] = useState('')
  const [picker, setPicker] = useState<{ serverKey: string; directory: string; directories: Array<{ name: string; directory: string }> }>()
  const [message, setMessage] = useState('')
  useEffect(() => setState(readProjectState(localStorage)), [])

  function update(next: ProjectState) {
    setState(next)
    try { writeProjectState(localStorage, next) } catch { setMessage('Project preferences could not be saved in this browser.') }
  }
  const serverGroups = new Map<string, HomeProject[]>()
  for (const project of projects) serverGroups.set(project.serverKey, [...(serverGroups.get(project.serverKey) ?? []), project])
  return <section aria-labelledby="projects-heading">
    <p className="eyebrow">Projects</p>
    <h2 id="projects-heading">Known projects</h2>
    <label className="index-search"><span>Search projects</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    {[...serverGroups.entries()].map(([serverKey, group]) => {
      const visible = orderProjects(group, serverKey, state).filter((project) => `${project.name} ${project.directory}`.toLowerCase().includes(search.toLowerCase()))
      return <div className="project-group" key={serverKey}>
        {serverGroups.size > 1 ? <h3>{group[0]!.serverLabel}</h3> : null}
        <button type="button" onClick={() => void browse({ data: { serverKey } }).then((result) => setPicker({ serverKey, ...result })).catch(() => setMessage('Directories could not be loaded.'))}>Add directory</button>
        <ul className="project-list">{visible.map((project, index) => <li key={project.id}>
          <div><strong><span className="project-color" style={project.iconColor ? { background: project.iconColor } : undefined} aria-hidden="true" />{project.name}</strong><span>{project.directory}</span><small>{state.last[serverKey] === project.directory ? 'Selected' : project.status}</small></div>
          <div className="compact-actions">
            <button type="button" disabled={index === 0} onClick={() => move(project.directory, -1, serverKey, visible)}>Up</button>
            <button type="button" disabled={index === visible.length - 1} onClick={() => move(project.directory, 1, serverKey, visible)}>Down</button>
            <button type="button" onClick={() => update({ ...state, last: { ...state.last, [serverKey]: project.directory } })}>Select</button>
            <button type="button" onClick={() => { const name = prompt('Project name', project.name); if (name === null) return; const color = prompt('Project color (six-digit hex, optional)', project.iconColor ?? '') ?? undefined; void renameProject({ data: { serverKey, projectID: project.id, name, ...(color !== undefined ? { color } : {}) } }).then(onChanged).catch(() => setMessage('Project identity could not be saved.')) }}>Edit</button>
            <button type="button" onClick={() => update({ ...state, closed: { ...state.closed, [serverKey]: [project.directory, ...(state.closed[serverKey] ?? []).filter((item) => item !== project.directory)].slice(0, 16) } })}>Close</button>
          </div>
          <details><summary>Worktrees ({project.worktrees.length})</summary>
            <ul>{project.worktrees.map((item) => <li key={item.directory}><span>{item.current ? 'Main' : item.directory}{item.orphaned ? ' (orphaned, recovery available)' : ''}</span>{!item.current ? <span className="compact-actions"><button type="button" onClick={() => void performWorktree(project, 'reset', item.directory)}>Reset</button><button type="button" onClick={() => void performWorktree(project, 'remove', item.directory)}>Remove</button></span> : null}</li>)}</ul>
            <button type="button" onClick={() => void performWorktree(project, 'create', prompt('Worktree name (optional)') ?? undefined)}>Create worktree</button>
          </details>
        </li>)}</ul>
        {(state.closed[serverKey] ?? []).length ? <details><summary>Recently closed</summary>{(state.closed[serverKey] ?? []).map((directory) => <button key={directory} type="button" onClick={() => update({ ...state, closed: { ...state.closed, [serverKey]: state.closed[serverKey]!.filter((item) => item !== directory) } })}>Reopen {directory}</button>)}</details> : null}
      </div>
    })}
    {picker ? <DirectoryPicker picker={picker} onBrowse={(directory) => browse({ data: { serverKey: picker.serverKey, directory } }).then((result) => setPicker({ serverKey: picker.serverKey, ...result })).catch(() => setMessage('Directories could not be loaded.'))} onOpen={() => openProject({ data: { serverKey: picker.serverKey, directory: picker.directory } }).then(() => { setPicker(undefined); onChanged() }).catch(() => setMessage('The directory could not be opened.'))} onClose={() => setPicker(undefined)} /> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>

  function move(directory: string, delta: number, serverKey: string, visible: HomeProject[]) {
    const order = visible.map((project) => project.directory)
    const index = order.indexOf(directory)
    const [item] = order.splice(index, 1)
    order.splice(index + delta, 0, item!)
    update({ ...state, order: { ...state.order, [serverKey]: order } })
  }
  async function performWorktree(project: HomeProject, action: 'create' | 'reset' | 'remove', value?: string) {
    if ((action === 'reset' || action === 'remove') && !confirm(action === 'remove' ? 'Remove this worktree and delete its branch? Uncommitted local changes may be lost.' : 'Reset this worktree to the primary branch? Local changes may be lost.')) return
    try { await worktree({ data: { serverKey: project.serverKey, projectDirectory: project.directory, action, ...(value !== undefined ? { value } : {}) } }); onChanged() }
    catch { setMessage(`The worktree could not be ${action === 'create' ? 'created' : `${action}ed`}.`) }
  }
}

function DirectoryPicker({ picker, onBrowse, onOpen, onClose }: {
  picker: { serverKey: string; directory: string; directories: Array<{ name: string; directory: string }> }
  onBrowse(directory: string): Promise<unknown>
  onOpen(): Promise<unknown>
  onClose(): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
    return () => { if (dialog.current?.open) dialog.current.close() }
  }, [])
  const close = () => { dialog.current?.close(); onClose() }
  return <dialog ref={dialog} className="picker-panel" aria-labelledby="directory-picker-heading" onCancel={(event) => { event.preventDefault(); close() }}>
    <h3 id="directory-picker-heading">Choose a directory</h3><p>{picker.directory}</p>
    <button autoFocus type="button" onClick={() => void onBrowse(parentDirectory(picker.directory))}>Parent</button>
    <button type="button" onClick={() => void onOpen()}>Open this directory</button>
    <ul>{picker.directories.map((item) => <li key={item.directory}><button type="button" onClick={() => void onBrowse(item.directory)}>{item.name}</button></li>)}</ul>
    <button type="button" onClick={close}>Cancel</button>
  </dialog>
}

function parentDirectory(directory: string) {
  const normalized = directory.replace(/\/+$/, '')
  return normalized.slice(0, normalized.lastIndexOf('/')) || '/'
}
