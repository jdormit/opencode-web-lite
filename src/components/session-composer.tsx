import { useServerFn } from '@tanstack/react-start'
import { useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import type { ComposerOptions } from '~/lib/composer-options'
import { sendPromptMutation, stopSessionMutation } from '~/functions/prompt'

type Props = Readonly<{
  serverKey: string
  sessionID: string
  options: ComposerOptions
  busy: boolean
}>

export function SessionComposer({ serverKey, sessionID, options, busy }: Props) {
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
  const submitting = useRef(false)
  const textRef = useRef('')
  const draftKey = `opencode-web-lite:session-draft:v1:${serverKey}:${sessionID}`

  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey) ?? ''
      setText(saved)
      textRef.current = saved
    } catch {}
  }, [draftKey])

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

  async function submit() {
    if (submitting.current || !text.trim() || !agent || !modelKey) return
    submitting.current = true
    setState('sending')
    const submittedText = text
    setSubmittedText(submittedText)
    const messageID = retryMessageID || createMessageID()
    setRetryMessageID(messageID)
    const [providerID = '', modelID = ''] = modelKey.split('\0')
    try {
      await sendPrompt({
        data: { serverKey, sessionID, messageID, text: submittedText, agent, providerID, modelID, variant },
      })
      if (textRef.current === submittedText) updateText('')
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
      if (textRef.current === submittedText) updateText(submittedText)
    } finally {
      submitting.current = false
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

  function selectionChanged() {
    setRetryMessageID('')
    if (state === 'failed') setState('idle')
  }

  return (
    <section className="composer" aria-label="Prompt composer">
      {!options.agents.length || !options.models.length ? (
        <p className="form-error" role="alert">No selectable agent or connected model is available.</p>
      ) : null}
      {state === 'sending' && submittedText ? (
        <div className="optimistic-message" aria-label="Sending prompt">{submittedText}</div>
      ) : null}
      <textarea
        aria-label="Prompt"
        value={text}
        onChange={(event) => updateText(event.target.value)}
        onKeyDown={keyDown}
        placeholder="Ask OpenCode..."
        maxLength={100_000}
        rows={4}
      />
      <div className="composer-controls">
        <select aria-label="Agent" value={agent} onChange={(event) => {
          setAgent(event.target.value)
          selectionChanged()
        }}>
          {options.agents.map((option) => <option key={option.name}>{option.name}</option>)}
        </select>
        <select aria-label="Model" value={modelKey} onChange={(event) => {
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
          <select aria-label="Variant" value={variant} onChange={(event) => {
            setVariant(event.target.value)
            selectionChanged()
          }}>
            <option value="">Default</option>
            {selectedModel.variants.map((name) => <option key={name}>{name}</option>)}
          </select>
        ) : null}
        <button type="button" disabled={state === 'sending' || state === 'stopping' || !text.trim() || !agent || !modelKey} onClick={() => void submit()}>
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
