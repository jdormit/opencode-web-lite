import { useEffect, useState } from 'react'

import { writePersistentValue } from '~/lib/persistence'
import type { SessionSnapshot } from '~/lib/session-snapshot'

export function TodoDock({ sessionId, snapshot }: { sessionId: string; snapshot: SessionSnapshot }) {
  const storageKey = `opencode-web-lite:todo-open:${sessionId}`
  const [open, setOpen] = useState(false)
  useEffect(() => {
    try { setOpen(localStorage.getItem(storageKey) === 'true') }
    catch { setOpen(false) }
  }, [storageKey])
  const completed = snapshot.todos.filter((todo) => todo.status === 'completed').length
  const active = snapshot.todos.find((todo) => todo.status === 'in_progress')
  return <details className="todo-dock" open={open} onToggle={(event) => {
    const next = event.currentTarget.open
    setOpen(next)
    writePersistentValue(localStorage, storageKey, String(next), 'session-ui')
  }}>
    <summary>Todos ({completed}/{snapshot.todos.length}{snapshot.todosLimited ? '+' : ''}){active ? <small>{active.content}</small> : null}</summary>
    <ul>{snapshot.todos.map((todo, index) => <li key={`${todo.content}-${index}`}><span>{todo.content}</span><small>{todo.status} / {todo.priority}</small></li>)}</ul>
  </details>
}
