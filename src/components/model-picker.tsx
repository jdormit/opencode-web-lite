import { useEffect, useRef, useState } from 'react'

import type { ComposerModel } from '~/lib/composer-options'
import { emptyModelPreferences, modelKey, parseModelPreferences, pushRecent, searchModels, type ModelPreferences } from '~/lib/composer-models'
import { writePersistentValue } from '~/lib/persistence'

type Props = {
  models: ComposerModel[]
  value: string
  storageScope: string
  disabled?: boolean
  initialOpen?: boolean
  onChange(value: string): void
}

const preferenceKey = 'opencode-web-lite:model-preferences:v1'

export function ModelPicker({ models, value, storageScope, disabled, initialOpen = false, onChange }: Props) {
  const [open, setOpen] = useState(initialOpen)
  const [query, setQuery] = useState('')
  const [preferences, setPreferences] = useState<ModelPreferences>(emptyModelPreferences)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    try { setPreferences(parseModelPreferences(JSON.parse(localStorage.getItem(preferenceKey) ?? '{}'))) } catch {}
  }, [])
  useEffect(() => { if (open) input.current?.focus() }, [open])
  const persist = (next: ModelPreferences) => {
    setPreferences(next)
    writePersistentValue(localStorage, preferenceKey, JSON.stringify(next), 'preference')
  }
  const selected = models.find((model) => modelKey(model) === value)
  const visible = searchModels(models, query, preferences.hidden)
  const groups = new Map<string, ComposerModel[]>()
  for (const model of visible) groups.set(model.providerName, [...(groups.get(model.providerName) ?? []), model])
  const choose = (model: ComposerModel) => {
    const key = modelKey(model)
    persist({ ...pushRecent(preferences, key), workspaces: { ...preferences.workspaces, [storageScope]: key } })
    onChange(key)
    setOpen(false)
    setQuery('')
  }
  return <div className="model-picker">
    <button type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      {selected ? `${selected.providerName} · ${selected.name}` : 'Choose model'}
    </button>
    {open ? <div className="picker-popover" role="dialog" aria-label="Choose model">
      <input ref={input} type="search" value={query} placeholder="Search models and providers" aria-label="Search models" onChange={(event) => setQuery(event.target.value)} />
      {preferences.recent.length && !query ? <section><h3>Recent</h3>{preferences.recent.flatMap((key) => {
        const model = models.find((candidate) => modelKey(candidate) === key)
        return model ? [<ModelButton key={`recent:${key}`} model={model} selected={key === value} onClick={() => choose(model)} />] : []
      })}</section> : null}
      {[...groups].map(([provider, entries]) => <section key={provider}><h3>{provider}</h3>
        {entries.map((model) => <ModelButton key={modelKey(model)} model={model} selected={modelKey(model) === value} onClick={() => choose(model)} />)}
      </section>)}
      {!visible.length ? <p>No matching visible models.</p> : null}
      <button type="button" className="button-secondary" onClick={() => setOpen(false)}>Close</button>
    </div> : null}
  </div>
}

function ModelButton({ model, selected, onClick }: { model: ComposerModel; selected: boolean; onClick(): void }) {
  const metadata = [model.capabilities?.reasoning ? 'Reasoning' : '', model.capabilities?.image ? 'Images' : '', model.capabilities?.pdf ? 'PDF' : '', model.contextLimit ? `${Intl.NumberFormat('en-US', { notation: 'compact' }).format(model.contextLimit)} context` : ''].filter(Boolean).join(' · ')
  return <button type="button" className="picker-option" aria-pressed={selected} onClick={onClick}>
    <span>{model.name}</span><small>{model.modelID}{metadata ? ` · ${metadata}` : ''}</small>
  </button>
}

export function ModelVisibilitySettings({ models }: { models: ComposerModel[] }) {
  const [preferences, setPreferences] = useState<ModelPreferences>(emptyModelPreferences)
  const [query, setQuery] = useState('')
  useEffect(() => { try { setPreferences(parseModelPreferences(JSON.parse(localStorage.getItem(preferenceKey) ?? '{}'))) } catch {} }, [])
  const matching = searchModels(models, query)
  const hidden = new Set(preferences.hidden)
  const toggle = (key: string) => {
    const next = { ...preferences, hidden: hidden.has(key) ? preferences.hidden.filter((item) => item !== key) : [...preferences.hidden, key] }
    setPreferences(next)
    writePersistentValue(localStorage, preferenceKey, JSON.stringify(next), 'preference')
  }
  return <section className="model-settings"><h2>Model visibility</h2>
    <input type="search" value={query} placeholder="Search models" onChange={(event) => setQuery(event.target.value)} />
    {matching.map((model) => <label key={modelKey(model)}><input type="checkbox" checked={!hidden.has(modelKey(model))} onChange={() => toggle(modelKey(model))} /> {model.providerName} · {model.name}</label>)}
  </section>
}
