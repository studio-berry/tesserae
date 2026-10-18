import { TINTS, Theme, TintId } from '../engine/core'
import { CHARSETS, CharsetId } from '../engine/glyphs'

type Props = {
  open: boolean
  theme: Theme
  charset: CharsetId; setCharset: (c: CharsetId) => void
  custom: string; setCustom: (s: string) => void
  tint: TintId; setTint: (t: TintId) => void; hasColor: boolean
  density: number; setDensity: (n: number) => void
  spin: boolean; setSpin: (b: boolean) => void
  onBurst: () => void; onReroll: () => void; onCopy: () => void; onPng: () => void
}

const SETS = [...(Object.keys(CHARSETS) as (keyof typeof CHARSETS)[]), 'custom'] as const

export function Panel(p: Props) {
  return (
    <aside className={p.open ? 'panel open' : 'panel'} aria-label="Tune">
      <div className="row">
        <span className="label">glyphs</span>
        <div className="chips">
          {SETS.map((id) => (
            <button key={id} type="button" className={p.charset === id ? 'on' : ''} onClick={() => p.setCharset(id)}>{id}</button>
          ))}
        </div>
      </div>
      {p.charset === 'custom' && (
        <input className="field" value={p.custom} onChange={(e) => p.setCustom(e.target.value)} placeholder="type your own characters" maxLength={96} spellCheck={false} />
      )}
      <div className="row">
        <span className="label">ink</span>
        <div className="swatches">
          {TINTS.map((t) => (
            <button key={t.id} type="button" title={t.id} aria-label={t.id} aria-pressed={p.tint === t.id} className={p.tint === t.id ? 'sw on' : 'sw'} onClick={() => p.setTint(t.id)}>
              <i style={{ background: t[p.theme] }} />
            </button>
          ))}
          {p.hasColor && (
            <button type="button" title="the object's own colours" aria-label="source colours" aria-pressed={p.tint === 'source'} className={p.tint === 'source' ? 'sw on' : 'sw'} onClick={() => p.setTint('source')}>
              <i className="src" />
            </button>
          )}
        </div>
      </div>
      <label className="row">
        <span className="label">density</span>
        <input type="range" min={1500} max={12000} step={500} value={p.density} onChange={(e) => p.setDensity(+e.target.value)} />
        <b>{(p.density / 1000).toFixed(1)}k</b>
      </label>
      <div className="row">
        <span className="label">motion</span>
        <div className="chips">
          <button type="button" className={p.spin ? 'on' : ''} aria-pressed={p.spin} onClick={() => p.setSpin(!p.spin)}>spin</button>
          <button type="button" onClick={p.onBurst}>scatter</button>
        </div>
      </div>
      <div className="actions">
        <button type="button" onClick={p.onReroll}>reroll</button>
        <button type="button" onClick={p.onCopy}>copy text</button>
        <button type="button" onClick={p.onPng}>save png</button>
      </div>
    </aside>
  )
}
