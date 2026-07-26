import { useServerFn } from '@tanstack/react-start'
import { useRouter } from '@tanstack/react-router'
import { useEffect, useEffectEvent, useRef, useState, type KeyboardEvent } from 'react'

import type { ComposerOptions } from '~/lib/composer-options'
import { sendPromptMutation, stopSessionMutation } from '~/functions/prompt'
import { buildPromptText, parsePromptContexts, setPromptContextLock, type PromptContextItem } from '~/lib/prompt-context'

type Props = Readonly<{
  serverKey: string
  sessionID: string
  options: ComposerOptions
  busy: boolean
  blocked: boolean
}>

export function SessionComposer({ serverKey, sessionID, options, busy, blocked }: Props) {
  const sendPrompt = useServerFn(sendPromptMutation)
  const stopSession = useServerFn(stopSessionMutation)
  const router = useRouter()
  const [text, setText] = useState('')
  const [agent, setAgent] = useState(options.defaultAgent ?? '')
  const [modelKey, setModelKey] = useState(
    options.defaultModel ? `${options.defaultModel.providerID}\0${options.defaultModel.modelID}` : '',
  )
  const [variant, setVariant] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed' | 'stopping'>('idle')
  const [submittedText, setSubmittedText] = useState('')
  const [retryMessageID, setRetryMessageID] = useState('')
  const [storageFailed, setStorageFailed] = useState(false)
  const [contexts, setContexts] = useState<PromptContextItem[]>([])
  const [accepting, setAccepting] = useState(false)
  const submitting = useRef(false)
  const textRef = useRef('')
  const draftKey = `opencode-web-lite:session-draft:v1:${serverKey}:${sessionID}`
  const contextKey = `opencode-web-lite:session-contexts:v1:${serverKey}:${sessionID}`

  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey) ?? ''
      setText(saved)
      textRef.current = saved
      setContexts(parsePromptContexts(JSON.parse(localStorage.getItem(contextKey) ?? '[]')))
    } catch {}
  }, [contextKey, draftKey])

  useEffect(() => {
    if (!options.agents.some((option) => option.name === agent))
      {
        setAgent(options.defaultAgent ?? options.agents[0]?.name ?? '')
        setRetryMessageID('')
      }
    if (!options.models.some((model) => `${model.providerID}\0${model.modelID}` === modelKey)) {
      const fallback = options.defaultModel
        ? `${options.defaultModel.providerID}\0${options.defaultModel.modelID}`
        : options.models[0]
          ? `${options.models[0].providerID}\0${options.models[0].modelID}`
          : ''
      setModelKey(fallback)
      setVariant('')
      setRetryMessageID('')
    }
  }, [agent, modelKey, options])

  function updateText(value: string) {
    setText(value)
    textRef.current = value
    if ((state === 'failed' || state === 'sending') && value !== submittedText) {
      setRetryMessageID('')
      setState('idle')
    }
    try {
      localStorage.setItem(draftKey, value)
      setStorageFailed(false)
    } catch {
      setStorageFailed(true)
    }
  }

  const syncDraft = useEffectEvent((event: Event) => {
    const detail = (event as CustomEvent<{ key?: unknown; contexts?: unknown }>).detail
    if (detail?.key !== draftKey) return
    setContexts(parsePromptContexts(detail.contexts))
    setRetryMessageID('')
    if (state === 'failed') setState('idle')
  })

  useEffect(() => {
    window.addEventListener('opencode:draft-updated', syncDraft)
    return () => window.removeEventListener('opencode:draft-updated', syncDraft)
  }, [])

  async function submit() {
    const promptText = buildPromptText(text, contexts)
    if (submitting.current || !promptText?.trim() || !agent || !modelKey) return
    submitting.current = true
    setAccepting(true)
    setPromptContextLock(contextKey, true)
    setState('sending')
    const submittedDraft = text
    const submittedContextIDs = new Set(contexts.map((item) => item.id))
    setSubmittedText(submittedDraft || `${contexts.length} context item${contexts.length === 1 ? '' : 's'}`)
    const messageID = retryMessageID || createMessageID()
    setRetryMessageID(messageID)
    const [providerID = '', modelID = ''] = modelKey.split('\0')
    try {
      await sendPrompt({
        data: { serverKey, sessionID, messageID, text: promptText, agent, providerID, modelID, variant },
      })
      if (textRef.current === submittedDraft) updateText('')
      try { localStorage.removeItem(contextKey) } catch { setStorageFailed(true) }
      setContexts((current) => current.filter((item) => !submittedContextIDs.has(item.id)))
      setState('sent')
      setRetryMessageID('')
      try {
        await router.invalidate()
      } catch {}
      setState('idle')
      setSubmittedText('')
      for (const delay of [500, 1_500, 3_000]) {
        setTimeout(() => void router.invalidate().catch(() => {}), delay)
      }
    } catch {
      setState('failed')
      if (textRef.current === submittedDraft) updateText(submittedDraft)
    } finally {
      submitting.current = false
      setAccepting(false)
      setPromptContextLock(contextKey, false)
    }
  }

  async function stop() {
    if (state === 'stopping') return
    setState('stopping')
    try {
      await stopSession({ data: { serverKey, sessionID } })
      await router.invalidate()
      setState('idle')
    } catch {
      setState('failed')
    }
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.repeat || event.nativeEvent.isComposing)
      return
    if (matchMedia('(pointer: coarse)').matches) return
    event.preventDefault()
    void submit()
  }

  const selectedModel = options.models.find(
    (model) => `${model.providerID}\0${model.modelID}` === modelKey,
  )
  const currentPrompt = buildPromptText(text, contexts)
  const controlsLocked = accepting || state === 'stopping'

  function selectionChanged() {
    setRetryMessageID('')
    if (state === 'failed') setState('idle')
  }

  function removeContext(id: string) {
    const next = contexts.filter((item) => item.id !== id)
    setContexts(next)
    setRetryMessageID('')
    if (state === 'failed') setState('idle')
    try { localStorage.setItem(contextKey, JSON.stringify(next)) } catch { setStorageFailed(true) }
  }

  return (
    <section className="composer" aria-label="Prompt composer">
      {!options.agents.length || !options.models.length ? (
        <p className="form-error" role="alert">No selectable agent or connected model is available.</p>
      ) : null}
      {blocked ? <p className="form-error" role="status">Answer the pending request before sending another prompt.</p> : null}
      {currentPrompt === undefined ? <p className="form-error" role="alert">Prompt text and context exceed the 100,000-character limit.</p> : null}
      {state === 'sending' && submittedText ? (
        <div className="optimistic-message" aria-label="Sending prompt">{submittedText}</div>
      ) : null}
      {contexts.length ? <ul className="composer-contexts" aria-label="Prompt context">
        {contexts.map((item) => <li key={item.id}>
          <span><strong>{item.type === 'file' ? 'File' : 'Diff'}</strong> {item.label}</span>
          <button type="button" disabled={controlsLocked} aria-label={`Remove ${item.label}`} onClick={() => removeContext(item.id)}>Remove</button>
        </li>)}
      </ul> : null}
      <textarea
        aria-label="Prompt"
        value={text}
        onChange={(event) => updateText(event.target.value)}
        onKeyDown={keyDown}
        placeholder="Ask OpenCode..."
        maxLength={100_000}
        rows={4}
        disabled={blocked || controlsLocked}
      />
      <div className="composer-controls">
        <select disabled={blocked || controlsLocked} aria-label="Agent" value={agent} onChange={(event) => {
          setAgent(event.target.value)
          selectionChanged()
        }}>
          {options.agents.map((option) => <option key={option.name}>{option.name}</option>)}
        </select>
        <select disabled={blocked || controlsLocked} aria-label="Model" value={modelKey} onChange={(event) => {
          setModelKey(event.target.value)
          setVariant('')
          selectionChanged()
        }}>
          {options.models.map((model) => (
            <option key={`${model.providerID}/${model.modelID}`} value={`${model.providerID}\0${model.modelID}`}>
              {model.providerName} · {model.name}
            </option>
          ))}
        </select>
        {selectedModel?.variants.length ? (
          <select disabled={blocked || controlsLocked} aria-label="Variant" value={variant} onChange={(event) => {
            setVariant(event.target.value)
            selectionChanged()
          }}>
            <option value="">Default</option>
            {selectedModel.variants.map((name) => <option key={name}>{name}</option>)}
          </select>
        ) : null}
        <button type="button" disabled={blocked || state === 'sending' || state === 'stopping' || !currentPrompt?.trim() || !agent || !modelKey} onClick={() => void submit()}>
          {state === 'sending' ? 'Sending...' : busy ? 'Steer' : 'Send'}
        </button>
        {busy || state === 'sending' || state === 'stopping' ? (
          <button type="button" className="button-secondary" disabled={state === 'stopping'} onClick={() => void stop()}>
            {state === 'stopping' ? 'Stopping...' : 'Stop'}
          </button>
        ) : null}
      </div>
      {state === 'failed' ? <p className="form-error" role="alert">Prompt failed. Your draft was restored.</p> : null}
      {storageFailed ? <p className="form-error" role="alert">This draft could not be saved in your browser.</p> : null}
      {state === 'sent' ? <p className="sr-status" role="status">Prompt sent.</p> : null}
    </section>
  )
}

let lastMessageTimestamp = 0
let messageCounter = 0

function createMessageID() {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  const timestamp = Date.now()
  if (timestamp !== lastMessageTimestamp) {
    lastMessageTimestamp = timestamp
    messageCounter = 0
  }
  messageCounter += 1
  let sortable = BigInt(timestamp) * 0x1000n + BigInt(messageCounter)
  const prefix = new Uint8Array(6)
  for (let index = 0; index < 6; index += 1) {
    prefix[index] = Number((sortable >> BigInt(40 - index * 8)) & 0xffn)
  }
  const random = crypto.getRandomValues(new Uint8Array(14))
  const time = Array.from(prefix, (byte) => byte.toString(16).padStart(2, '0')).join('')
  const suffix = Array.from(random, (byte) => alphabet[byte % alphabet.length]).join('')
  return `msg_${time}${suffix}`
}
