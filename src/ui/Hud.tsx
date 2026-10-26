import { useSyncExternalStore } from 'react'
import type { Theme } from '../engine/core'
import { infoStore } from '../engine/info'
import type { Shape } from '../objects'
import { scanCredit } from '../objects/credit'
import { scanWords } from '../safety'

const KIND = { library: 'library', text: 'type', file: 'model', prompt: 'prompt', chat: 'scene' }
const STEPS = 11

// sample the ramp across its whole range so the legend shows how ink climbs; short ramps repeat
function ticks(ramp: string[]) {
  const out: string[] = []
  for (let i = 0; i < STEPS; i++) {
    const glyph = ramp[Math.round((i * (ramp.length - 1)) / (STEPS - 1))]
    if (out[out.length - 1] !== glyph) out.push(glyph)
  }
  return out.join('')
}

type Props = {
  shape: Shape | null
  status: string
  error: string
  theme?: Theme
  ramp?: string[] | string
  onRetry?: () => void
}

// The caption; it subscribes to the engine's info on its own so the canvas stays untouched
export function Hud({ shape, status, error, theme, ramp, onRetry }: Props) {
  // the third argument is the server snapshot, so the caption can be rendered without a browser
  const info = useSyncExternalStore(infoStore.subscribe, infoStore.get, infoStore.get)
  const glyphs = Array.isArray(ramp) ? ramp : ramp ? [...ramp] : []
  // The detail line carries the licence, which comes from the same third party as the credit
  // below it. It is scanned for the same reason the credit is, so one licence is not scanned
  // while the same licence printed a line above it goes out raw.
  const meta = shape
    ? scanWords(
        [shape.detail, shape.triangles ? `${shape.triangles.toLocaleString()} triangles` : ''].filter(Boolean).join(' · '),
        glyphs.join(''),
      )
    : ''
  // the engine marks work in progress with a trailing ellipsis
  const busy = !error && status.endsWith('…')
  // a searched model or drawing carries its credit, so the licence asks are answered on screen.
  // The words are scanned, because the author comes from a third party and a name can hold a
  // word the prompt box would refuse. The link is not, because a scan replaces a letter in
  // place and a scanned link points at nothing.
  const credit = shape?.source ? scanCredit(shape.source, glyphs.join('')) : null

  return (
    <section className="hud" aria-live="polite" data-theme={theme}>
      <div className="eyebrow">
        <span>{shape ? `${KIND[shape.kind]} · ${info.phase || 'ready'}` : `gen-ascii · ${info.phase || 'loading'}`}</span>
        <span>{info.glyphs ? `${info.glyphs.toLocaleString()} glyphs` : ''}</span>
      </div>
      <h1>{shape?.title ?? '…'}</h1>
      {meta && <p className="meta">{meta}</p>}
      {credit && credit.words && (
        <p className="credit">
          <span>{credit.words} · </span>
          <a href={credit.url} target="_blank" rel="noreferrer noopener">{credit.url}</a>
        </p>
      )}
      {glyphs.length > 1 && (
        <div className="legend" title={`${glyphs.length} glyphs, least ink first`}>
          <span className="end">light</span>
          <span className="ramp" aria-hidden="true">{ticks(glyphs)}</span>
          <span className="end">dense</span>
        </div>
      )}
      <div className="state">
        {error ? (
          <div className="error">
            <p>{error}</p>
            {onRetry && <button type="button" onClick={onRetry}>retry</button>}
          </div>
        ) : busy ? (
          <div className="load">
            <span>{status}</span>
            <span className="track" aria-hidden="true" />
          </div>
        ) : (
          <p className="status">{status}</p>
        )}
      </div>
    </section>
  )
}
