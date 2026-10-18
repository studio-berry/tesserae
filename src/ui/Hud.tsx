import { useSyncExternalStore } from 'react'
import { infoStore } from '../engine/info'
import type { Shape } from '../objects'

const KIND = { library: 'Library', text: 'Type', file: 'Model' }

// The caption; it subscribes to the engine's info on its own so the canvas stays untouched
export function Hud({ shape, status, error }: { shape: Shape | null; status: string; error: string }) {
  const info = useSyncExternalStore(infoStore.subscribe, infoStore.get)
  const meta = shape ? [shape.detail, shape.triangles ? `${shape.triangles.toLocaleString()} triangles` : ''].filter(Boolean).join(' · ') : ''
  return (
    <section className="hud" aria-live="polite">
      <div className="eyebrow">
        <span>{shape ? KIND[shape.kind] : 'gen-ascii'} · {info.phase || 'loading'}</span>
        <span>{info.glyphs ? `${info.glyphs.toLocaleString()} glyphs` : ''}</span>
      </div>
      <h1>{shape?.title ?? '…'}</h1>
      {meta && <div className="meta">{meta}</div>}
      <div className={error ? 'status error' : 'status'}>{error || status}</div>
    </section>
  )
}
