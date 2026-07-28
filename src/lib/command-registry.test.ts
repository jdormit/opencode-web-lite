import { describe, expect, test } from 'bun:test'

import { CommandRegistry, effectiveShortcut, shortcutConflicts, type CommandDefinition } from './command-registry'

describe('command registry', () => {
  test('registers, runs, and disposes commands centrally', () => {
    let count = 0
    const registry = new CommandRegistry()
    const dispose = registry.register({ id: 'test', title: 'Test', category: 'Test', run: () => { count += 1 } })
    expect(registry.run('test')).toBeTrue()
    dispose()
    expect(registry.run('test')).toBeFalse()
    expect(count).toBe(1)
  })

  test('applies overrides, clear, reset, and reports conflicts', () => {
    const commands: CommandDefinition[] = [
      { id: 'one', title: 'One', category: 'Test', shortcut: 'mod+1', run() {} },
      { id: 'two', title: 'Two', category: 'Test', shortcut: 'mod+2', run() {} },
    ]
    expect(effectiveShortcut(commands[0]!, { one: null })).toBe('')
    expect(effectiveShortcut(commands[0]!, {})).toBe('mod+1')
    expect(shortcutConflicts(commands, { two: 'mod+1' }).get('mod+1')).toEqual(['one', 'two'])
  })
})
