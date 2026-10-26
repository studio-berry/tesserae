import { FormEvent, useSyncExternalStore } from 'react'
import { chatStore } from '../objects/generate'

type Props = {
  value: string
  setValue: (s: string) => void
  onSubmit: (s: string) => void
  onVariant: () => void
  error: string
  busy: boolean
  ready: boolean
}

const HINT = 'describe anything: a fox, a padlock, a lighthouse'
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`

// The chat box. A prompt goes to the scene writer, the writer's code becomes geometry, and the
// engine draws it. The four states this shows are the four the request has: waiting on the model,
// a scene that is being built, a scene on screen with what wrote it, and a refusal.
//
// A refusal is the app's own sentence and never names a word, so the error is printed as it arrives.
export function Chat({ value, setValue, onSubmit, onVariant, error, busy, ready }: Props) {
  const progress = useSyncExternalStore(chatStore.subscribe, chatStore.get, chatStore.get)
  // the two halves of the wait read differently, and telling them apart is the point of the box:
  // the model's own seconds, then the app's own build
  const asking = progress.phase === 'asking'
  const drawing = progress.phase === 'ready' && busy

  const send = (e: FormEvent) => {
    e.preventDefault()
    const clean = value.trim()
    if (clean && !busy) onSubmit(clean)
  }

  const line = error
    ? error
    : asking
      ? 'asking the scene writer…'
      : drawing
        ? `drawing ${progress.title || 'the scene'}…`
        : progress.phase === 'ready' && ready
          ? `${progress.title} · ${progress.ms ? `written in ${secs(progress.ms)} · ` : ''}${progress.model || 'scene writer'}`
          : progress.phase === 'failed'
            ? progress.why
            : HINT

  return (
    <section className={asking || busy ? 'chat working' : 'chat'} aria-label="Describe something">
      <form onSubmit={send}>
        <input
          className="field"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={80}
          placeholder={HINT}
          spellCheck={false}
          aria-label="What to draw"
        />
        <button type="submit" disabled={busy || !value.trim()}>{busy ? 'writing…' : 'send'}</button>
        {ready && !busy && progress.phase === 'ready' && (
          <button type="button" className="ghost" onClick={onVariant} title="another reading of the same prompt">variant</button>
        )}
      </form>
      <p className="chat-line" aria-live="polite">{line}</p>
    </section>
  )
}
