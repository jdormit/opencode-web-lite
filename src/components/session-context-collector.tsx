import { useEffect, useState } from 'react'

import { writePersistentValue } from '~/lib/persistence'
import { addPromptContext, parsePromptContexts, promptContextLocked } from '~/lib/prompt-context'

export function SessionContextCollector({ serverKey, sessionId }: { serverKey: string; sessionId: string }) {
  const [status, setStatus] = useState<string>()
  useEffect(() => {
    const key = `opencode-web-lite:session-draft:v1:${serverKey}:${sessionId}`
    const contextKey = `opencode-web-lite:session-contexts:v1:${serverKey}:${sessionId}`
    const collect = (event: Event) => {
      if (promptContextLocked(contextKey)) {
        event.preventDefault(); setStatus('Wait for the current prompt to be accepted before changing context.'); return
      }
      const context = (event as CustomEvent<{ context?: unknown }>).detail?.context
      let current: unknown = []
      try { current = JSON.parse(localStorage.getItem(contextKey) ?? '[]') } catch {}
      const result = addPromptContext(parsePromptContexts(current), context)
      if (!result.ok) {
        event.preventDefault(); setStatus('Context was not added because it exceeds the item or 32,000-character limit.'); return
      }
      if (!writePersistentValue(localStorage, contextKey, JSON.stringify(result.value), 'draft')) {
        event.preventDefault(); setStatus('Context could not be saved to the prompt draft.'); return
      }
      window.dispatchEvent(new CustomEvent('opencode:draft-updated', { detail: { key, contexts: result.value } }))
      setStatus('Context added to the prompt draft.')
    }
    window.addEventListener('opencode:add-context', collect)
    return () => window.removeEventListener('opencode:add-context', collect)
  }, [serverKey, sessionId])
  return status ? <p role="status">{status}</p> : null
}
