import { useRef, useState } from 'react'

import { getSessionFileDiff } from '~/functions/session-snapshot'
import type { SessionSnapshot } from '~/lib/session-snapshot'
import { promptContextID } from '~/lib/prompt-context'

export function SessionChanges({ serverKey, sessionId, snapshot }: {
  serverKey: string
  sessionId: string
  snapshot: SessionSnapshot
}) {
  const [details, setDetails] = useState<Record<string, { patch: string; limited: boolean }>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState<string>()
  const pending = useRef(new Set<string>())

  async function expand(file: string, needsDetail: boolean) {
    if (!needsDetail || details[file] || pending.current.has(file)) return
    pending.current.add(file)
    setLoading(file)
    setErrors((value) => ({ ...value, [file]: '' }))
    try {
      if (!snapshot.changeMessageId) throw new Error('missing turn')
      const result = await getSessionFileDiff({ data: {
        serverKey, sessionID: sessionId, messageID: snapshot.changeMessageId, file,
      } })
      if (!result) throw new Error('missing')
      setDetails((value) => ({ ...value, [file]: result }))
    } catch {
      setErrors((value) => ({ ...value, [file]: 'The complete patch could not be loaded.' }))
    } finally {
      pending.current.delete(file)
      setLoading(undefined)
    }
  }

  return <section className="changes-view" aria-labelledby="changes-heading">
    <h2 id="changes-heading">Changed files</h2>
    <p className="change-totals">{snapshot.changesTotal} files / +{snapshot.changesAdditions} / -{snapshot.changesDeletions}</p>
    {snapshot.changesLimited ? <p className="history-note">Showing the first 40 changed files.</p> : null}
    {!snapshot.changes.length ? <p className="empty-copy">No current-turn changes.</p> : null}
    {snapshot.changes.map((change) => {
      const detail = details[change.file]
      const patch = detail?.patch ?? change.patch
      const limited = detail?.limited ?? change.patchLimited
      const needsDetail = change.patchLimited || change.patchOmitted
      return <details key={change.file} onToggle={(event) => {
        if (event.currentTarget.open) void expand(change.file, needsDetail)
      }}>
        <summary><strong>{change.file}</strong><span>{change.status} / +{change.additions} -{change.deletions}</span></summary>
        {loading === change.file ? <p role="status">Loading complete patch...</p> : null}
        {errors[change.file] ? <p role="alert">{errors[change.file]}</p> : null}
        {patch ? <>
          {limited ? <p className="history-note">This patch is truncated.</p> : null}
          <pre><code>{patch}</code></pre>
          <button type="button" onClick={() => addDiffContext(change.file, patch)}>Add patch to prompt</button>
        </> : <p>Patch content is unavailable.</p>}
      </details>
    })}
  </section>
}

function addDiffContext(file: string, patch: string) {
  window.dispatchEvent(new CustomEvent('opencode:add-context', { cancelable: true, detail: {
    context: {
      id: promptContextID('diff', file),
      type: 'diff',
      label: file,
      text: `Diff context: ${file}\n\n\`\`\`diff\n${patch.slice(0, 31_000)}\n\`\`\``,
    },
  } }))
}
