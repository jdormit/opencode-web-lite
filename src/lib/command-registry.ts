export type CommandDefinition = {
  id: string
  title: string | (() => string)
  category: string
  description?: string
  shortcut?: string
  disabled?: boolean | (() => boolean)
  hidden?: boolean
  run(): void | Promise<void>
}

export type ShortcutPreferences = Record<string, string | null>

export const DEFAULT_SHORTCUTS: Readonly<Record<string, string>> = {
  'command.palette': 'mod+k',
  'composer.focus': 'mod+l',
  'session.stop': 'escape,ctrl+g',
}

export function normalizeShortcut(value: string): string {
  if (!value.trim()) return ''
  if (value.includes(',')) return value.split(',').map(normalizeShortcut).filter(Boolean).join(',')
  const modifiers = new Set<string>()
  let key = ''
  for (const raw of value.toLowerCase().replace(/\s+/g, '').split('+')) {
    const part = raw === 'cmd' || raw === 'meta' || raw === 'ctrl' ? (raw === 'ctrl' ? 'ctrl' : 'meta') : raw
    if (part === 'mod' || part === 'ctrl' || part === 'meta' || part === 'alt' || part === 'shift') modifiers.add(part)
    else key = part === 'esc' ? 'escape' : part
  }
  if (!key) return ''
  return [...['mod', 'ctrl', 'meta', 'alt', 'shift'].filter((item) => modifiers.has(item)), key].join('+')
}

export function eventShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>) {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const parts: string[] = []
  if (mac ? event.metaKey : event.ctrlKey) parts.push('mod')
  else {
    if (event.ctrlKey) parts.push('ctrl')
    if (event.metaKey) parts.push('meta')
  }
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  parts.push(event.key.toLowerCase() === 'esc' ? 'escape' : event.key.toLowerCase())
  return parts.join('+')
}

export function effectiveShortcut(command: CommandDefinition, overrides: ShortcutPreferences) {
  const value = overrides[command.id]
  return value === null ? '' : normalizeShortcut(value ?? command.shortcut ?? DEFAULT_SHORTCUTS[command.id] ?? '')
}

export function shortcutConflicts(commands: CommandDefinition[], overrides: ShortcutPreferences) {
  const owners = new Map<string, string[]>()
  for (const command of commands) {
    for (const shortcut of effectiveShortcut(command, overrides).split(',').filter(Boolean)) {
      const current = owners.get(shortcut) ?? []
      current.push(command.id)
      owners.set(shortcut, current)
    }
  }
  return new Map([...owners].filter(([, ids]) => ids.length > 1))
}

export class CommandRegistry {
  private commands = new Map<string, CommandDefinition>()
  register(command: CommandDefinition) {
    this.commands.set(command.id, command)
    return () => { if (this.commands.get(command.id) === command) this.commands.delete(command.id) }
  }
  list() { return [...this.commands.values()] }
  run(id: string) {
    const command = this.commands.get(id)
    if (!command || (typeof command.disabled === 'function' ? command.disabled() : command.disabled)) return false
    void command.run()
    return true
  }
}

export function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}
