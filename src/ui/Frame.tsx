import { useCallback, useEffect, useState } from 'react'

const SEEN = 'gen-ascii.seen'

// blocked storage should quiet the coach instead of showing it on every load
function greeted() {
  try {
    return !!localStorage.getItem(SEEN)
  } catch {
    return true
  }
}

// a dashed plate edge with registration marks over the canvas, under every control
export function Frame() {
  return (
    <div className="frame" aria-hidden="true">
      <i className="tl">+</i>
      <i className="tr">+</i>
      <i className="bl">+</i>
      <i className="br">+</i>
    </div>
  )
}

const STEPS = [
  ['drag', 'turn the object'],
  ['space', 'scatter it'],
  ['drop', 'a model anywhere'],
] as const

// the first visit gets three pointers and a way out; after that it stays out of the way
export function Coach({ open, onDone }: { open?: boolean; onDone?: () => void }) {
  const [seen, setSeen] = useState(greeted)
  const close = useCallback(() => {
    setSeen(true)
    try {
      localStorage.setItem(SEEN, '1')
    } catch {
      // private windows refuse this, so the coach simply returns next time
    }
    onDone?.()
  }, [onDone])
  const show = !seen && (open ?? true)

  useEffect(() => {
    if (!show) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [show, close])

  if (!show) return null

  return (
    <aside className="coach" aria-label="how it works">
      <h2>three things to try</h2>
      <ul>
        {STEPS.map(([key, what]) => (
          <li key={key}>
            <kbd>{key}</kbd>
            <span>{what}</span>
          </li>
        ))}
      </ul>
      <button type="button" onClick={close}>got it</button>
    </aside>
  )
}
