import { PALETTES, Theme, TintId, paletteInk } from '../engine/core'
import { CHARSETS, CharsetId } from '../engine/glyphs'

type Props = {
  open: boolean
  theme: Theme
  charset: CharsetId; setCharset: (c: CharsetId) => void
  custom: string; setCustom: (s: string) => void
  palette: TintId; setPalette: (t: TintId) => void; hasColor: boolean
  density: number; setDensity: (n: number) => void
  spin: boolean; setSpin: (b: boolean) => void
  surprise?: boolean; setSurprise?: (b: boolean) => void
  edges?: boolean; setEdges?: (b: boolean) => void
  onBurst: () => void; onReroll: () => void; onText: () => void; onPng: () => void
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
        <span className="label">palette</span>
        <div className="chips">
          {PALETTES.map((t) => (
            <button key={t.id} type="button" title={t.name} aria-pressed={p.palette === t.id} className={p.palette === t.id ? 'chip on' : 'chip'} onClick={() => p.setPalette(t.id)}>
              <i style={{ background: paletteInk(t.id, p.theme) }} />{t.name}
            </button>
          ))}
          {p.hasColor && (
            <button type="button" title="the object's own colours" aria-pressed={p.palette === 'source'} className={p.palette === 'source' ? 'chip on' : 'chip'} onClick={() => p.setPalette('source')}>
              <i className="src" />source
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
          <button type="button" className={p.surprise ? 'on' : ''} aria-pressed={!!p.surprise} onClick={() => p.setSurprise?.(!p.surprise)}>surprise</button>
        </div>
      </div>
      <div className="row">
        <span className="label">look</span>
        <div className="chips">
          <button type="button" className={p.edges ? 'on' : ''} aria-pressed={!!p.edges} onClick={() => p.setEdges?.(!p.edges)}>edges</button>
        </div>
      </div>
      <div className="actions">
        <button type="button" onClick={p.onReroll}>reroll</button>
        <button type="button" onClick={p.onBurst}>scatter</button>
        <button type="button" onClick={p.onText}>as text</button>
        <button type="button" onClick={p.onPng}>as png</button>
      </div>
    </aside>
  )
}
