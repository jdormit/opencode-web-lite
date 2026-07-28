import { Link } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'

import { stripAnsi } from '~/lib/ansi'
import { parseUnifiedDiff } from '~/lib/diff'
import type { BoundedValue, TimelineToolPart } from '~/lib/session-snapshot'

type Props = { part: TimelineToolPart; serverKey: string; sessionId: string }
type Renderer = (props: Props) => ReactNode

const contextTools = new Set(['read', 'list', 'glob', 'grep'])
export function isContextTool(part: TimelineToolPart) { return contextTools.has(part.name.toLowerCase()) }

export function ToolRenderer(props: Props) {
  if (props.part.name === 'todowrite') return null
  if (props.part.name === 'question' && (props.part.status === 'pending' || props.part.status === 'running')) return null
  const name = normalizeName(props.part.name)
  const render = renderers[name] ?? GenericTool
  return render(props)
}

export function ContextToolGroup({ parts, serverKey, sessionId }: { parts: TimelineToolPart[]; serverKey: string; sessionId: string }) {
  const reads = parts.filter((part) => part.name === 'read').length
  const searches = parts.filter((part) => part.name === 'glob' || part.name === 'grep').length
  const lists = parts.filter((part) => part.name === 'list').length
  const running = parts.some((part) => part.status === 'pending' || part.status === 'running')
  return <details className="tool-detail context-tool-group">
    <summary><strong>{running ? 'Gathering context' : 'Gathered context'}</strong><span>{[reads && `${reads} read`, searches && `${searches} search`, lists && `${lists} list`].filter(Boolean).join(' / ')}</span></summary>
    <div className="context-tool-items">{parts.map((part) => <ToolRenderer key={part.id} part={part} serverKey={serverKey} sessionId={sessionId} />)}</div>
  </details>
}

function StandardTool({ part, sessionId, children, summary, defaultOpen = false }: Props & { children?: ReactNode; summary?: ReactNode; defaultOpen?: boolean }) {
  const key = `opencode-web-lite:tool-open:v1:${sessionId}:${part.id}`
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => {
    try { const saved = sessionStorage.getItem(key); if (saved !== null) setOpen(saved === 'true') } catch {}
  }, [key])
  const content = children ?? <ToolPayload part={part} />
  return <details className={`tool-detail tool-${normalizeName(part.name)}`} open={open} onToggle={(event) => {
    const next = event.currentTarget.open
    setOpen(next)
    try { sessionStorage.setItem(key, String(next)) } catch {}
  }}>
    <summary><strong>{summary ?? part.title ?? toolTitle(part.name)}</strong><span className={`tool-state tool-state-${part.status}`}>{part.status}</span></summary>
    {open ? <>{content}{part.outputLimited ? <p className="content-limit">Output is truncated at 64,000 characters.</p> : null}<ToolError part={part} /></> : null}
  </details>
}

function ToolPayload({ part }: { part: TimelineToolPart }) {
  return <>
    {part.input !== undefined ? <Payload title="Input" value={part.input} /> : null}
    {part.output ? <section><h3>Output</h3><pre tabIndex={0}><code>{part.output}</code></pre></section> : null}
  </>
}

function Payload({ title, value }: { title: string; value: BoundedValue }) {
  return <section><h3>{title}</h3><pre tabIndex={0}><code>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</code></pre></section>
}

function ToolError({ part }: { part: TimelineToolPart }) {
  if (!part.error) return null
  return <details className="tool-error"><summary>Error details</summary><pre tabIndex={0}><code>{part.error}</code></pre></details>
}

const ReadTool: Renderer = (props) => <StandardTool {...props} summary={<ToolSummary title="Read" detail={inputString(props.part, 'filePath')} />} />
const ListTool: Renderer = (props) => <StandardTool {...props} summary={<ToolSummary title="List" detail={inputString(props.part, 'path') || '/'} />} />
const GlobTool: Renderer = (props) => <StandardTool {...props} summary={<ToolSummary title="Glob" detail={inputString(props.part, 'pattern')} />} />
const GrepTool: Renderer = (props) => <StandardTool {...props} summary={<ToolSummary title="Grep" detail={inputString(props.part, 'pattern')} />} />
const WebFetchTool: Renderer = (props) => {
  const url = safeHttpUrl(inputString(props.part, 'url'))
  return <StandardTool {...props} summary={<ToolSummary title="Fetch URL" detail={url} />}>{url ? <p><a href={url} target="_blank" rel="noopener noreferrer">{url}</a></p> : <ToolPayload part={props.part} />}</StandardTool>
}
const WebSearchTool: Renderer = (props) => <StandardTool {...props} summary={<ToolSummary title="Web search" detail={inputString(props.part, 'query')} />} />
const SkillTool: Renderer = (props) => <StandardTool {...props} summary={<ToolSummary title="Skill" detail={inputString(props.part, 'name')} />} />

const TaskTool: Renderer = (props) => {
  const child = metadataString(props.part, 'sessionId')
  const agent = inputString(props.part, 'subagent_type') || 'Agent'
  const summary = <ToolSummary title={agent} detail={inputString(props.part, 'description') || child} />
  return <StandardTool {...props} summary={summary}>{child ? <p><Link to="/server/$serverKey/session/$sessionId" params={{ serverKey: props.serverKey, sessionId: child }}>Open child session</Link></p> : <ToolPayload part={props.part} />}</StandardTool>
}

const BashTool: Renderer = (props) => {
  const command = inputString(props.part, 'command') || metadataString(props.part, 'command')
  const output = stripAnsi(props.part.output || metadataString(props.part, 'output'))
  const text = `$ ${command}${output ? `\n\n${output}` : ''}`
  return <StandardTool {...props} defaultOpen={props.part.status === 'running'} summary={<ToolSummary title="Shell" detail={command} />}>
    <CopyBlock text={text} />
  </StandardTool>
}

const EditTool: Renderer = (props) => {
  const path = metadataNestedString(props.part, ['filediff', 'file']) || inputString(props.part, 'filePath')
  const patch = metadataNestedString(props.part, ['filediff', 'patch'])
  const additions = metadataNestedNumber(props.part, ['filediff', 'additions'])
  const deletions = metadataNestedNumber(props.part, ['filediff', 'deletions'])
  return <StandardTool {...props} summary={<ToolSummary title={toolTitle(props.part.name)} detail={`${path}${additions || deletions ? ` (+${additions}/-${deletions})` : ''}`} />}>
    {patch ? <MiniDiff patch={patch} /> : <ToolPayload part={props.part} />}
    <Diagnostics part={props.part} />
  </StandardTool>
}

const WriteTool: Renderer = (props) => <StandardTool {...props} summary={<ToolSummary title="Write" detail={inputString(props.part, 'filePath')} />}><ToolPayload part={props.part} /><Diagnostics part={props.part} /></StandardTool>
const PatchTool: Renderer = (props) => <StandardTool {...props} summary={<ToolSummary title="Patch" detail={patchFileSummary(props.part)} />}><ToolPayload part={props.part} /><Diagnostics part={props.part} /></StandardTool>
const TodoTool: Renderer = () => null
const QuestionTool: Renderer = (props) => <StandardTool {...props} defaultOpen summary={<ToolSummary title="Questions" detail={questionSummary(props.part)} />} />

function GenericTool(props: Props) {
  const mcp = props.part.name.includes('_') || props.part.name.includes('.')
  return <StandardTool {...props} summary={<ToolSummary title={mcp ? 'MCP tool' : 'Tool'} detail={props.part.name} />} />
}

function MiniDiff({ patch }: { patch: string }) {
  const parsed = parseUnifiedDiff(patch, 2_000)
  return <section className="mini-diff"><h3>Diff</h3><pre tabIndex={0}><code>{parsed.lines.map((line) => <span key={line.key} className={`diff-${line.kind}`}>{line.text}{'\n'}</span>)}</code></pre>{parsed.limited ? <p>Diff preview is limited to 2,000 lines.</p> : null}</section>
}

function Diagnostics({ part }: { part: TimelineToolPart }) {
  const diagnostics = metadataValue(part, 'diagnostics')
  return diagnostics ? <Payload title="Diagnostics" value={diagnostics} /> : null
}

function CopyBlock({ text }: { text: string }) {
  const [status, setStatus] = useState('Copy')
  return <section className="shell-output"><button type="button" onClick={() => void navigator.clipboard.writeText(text).then(() => setStatus('Copied'), () => setStatus('Copy failed'))}>{status}</button><pre tabIndex={0}><code>{text}</code></pre></section>
}

function ToolSummary({ title, detail }: { title: string; detail?: string }) { return <span>{title}{detail ? <small>{detail}</small> : null}</span> }
function normalizeName(name: string) { return name === 'bash' ? 'shell' : name === 'apply_patch' ? 'patch' : name.toLowerCase() }
function toolTitle(name: string) { return ({ read: 'Read', list: 'List', glob: 'Glob', grep: 'Grep', webfetch: 'Fetch URL', websearch: 'Web search', task: 'Task', bash: 'Shell', shell: 'Shell', edit: 'Edit', write: 'Write', patch: 'Patch', apply_patch: 'Patch', todowrite: 'Todos', question: 'Questions', skill: 'Skill' } as Record<string, string>)[name] ?? name }
function inputObject(part: TimelineToolPart) { return part.input && typeof part.input === 'object' && !Array.isArray(part.input) ? part.input : {} }
function inputString(part: TimelineToolPart, key: string) { const value = inputObject(part)[key]; return typeof value === 'string' ? value : '' }
function metadataObject(part: TimelineToolPart) { return part.metadata && typeof part.metadata === 'object' && !Array.isArray(part.metadata) ? part.metadata : {} }
function metadataValue(part: TimelineToolPart, key: string) { return metadataObject(part)[key] }
function metadataString(part: TimelineToolPart, key: string) { const value = metadataValue(part, key); return typeof value === 'string' ? value : '' }
function metadataNestedString(part: TimelineToolPart, path: string[]) { const value = nested(metadataObject(part), path); return typeof value === 'string' ? value : '' }
function metadataNestedNumber(part: TimelineToolPart, path: string[]) { const value = nested(metadataObject(part), path); return typeof value === 'number' ? value : 0 }
function nested(value: BoundedValue, path: string[]): BoundedValue | undefined { let current: BoundedValue | undefined = value; for (const key of path) { if (!current || typeof current !== 'object' || Array.isArray(current)) return; current = current[key] } return current }
function safeHttpUrl(value: string) { try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '' } catch { return '' } }
function patchFileSummary(part: TimelineToolPart) { const files = metadataValue(part, 'files') ?? inputObject(part).files; return Array.isArray(files) ? `${files.length} file${files.length === 1 ? '' : 's'}` : '' }
function questionSummary(part: TimelineToolPart) { const questions = inputObject(part).questions; const answers = metadataValue(part, 'answers'); return Array.isArray(answers) && answers.length ? `${answers.length} answered` : Array.isArray(questions) ? `${questions.length} question${questions.length === 1 ? '' : 's'}` : '' }

const renderers: Record<string, Renderer> = {
  read: ReadTool, list: ListTool, glob: GlobTool, grep: GrepTool, webfetch: WebFetchTool,
  websearch: WebSearchTool, task: TaskTool, shell: BashTool, edit: EditTool, write: WriteTool,
  patch: PatchTool, todowrite: TodoTool, question: QuestionTool, skill: SkillTool,
}
