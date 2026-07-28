import type { CommandDefinition } from './command-registry'

type Actions = Partial<Record<'home' | 'new' | 'settings' | 'back' | 'forward', () => void>>

export function appCommands(actions: Actions = {}): CommandDefinition[] {
  const run = (name: keyof Actions) => () => actions[name]?.()
  return [
    { id: 'navigation.home', title: 'Open home', category: 'Navigation', shortcut: 'mod+shift+h', run: run('home') },
    { id: 'session.new', title: 'New session', category: 'Sessions', shortcut: 'mod+shift+s', run: run('new') },
    { id: 'navigation.settings', title: 'Open settings', category: 'Navigation', run: run('settings') },
    { id: 'navigation.back', title: 'Go back', category: 'Navigation', shortcut: 'alt+arrowleft', run: run('back') },
    { id: 'navigation.forward', title: 'Go forward', category: 'Navigation', shortcut: 'alt+arrowright', run: run('forward') },
  ]
}
