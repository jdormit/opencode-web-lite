import type { SessionContext as Context } from '~/lib/session-snapshot'

export function SessionContext({ context }: { context: Context }) {
  const tokens = context.tokens
  return <details className="session-context"><summary>Context{context.contextPercent !== undefined ? ` / ${context.contextPercent}%` : ''}</summary>
    <dl>
      <div><dt>Model</dt><dd>{context.providerID && context.modelID ? `${context.providerID} / ${context.modelID}` : 'Unavailable'}{context.variant ? ` / ${context.variant}` : ''}</dd></div>
      <div><dt>Agent</dt><dd>{context.agent ?? 'Unavailable'}</dd></div>
      <div><dt>Tokens</dt><dd>{tokens ? `${tokens.total.toLocaleString('en-US')} total / ${tokens.input.toLocaleString('en-US')} input / ${tokens.output.toLocaleString('en-US')} output / ${tokens.reasoning.toLocaleString('en-US')} reasoning / ${tokens.cacheRead.toLocaleString('en-US')} cache read / ${tokens.cacheWrite.toLocaleString('en-US')} cache write` : 'Unavailable'}</dd></div>
      <div><dt>Context window</dt><dd>{context.contextLimit ? `${context.contextPercent ?? 0}% of ${context.contextLimit.toLocaleString('en-US')}` : 'Unavailable'}</dd></div>
      <div><dt>Cost</dt><dd>{context.cost !== undefined ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(context.cost) : 'Unavailable'}</dd></div>
      <div><dt>Updated</dt><dd><time dateTime={new Date(context.updatedAt).toISOString()}>{new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(context.updatedAt)}</time></dd></div>
      <div><dt>Source</dt><dd>{context.freshness}</dd></div>
    </dl>
  </details>
}
