import { useServerFn } from '@tanstack/react-start'
import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import type { SessionSnapshot } from '~/lib/session-snapshot'
import { rejectQuestionMutation, replyPermissionMutation, replyQuestionMutation } from '~/functions/requests'

type Props = Readonly<{
  serverKey: string
  directory: string
  permission: SessionSnapshot['permission']
  question: SessionSnapshot['question']
  unavailable: boolean
}>

export function SessionRequests(props: Props) {
  const replyPermission = useServerFn(replyPermissionMutation)
  const replyQuestion = useServerFn(replyQuestionMutation)
  const rejectQuestion = useServerFn(rejectQuestionMutation)
  const router = useRouter()
  const [answers, setAnswers] = useState<string[][]>(
    () => props.question?.questions.map(() => []) ?? [],
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function permission(reply: 'once' | 'always' | 'reject') {
    if (!props.permission || pending) return
    setPending(true)
    setError('')
    try {
      await replyPermission({
        data: {
          serverKey: props.serverKey,
          sessionID: props.permission.sessionID,
          directory: props.directory,
          requestID: props.permission.id,
          reply,
        },
      })
      await router.invalidate().catch(() => {})
    } catch {
      setError('This permission could not be answered. It may no longer be pending.')
    } finally {
      setPending(false)
    }
  }

  async function submitAnswers() {
    if (!props.question || pending) return
    setPending(true)
    setError('')
    try {
      await replyQuestion({
        data: {
          serverKey: props.serverKey,
          sessionID: props.question.sessionID,
          directory: props.directory,
          requestID: props.question.id,
          answers,
        },
      })
      await router.invalidate().catch(() => {})
    } catch {
      setError('Answer every question, then retry. The request may no longer be pending.')
    } finally {
      setPending(false)
    }
  }

  async function reject() {
    if (!props.question || pending) return
    setPending(true)
    setError('')
    try {
      await rejectQuestion({
        data: {
          serverKey: props.serverKey,
          sessionID: props.question.sessionID,
          requestID: props.question.id,
        },
      })
      await router.invalidate().catch(() => {})
    } catch {
      setError('This question could not be rejected.')
    } finally {
      setPending(false)
    }
  }

  function toggle(index: number, label: string, multiple: boolean) {
    setAnswers((current) =>
      current.map((answer, answerIndex) => {
        if (answerIndex !== index) return answer
        if (!multiple) return [label]
        return answer.includes(label)
          ? answer.filter((item) => item !== label)
          : [...answer, label]
      }),
    )
  }

  if (!props.permission && !props.question && !props.unavailable) return null
  return (
    <aside className="request-dock" aria-label="Requests needing your response">
      {props.unavailable ? (
        <p className="form-error" role="alert">Pending requests could not be loaded. Prompt submission is paused for safety.</p>
      ) : null}
      {props.permission ? (
        <section aria-labelledby="permission-heading">
          <p className="eyebrow">Permission</p>
          <h2 id="permission-heading">Allow {props.permission.permission}?</h2>
          <ul>{props.permission.patterns.map((pattern) => <li key={pattern}>{pattern}</li>)}</ul>
          {props.permission.always.length ? (
            <div className="always-scope">
              <strong>Always allow would persist for:</strong>
              <ul>{props.permission.always.map((pattern) => <li key={pattern}>{pattern}</li>)}</ul>
              <p>This directory-scoped rule can be revoked in OpenCode configuration.</p>
            </div>
          ) : null}
          {!props.permission.complete ? <p className="form-error">The full permission scope is too large to display safely.</p> : null}
          <div className="action-row">
            <button type="button" disabled={pending || !props.permission.complete} onClick={() => void permission('once')}>Allow once</button>
            <button type="button" disabled={pending || !props.permission.complete || !props.permission.always.length} onClick={() => void permission('always')}>Always allow</button>
            <button type="button" disabled={pending} onClick={() => void permission('reject')}>Reject</button>
          </div>
        </section>
      ) : null}
      {props.question ? (
        <section aria-labelledby="question-heading">
          <p className="eyebrow">Question</p>
          <h2 id="question-heading">The agent needs input</h2>
          {!props.question.complete ? <p className="form-error">This question is too large to answer safely here.</p> : null}
          {props.question.questions.map((question, index) => (
            <fieldset key={`${props.question?.id}-${question.header}`}>
              <legend><strong>{question.header}</strong><span>{question.question}</span></legend>
              {question.options.map((option) => (
                <label key={option.label}>
                  <input
                    type={question.multiple ? 'checkbox' : 'radio'}
                    name={`question-${index}`}
                    checked={answers[index]?.includes(option.label) ?? false}
                    onChange={() => toggle(index, option.label, question.multiple)}
                  />
                  <span><strong>{option.label}</strong><small>{option.description}</small></span>
                </label>
              ))}
              {question.custom ? (
                <label>
                  <span>Custom answer</span>
                  <input type="text" onChange={(event) => {
                    const value = event.target.value.trim()
                    const optionLabels = new Set(question.options.map((option) => option.label))
                    setAnswers((current) => current.map((answer, answerIndex) =>
                      answerIndex === index
                        ? question.multiple
                          ? [...answer.filter((item) => optionLabels.has(item)), ...(value ? [value] : [])]
                          : value ? [value] : []
                        : answer,
                    ))
                  }} />
                </label>
              ) : null}
            </fieldset>
          ))}
          <div className="action-row">
            <button type="button" disabled={pending || !props.question.complete} onClick={() => void submitAnswers()}>Submit answers</button>
            <button type="button" disabled={pending} onClick={() => void reject()}>Reject question</button>
          </div>
        </section>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </aside>
  )
}
