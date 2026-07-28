import { useEffect, useMemo, useRef, useState } from 'react'

import { DEFAULT_SHORTCUTS, effectiveShortcut, eventShortcut, isEditableTarget, shortcutConflicts, type CommandDefinition, type ShortcutPreferences } from '~/lib/command-registry'
import { writePersistentValue } from '~/lib/persistence'

const storageKey = 'opencode-web-lite:shortcuts:v1'

export function loadShortcutPreferences(): ShortcutPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? '{}')
    return value && typeof value === 'object' ? value : {}
  } catch { return {} }
}

export function CommandPalette({ commands, initialOpen = false }: { commands: CommandDefinition[]; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [overrides, setOverrides] = useState<ShortcutPreferences>({})
  const trigger = useRef<HTMLElement | null>(initialOpen && typeof document !== 'undefined' ? document.activeElement as HTMLElement : null)
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => setOverrides(loadShortcutPreferences()), [])
  const visible = useMemo(() => commands.filter((command) => !command.hidden && `${typeof command.title === 'function' ? command.title() : command.title} ${command.category} ${command.description ?? ''}`.toLowerCase().includes(query.toLowerCase())), [commands, query])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const shortcut = eventShortcut(event)
      const paletteShortcut = overrides['command.palette'] ?? DEFAULT_SHORTCUTS['command.palette']
      if (shortcut === paletteShortcut) {
        event.preventDefault()
        trigger.current = document.activeElement as HTMLElement
        setOpen(true)
        return
      }
      if (open || (isEditableTarget(event.target) && !event.ctrlKey && !event.metaKey && !event.altKey)) return
      const command = commands.find((candidate) => effectiveShortcut(candidate, overrides).split(',').includes(shortcut))
      if (!command || (typeof command.disabled === 'function' ? command.disabled() : command.disabled)) return
      event.preventDefault()
      void command.run()
    }
    document.addEventListener('keydown', keydown, true)
    return () => document.removeEventListener('keydown', keydown, true)
  }, [commands, open, overrides])
  useEffect(() => { if (open) search.current?.focus() }, [open])
  const close = () => { setOpen(false); setQuery(''); setActive(0); requestAnimationFrame(() => trigger.current?.focus()) }
  if (!open) return null
  return <div className="palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); close() }
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive((value) => visible.length ? (value + 1) % visible.length : 0) }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActive((value) => visible.length ? (value - 1 + visible.length) % visible.length : 0) }
      if (event.key === 'Enter' && visible[active]) { event.preventDefault(); void visible[active].run(); close() }
    }}>
      <input ref={search} type="search" value={query} placeholder="Search commands" aria-label="Search commands" onChange={(event) => { setQuery(event.target.value); setActive(0) }} />
      <div role="listbox" aria-label="Commands">{visible.map((command, index) => {
        const disabled = typeof command.disabled === 'function' ? command.disabled() : command.disabled
        return <button key={command.id} type="button" role="option" aria-selected={index === active} disabled={disabled} onMouseEnter={() => setActive(index)} onClick={() => { void command.run(); close() }}>
          <span><strong>{typeof command.title === 'function' ? command.title() : command.title}</strong><small>{command.category}{command.description ? ` · ${command.description}` : ''}</small></span>
          <kbd>{effectiveShortcut(command, overrides)}</kbd>
        </button>
      })}</div>
      {!visible.length ? <p>No matching commands.</p> : null}
    </div>
  </div>
}

export function ShortcutSettings({ commands }: { commands: CommandDefinition[] }) {
  const [overrides, setOverrides] = useState<ShortcutPreferences>({})
  useEffect(() => setOverrides(loadShortcutPreferences()), [])
  const conflicts = shortcutConflicts(commands, overrides)
  const save = (next: ShortcutPreferences) => { setOverrides(next); writePersistentValue(localStorage, storageKey, JSON.stringify(next), 'preference') }
  return <section className="shortcut-settings"><h2>Shortcuts</h2>{commands.map((command) => {
    const value = effectiveShortcut(command, overrides)
    const conflict = conflicts.get(value)
    return <label key={command.id}><span>{typeof command.title === 'function' ? command.title() : command.title}</span>
      <input value={value} aria-label={`Shortcut for ${typeof command.title === 'function' ? command.title() : command.title}`} aria-invalid={Boolean(conflict)} onChange={(event) => save({ ...overrides, [command.id]: event.target.value || null })} onKeyDown={(event) => {
        if (event.key === 'Tab') return
        event.preventDefault()
        if (event.key === 'Backspace' || event.key === 'Delete') { save({ ...overrides, [command.id]: null }); return }
        if (event.key === 'Escape') return
        save({ ...overrides, [command.id]: eventShortcut(event.nativeEvent) })
      }} />
      {conflict ? <small role="alert">Conflicts with {conflict.filter((id) => id !== command.id).join(', ')}</small> : null}
      <button type="button" onClick={() => { const next = { ...overrides }; delete next[command.id]; save(next) }}>Reset</button>
    </label>
  })}<button type="button" className="button-secondary" onClick={() => save({})}>Reset all shortcuts</button></section>
}
