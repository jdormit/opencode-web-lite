import { useServerFn } from '@tanstack/react-start'
import { useRouter } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useEffectEvent, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'

import type { ComposerOptions } from '~/lib/composer-options'
import { getComposerOptions } from '~/functions/composer-options'
import { sendPromptMutation, stopSessionMutation } from '~/functions/prompt'
import { buildPromptText, parsePromptContexts, setPromptContextLock, type PromptContextItem } from '~/lib/prompt-context'
import { addHistory, historyNavigate, insertMention, parseStoredDraft, reconcileMentions, type ComposerAttachment, type ComposerMentionInput, type ComposerMode, type ComposerState } from '~/lib/composer-state'
import { modelKey, parseModelPreferences } from '~/lib/composer-models'
import type { ComposerWirePart } from '~/lib/composer-prompt'
import { removePersistentValue, writePersistentValue } from '~/lib/persistence'

type Props = Readonly<{
  serverKey: string
  sessionID: string
  options: ComposerOptions
  busy: boolean
  blocked: boolean
}>

type Suggestion =
  | { id: string; type: 'agent'; label: string; name: string; detail?: string }
  | { id: string; type: 'file'; label: string; path: string; detail?: string }
  | { id: string; type: 'command'; label: string; name: string; detail?: string }

const emptyComposer = (): ComposerState => ({ text: '', mode: 'normal', mentions: [], attachments: [] })
const ModelPicker = lazy(() => import('./model-picker').then((module) => ({ default: module.ModelPicker })))

export function SessionComposer({ serverKey, sessionID, options: initialOptions, busy, blocked }: Props) {
  const sendPrompt = useServerFn(sendPromptMutation)
  const stopSession = useServerFn(stopSessionMutation)
  const loadOptions = useServerFn(getComposerOptions)
  const router = useRouter()
  const [options, setOptions] = useState(initialOptions)
  const [composer, setComposer] = useState<ComposerState>(emptyComposer)
  const [agent, setAgent] = useState(initialOptions.currentAgent ?? initialOptions.defaultAgent ?? '')
  const [selectedModelKey, setSelectedModelKey] = useState(
    initialOptions.currentModel ? `${initialOptions.currentModel.providerID}\0${initialOptions.currentModel.modelID}` :
      initialOptions.defaultModel ? `${initialOptions.defaultModel.providerID}\0${initialOptions.defaultModel.modelID}` : '',
  )
  const [variant, setVariant] = useState(initialOptions.currentModel?.variant ?? '')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'failed' | 'stopping'>('idle')
  const [submittedText, setSubmittedText] = useState('')
  const [retryMessageID, setRetryMessageID] = useState('')
  const [storageFailed, setStorageFailed] = useState(false)
  const [contexts, setContexts] = useState<PromptContextItem[]>([])
  const [fallbackMessage, setFallbackMessage] = useState('')
  const [attachmentError, setAttachmentError] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [suggestionIndex, setSuggestionIndex] = useState(0)
  const [suggestionRange, setSuggestionRange] = useState<{ start: number; end: number }>()
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [savedHistoryDraft, setSavedHistoryDraft] = useState<string>()
  const submitting = useRef(false)
  const textRef = useRef('')
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const selectionTouched = useRef(false)
  const draftKey = `opencode-web-lite:session-draft:v2:${serverKey}:${sessionID}`
  const legacyDraftKey = `opencode-web-lite:session-draft:v1:${serverKey}:${sessionID}`
  const contextKey = `opencode-web-lite:session-contexts:v1:${serverKey}:${sessionID}`
  const historyKey = (mode: ComposerMode) => `opencode-web-lite:composer-history:v1:${serverKey}:${mode}`
  const workspaceKey = `${serverKey}:${options.directory ?? sessionID}`

  useEffect(() => {
    try {
      const parsed = parseStoredDraft(JSON.parse(localStorage.getItem(draftKey) ?? 'null'))
      const legacy = localStorage.getItem(legacyDraftKey) ?? ''
      const restored = parsed ? { ...emptyComposer(), ...parsed } : { ...emptyComposer(), text: legacy }
      setComposer(restored)
      textRef.current = restored.text
      if (parsed?.attachmentsOmitted) setAttachmentError('Local attachments were not saved. Select them again before sending.')
      setContexts(parsePromptContexts(JSON.parse(localStorage.getItem(contextKey) ?? '[]')))

      const preferences = parseModelPreferences(JSON.parse(localStorage.getItem('opencode-web-lite:model-preferences:v1') ?? '{}'))
      const saved = preferences.workspaces[workspaceKey]
      if (!initialOptions.currentModel && saved) setSelectedModelKey(saved)
      const selected = initialOptions.currentModel ? modelKey(initialOptions.currentModel) : saved ?? (initialOptions.defaultModel ? modelKey(initialOptions.defaultModel) : '')
      const savedVariant = preferences.variants[selected]
      if (!initialOptions.currentModel?.variant && savedVariant) setVariant(savedVariant)
      const savedAgent = localStorage.getItem(`opencode-web-lite:composer-agent:v1:${workspaceKey}`)
      if (!initialOptions.currentAgent && savedAgent) setAgent(savedAgent)
    } catch {}
  }, [contextKey, draftKey, initialOptions, legacyDraftKey, workspaceKey])

  useEffect(() => {
    if (!options.directory) return
    void loadOptions({ data: { serverKey, directory: options.directory, sessionID } }).then((next) => {
      setOptions(next)
      if (selectionTouched.current) return
      if (next.currentAgent) setAgent(next.currentAgent)
      if (next.currentModel) {
        setSelectedModelKey(modelKey(next.currentModel))
        setVariant(next.currentModel.variant ?? '')
      }
    }).catch(() => {})
  }, [loadOptions, options.directory, serverKey, sessionID])

  useEffect(() => {
    if (!options.agents.some((option) => option.name === agent)) {
      const fallback = options.currentAgent && options.agents.some((item) => item.name === options.currentAgent)
        ? options.currentAgent : options.defaultAgent ?? options.agents[0]?.name ?? ''
      if (agent) setFallbackMessage(`Agent “${agent}” is unavailable. Using ${fallback || 'no agent'} instead.`)
      setAgent(fallback)
      setRetryMessageID('')
    }
    if (!options.models.some((model) => modelKey(model) === selectedModelKey)) {
      const fallback = options.currentModel && options.models.some((item) => modelKey(item) === modelKey(options.currentModel!))
        ? modelKey(options.currentModel) : options.defaultModel ? modelKey(options.defaultModel) : options.models[0] ? modelKey(options.models[0]) : ''
      if (selectedModelKey) setFallbackMessage(`The saved model is unavailable. Using ${modelLabel(options, fallback) || 'no model'} instead.`)
      setSelectedModelKey(fallback)
      setVariant('')
      setRetryMessageID('')
    }
  }, [agent, options, selectedModelKey])

  function persistComposer(next: ComposerState) {
    setComposer(next)
    textRef.current = next.text
    try {
      if (!writePersistentValue(localStorage, draftKey, JSON.stringify({ text: next.text, mode: next.mode, mentions: next.mentions, attachmentsOmitted: next.attachments.length > 0 }), 'draft')) throw new Error('Storage unavailable')
      removePersistentValue(localStorage, legacyDraftKey)
      setStorageFailed(false)
    } catch { setStorageFailed(true) }
  }

  function updateText(value: string, selection?: number) {
    let mode = composer.mode
    let nextValue = value
    let mentions = reconcileMentions(composer.text, value, composer.mentions)
    if (mode === 'normal' && value.startsWith('!')) {
      mode = 'shell'; nextValue = value.slice(1); mentions = []
      requestAnimationFrame(() => textarea.current?.setSelectionRange(Math.max(0, (selection ?? value.length) - 1), Math.max(0, (selection ?? value.length) - 1)))
    }
    persistComposer({ ...composer, text: nextValue, mode, mentions })
    setHistoryIndex(-1); setSavedHistoryDraft(undefined); setRetryMessageID('')
    if (status === 'failed') setStatus('idle')
    updateSuggestions(nextValue, selection === undefined ? nextValue.length : mode === 'shell' ? Math.max(0, selection - 1) : selection)
  }

  const syncDraft = useEffectEvent((event: Event) => {
    if (status === 'sending' || status === 'stopping') return
    const detail = (event as CustomEvent<{ key?: unknown; contexts?: unknown }>).detail
    if (detail?.key !== legacyDraftKey) return
    setContexts(parsePromptContexts(detail.contexts)); setRetryMessageID('')
    if (status === 'failed') setStatus('idle')
  })
  useEffect(() => {
    window.addEventListener('opencode:draft-updated', syncDraft)
    return () => window.removeEventListener('opencode:draft-updated', syncDraft)
  }, [])

  useEffect(() => {
    if (!busy) return
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' && !(event.key.toLowerCase() === 'g' && event.ctrlKey)) return
      const target = event.target
      if (target instanceof HTMLElement && target !== textarea.current && target.closest('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      void stop()
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [busy, status])

  async function updateSuggestions(text: string, caret: number) {
    if (composer.mode === 'shell') { setSuggestions([]); return }
    const before = text.slice(0, caret)
    const mention = /(?:^|\s)@([^\s@]*)$/.exec(before)
    const command = /^\/([^\s]*)$/.exec(before)
    if (command) {
      const query = command[1]!.toLowerCase()
      setSuggestionRange({ start: 0, end: caret })
      setSuggestions((options.commands ?? []).filter((item) => item.name.toLowerCase().includes(query)).map((item) => ({ id: `command:${item.name}`, type: 'command', name: item.name, label: `/${item.name}`, detail: `${item.source}${item.description ? ` · ${item.description}` : ''}` })))
      setSuggestionIndex(0)
      return
    }
    if (!mention) { setSuggestions([]); setSuggestionRange(undefined); return }
    const query = mention[1] ?? ''
    const start = caret - query.length - 1
    setSuggestionRange({ start, end: caret })
    const agents: Suggestion[] = (options.mentionAgents ?? []).filter((item) => item.name.toLowerCase().includes(query.toLowerCase())).map((item) => ({ id: `agent:${item.name}`, type: 'agent', name: item.name, label: `@${item.name}`, ...(item.description ? { detail: item.description } : {}) }))
    setSuggestions(agents); setSuggestionIndex(0)
    if (!query.trim()) return
    try {
      const { findSessionFiles } = await import('~/functions/files')
      const result = await findSessionFiles({ data: { serverKey, sessionID, query } })
      if (textRef.current !== text) return
      setSuggestions([...agents, ...result.paths.map((path): Suggestion => ({ id: `file:${path}`, type: 'file', path, label: `@${path}`, detail: 'Project file' }))])
    } catch {
      if (textRef.current === text && !agents.length) setAttachmentError('File mention search failed. Keep typing or try again.')
    }
  }

  function chooseSuggestion(suggestion: Suggestion) {
    if (!suggestionRange || status === 'sending' || status === 'stopping') return
    if (suggestion.type === 'command') {
      const text = `${suggestion.label} `
      persistComposer({ ...composer, text, mentions: [] }); setSuggestions([])
      requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(text.length, text.length) })
      return
    }
    const mention: ComposerMentionInput = suggestion.type === 'agent'
      ? { id: suggestion.id, type: 'agent', name: suggestion.name, label: suggestion.label }
      : { id: suggestion.id, type: 'file', path: suggestion.path, label: suggestion.label }
    const result = insertMention(composer.text, composer.mentions, suggestionRange.start, suggestionRange.end, mention)
    persistComposer({ ...composer, text: result.text, mentions: result.mentions }); setSuggestions([])
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(result.caret, result.caret) })
  }

  async function addFiles(files: File[]) {
    if (status === 'sending' || status === 'stopping') return
    if (composer.mode === 'shell') { setAttachmentError('Shell commands cannot include attachments. Exit shell mode to attach files.'); return }
    const { modelAcceptsMime, validateAttachmentFiles } = await import('~/lib/composer-attachments')
    const result = validateAttachmentFiles(composer.attachments, files)
    const selectedModel = options.models.find((model) => modelKey(model) === selectedModelKey)
    const capable = result.accepted.filter((item) => {
      if (selectedModel && modelAcceptsMime({ image: selectedModel.capabilities?.image ?? false, pdf: selectedModel.capabilities?.pdf ?? false }, item.mime)) return true
      result.errors.push(`${item.file.name} is not supported by the selected model.`); return false
    })
    const additions: ComposerAttachment[] = capable.map(({ file, mime }) => ({ id: crypto.randomUUID(), file, mime, ...(mime.startsWith('image/') ? { preview: URL.createObjectURL(file) } : {}) }))
    persistComposer({ ...composer, attachments: [...composer.attachments, ...additions] })
    setAttachmentError(result.errors.join(' '))
  }

  async function submit() {
    const composedText = buildPromptText(composer.text, contexts)
    if (submitting.current || composedText === undefined || (!composer.text.trim() && !composer.attachments.length && !contexts.length) || !agent || !selectedModelKey) return
    submitting.current = true; setPromptContextLock(contextKey, true); setStatus('sending')
    const submitted = composer; const submittedContexts = contexts
    setSubmittedText(composer.text || `${composer.attachments.length + contexts.length} attached item${composer.attachments.length + contexts.length === 1 ? '' : 's'}`)
    const messageID = retryMessageID || createMessageID(); setRetryMessageID(messageID)
    const [providerID = '', modelID = ''] = selectedModelKey.split('\0')
    try {
      let mode: 'prompt' | 'shell' | 'command' = composer.mode === 'shell' ? 'shell' : 'prompt'
      let text = composer.text
      let command: string | undefined
      if (composer.mode === 'normal' && composer.text.startsWith('/')) {
        const [head = '', ...arguments_] = composer.text.slice(1).split(/\s+/)
        if ((options.commands ?? []).some((item) => item.name === head)) { mode = 'command'; command = head; text = arguments_.join(' ') }
      }
      const parts: ComposerWirePart[] = mode === 'prompt' ? [
        ...(composer.text ? [{ type: 'text' as const, text: composer.text }] : []),
        ...composer.mentions.map((mention): ComposerWirePart => mention.type === 'file'
          ? { type: 'project-file', path: mention.path, label: mention.label, start: mention.start, end: mention.end }
          : { type: 'agent', name: mention.name, label: mention.label, start: mention.start, end: mention.end }),
        ...submittedContexts.map((context): ComposerWirePart => ({ type: 'context', contextType: context.type, label: context.label, text: context.text })),
      ] : [{ type: 'text', text }]
      for (const attachment of composer.attachments) parts.push({
        type: 'attachment', mime: attachment.mime, filename: attachment.file.name,
         url: await (await import('~/lib/composer-attachments')).fileToDataUrl(attachment.file, attachment.mime), size: attachment.file.size,
      })
      await sendPrompt({ data: { serverKey, sessionID, messageID, mode, text, ...(command ? { command } : {}), agent, providerID, modelID, variant, parts } })
      const entries = readHistory(historyKey(composer.mode)); writeHistory(historyKey(composer.mode), addHistory(entries, composer.text))
      if (textRef.current === submitted.text) persistComposer(emptyComposer())
      removePersistentValue(localStorage, contextKey)
      setContexts((current) => current.filter((item) => !submittedContexts.some((sent) => sent.id === item.id)))
      submitted.attachments.forEach((attachment) => { if (attachment.preview) URL.revokeObjectURL(attachment.preview) })
      setStatus('sent'); setRetryMessageID(''); setAttachmentError('')
      try { await router.invalidate() } catch {}
      setStatus('idle'); setSubmittedText('')
      for (const delay of [500, 1_500, 3_000]) setTimeout(() => void router.invalidate().catch(() => {}), delay)
    } catch (reason) {
      setStatus('failed'); setAttachmentError(reason instanceof Error ? reason.message : 'Prompt submission failed.')
      if (textRef.current === submitted.text) persistComposer(submitted)
    } finally { submitting.current = false; setPromptContextLock(contextKey, false) }
  }

  async function stop() {
    if (status === 'stopping') return
    setStatus('stopping')
    try { await stopSession({ data: { serverKey, sessionID } }); await router.invalidate(); setStatus('idle') }
    catch { setStatus('failed') }
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.key === 'Escape' || (event.key.toLowerCase() === 'g' && event.ctrlKey)) && busy) { event.preventDefault(); void stop(); return }
    if ((event.key === 'Escape' || event.key === 'Backspace') && composer.mode === 'shell' && !composer.text) {
      event.preventDefault(); persistComposer({ ...composer, mode: 'normal' }); return
    }
    if (suggestions.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === 'Escape')) {
      event.preventDefault()
      if (event.key === 'ArrowDown') setSuggestionIndex((value) => (value + 1) % suggestions.length)
      else if (event.key === 'ArrowUp') setSuggestionIndex((value) => (value - 1 + suggestions.length) % suggestions.length)
      else if (event.key === 'Enter') chooseSuggestion(suggestions[suggestionIndex]!)
      else setSuggestions([])
      return
    }
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && event.currentTarget.selectionStart === event.currentTarget.selectionEnd) {
      const direction = event.key === 'ArrowUp' ? 'up' : 'down'
      const boundary = direction === 'up' ? event.currentTarget.selectionStart === 0 : event.currentTarget.selectionEnd === composer.text.length
      if (boundary) {
        const result = historyNavigate(readHistory(historyKey(composer.mode)), historyIndex, savedHistoryDraft, direction)
        if (result) {
          event.preventDefault(); setHistoryIndex(result.index); setSavedHistoryDraft(historyIndex === -1 && direction === 'up' ? composer.text : result.saved)
          persistComposer({ ...composer, text: result.value, mentions: [] })
          requestAnimationFrame(() => { const point = direction === 'up' ? 0 : result.value.length; textarea.current?.setSelectionRange(point, point) })
        }
      }
      return
    }
    if (event.key !== 'Enter' || event.shiftKey || event.repeat || event.nativeEvent.isComposing) return
    if (matchMedia('(pointer: coarse)').matches) return
    event.preventDefault(); void submit()
  }

  const selectedModel = options.models.find((model) => modelKey(model) === selectedModelKey)
  const currentPrompt = buildPromptText(composer.text, contexts)
  const controlsLocked = status === 'sending' || status === 'stopping'
  const selectionChanged = () => { setRetryMessageID(''); if (status === 'failed') setStatus('idle') }
  const removeContext = (id: string) => {
    if (controlsLocked) return
    const next = contexts.filter((item) => item.id !== id); setContexts(next); selectionChanged()
    if (!writePersistentValue(localStorage, contextKey, JSON.stringify(next), 'draft')) setStorageFailed(true)
  }
  const inputFiles = (event: ChangeEvent<HTMLInputElement>) => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = '' }
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.items).flatMap((item) => item.kind === 'file' && item.getAsFile() ? [item.getAsFile()!] : [])
    if (files.length) { event.preventDefault(); void addFiles(files) }
  }
  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    if (controlsLocked) return
    const projectPath = event.dataTransfer.getData('text/plain')
    if (projectPath.startsWith('file:') && composer.mode === 'normal') {
      const path = projectPath.slice(5); const caret = textarea.current?.selectionStart ?? composer.text.length
      const result = insertMention(composer.text, composer.mentions, caret, caret, { id: `file:${path}`, type: 'file', path, label: `@${path}` })
      persistComposer({ ...composer, text: result.text, mentions: result.mentions }); return
    }
    void addFiles(Array.from(event.dataTransfer.files))
  }

  return <section className={`composer composer-${composer.mode}`} aria-label="Prompt composer" onDragOver={(event) => event.preventDefault()} onDrop={drop}>
    {!options.agents.length || !options.models.length ? <p className="form-error" role="alert">No selectable agent or connected model is available. Update the project’s agent or provider configuration.</p> : null}
    {fallbackMessage ? <p className="composer-notice" role="status">{fallbackMessage}</p> : null}
    {blocked ? <p className="form-error" role="status">Answer the pending request before sending another prompt.</p> : null}
    {currentPrompt === undefined ? <p className="form-error" role="alert">Prompt text and context exceed the 100,000-character limit.</p> : null}
    {status === 'sending' && submittedText ? <div className="optimistic-message" aria-label="Sending prompt">{submittedText}</div> : null}
    {contexts.length ? <ul className="composer-contexts" aria-label="Prompt context">{contexts.map((item) => <li key={item.id}><span><strong>{item.type === 'file' ? 'File' : 'Diff'}</strong> {item.label}</span><button type="button" disabled={controlsLocked} aria-label={`Remove ${item.label}`} onClick={() => removeContext(item.id)}>Remove</button></li>)}</ul> : null}
    {composer.attachments.length ? <ul className="composer-attachments" aria-label="Local attachments">{composer.attachments.map((attachment) => <li key={attachment.id}>
      {attachment.preview ? <img src={attachment.preview} alt="" /> : <span className="attachment-kind">{attachment.mime === 'application/pdf' ? 'PDF' : 'TEXT'}</span>}
      <span><strong>{attachment.file.name}</strong><small>{attachment.mime} · {formatBytes(attachment.file.size)}</small></span>
      <button type="button" disabled={controlsLocked} aria-label={`Remove ${attachment.file.name}`} onClick={() => { if (attachment.preview) URL.revokeObjectURL(attachment.preview); persistComposer({ ...composer, attachments: composer.attachments.filter((item) => item.id !== attachment.id) }) }}>Remove</button>
    </li>)}</ul> : null}
    <div className="composer-editor">
      {composer.mode === 'shell' ? <span className="shell-prefix" aria-hidden="true">!</span> : null}
      <textarea ref={textarea} aria-label={composer.mode === 'shell' ? 'Shell command' : 'Prompt'} value={composer.text} onChange={(event) => updateText(event.target.value, event.target.selectionStart)} onFocus={(event) => event.currentTarget.scrollIntoView({ block: 'nearest' })} onKeyDown={keyDown} onPaste={paste} placeholder={composer.mode === 'shell' ? 'Run a shell command…' : 'Ask OpenCode…'} maxLength={100_000} rows={4} disabled={blocked || controlsLocked} />
      {suggestions.length ? <div className="composer-suggestions" role="listbox" aria-label="Composer suggestions">{suggestions.map((suggestion, index) => <button key={suggestion.id} type="button" role="option" aria-selected={index === suggestionIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseSuggestion(suggestion)}><strong>{suggestion.label}</strong><small>{suggestion.detail}</small></button>)}</div> : null}
    </div>
    <div className="composer-controls">
      {options.agents.length > 1 ? <select disabled={blocked || controlsLocked} aria-label="Agent" value={agent} onChange={(event) => { selectionTouched.current = true; setAgent(event.target.value); writePersistentValue(localStorage, `opencode-web-lite:composer-agent:v1:${workspaceKey}`, event.target.value, 'preference'); selectionChanged() }}>{options.agents.map((option) => <option key={option.name}>{option.name}</option>)}</select> : options.agents[0] ? <span className="composer-selection">Agent: {options.agents[0].name}</span> : null}
      {agent === 'plan' ? <span className="composer-agent-hint">Planning-focused and edit-restricted</span> : null}
      <DeferredModelPicker models={options.models} value={selectedModelKey} storageScope={workspaceKey} disabled={blocked || controlsLocked} onChange={(value) => { selectionTouched.current = true; setSelectedModelKey(value); const preferences = parseModelPreferences(JSON.parse(localStorage.getItem('opencode-web-lite:model-preferences:v1') ?? '{}')); setVariant(preferences.variants[value] ?? ''); selectionChanged() }} />
      {selectedModel?.variants.length ? <select disabled={blocked || controlsLocked} aria-label="Variant" value={variant} onChange={(event) => {
        selectionTouched.current = true; setVariant(event.target.value); const key = 'opencode-web-lite:model-preferences:v1'; const preferences = parseModelPreferences(JSON.parse(localStorage.getItem(key) ?? '{}')); writePersistentValue(localStorage, key, JSON.stringify({ ...preferences, variants: { ...preferences.variants, [selectedModelKey]: event.target.value } }), 'preference'); selectionChanged()
      }}><option value="">Default variant</option>{selectedModel.variants.map((name) => <option key={name}>{name}</option>)}</select> : null}
      <input ref={fileInput} className="sr-only" aria-label="Choose prompt attachments" type="file" multiple accept="image/*,application/pdf,text/*,.md,.json,.yaml,.yml,.toml,.csv,.log,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.css,.html,.xml,.sql,.sh" onChange={inputFiles} />
      <button type="button" className="button-secondary" disabled={blocked || controlsLocked || composer.attachments.length >= 10} onClick={() => fileInput.current?.click()}>Attach</button>
      <button type="button" disabled={blocked || status === 'sending' || status === 'stopping' || (!composer.text.trim() && !composer.attachments.length && !contexts.length) || !agent || !selectedModelKey} onClick={() => void submit()}>{status === 'sending' ? 'Sending…' : busy ? 'Steer' : composer.mode === 'shell' ? 'Run' : 'Send'}</button>
      {busy || status === 'sending' || status === 'stopping' ? <button type="button" className="button-secondary" disabled={status === 'stopping'} onClick={() => void stop()}>{status === 'stopping' ? 'Stopping…' : 'Stop'}</button> : null}
    </div>
    {composer.mode === 'shell' ? <p className="composer-hint">Shell mode. Escape or Backspace exits when empty.</p> : <p className="composer-hint">Type @ for files and agents, / for commands, or ! for shell mode.</p>}
    {status === 'failed' ? <p className="form-error" role="alert">Submission failed. Your draft and attachments were restored.</p> : null}
    {attachmentError ? <p className="form-error" role="alert">{attachmentError}</p> : null}
    {storageFailed ? <p className="form-error" role="alert">This draft could not be saved in your browser.</p> : null}
    {status === 'sent' ? <p className="sr-status" role="status">Prompt sent.</p> : null}
  </section>
}

function DeferredModelPicker({ models, value, storageScope, disabled, onChange }: { models: ComposerOptions['models']; value: string; storageScope: string; disabled: boolean; onChange(value: string): void }) {
  const [loaded, setLoaded] = useState(false)
  const selected = models.find((model) => modelKey(model) === value)
  return loaded
    ? <Suspense fallback={<button type="button" disabled>Loading models...</button>}><ModelPicker models={models} value={value} storageScope={storageScope} disabled={disabled} initialOpen onChange={onChange} /></Suspense>
    : <button type="button" disabled={disabled} onClick={() => setLoaded(true)}>{selected ? `${selected.providerName} · ${selected.name}` : 'Choose model'}</button>
}

function readHistory(key: string) { try { const value = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 100) : [] } catch { return [] } }
function writeHistory(key: string, entries: string[]) { writePersistentValue(localStorage, key, JSON.stringify(entries), 'cache') }
function modelLabel(options: ComposerOptions, key: string) { const model = options.models.find((item) => modelKey(item) === key); return model ? `${model.providerName} · ${model.name}` : '' }
function formatBytes(bytes: number) { return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB` }

let lastMessageTimestamp = 0
let messageCounter = 0
function createMessageID() {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  const timestamp = Date.now()
  if (timestamp !== lastMessageTimestamp) { lastMessageTimestamp = timestamp; messageCounter = 0 }
  messageCounter += 1
  let sortable = BigInt(timestamp) * 0x1000n + BigInt(messageCounter)
  const prefix = new Uint8Array(6)
  for (let index = 0; index < 6; index += 1) prefix[index] = Number((sortable >> BigInt(40 - index * 8)) & 0xffn)
  const random = crypto.getRandomValues(new Uint8Array(14))
  return `msg_${Array.from(prefix, (byte) => byte.toString(16).padStart(2, '0')).join('')}${Array.from(random, (byte) => alphabet[byte % alphabet.length]).join('')}`
}
