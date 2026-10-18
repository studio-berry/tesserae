import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Mode, Theme, TintId, TINTS } from './engine/core'
import { buildAtlas, CHARSETS, CharsetId, charsFor } from './engine/glyphs'
import { stageApi } from './engine/info'
import { Post } from './engine/Post'
import { Stage } from './engine/Stage'
import { prepare, Shape, Source } from './objects'
import { LIBRARY } from './objects/library'
import { ACCEPT } from './objects/formats'
import { Export, ExportItem } from './ui/Export'
import { Hud } from './ui/Hud'
import { Panel } from './ui/Panel'

const MODES: Mode[] = ['letters', 'grid', 'dots']
const HINT = 'drag to turn · tap to ripple · drop a model anywhere'
const systemDark = () => matchMedia('(prefers-color-scheme: dark)').matches
// phones start with fewer, larger glyphs
const DEFAULT_DENSITY = Math.min(innerWidth, innerHeight) < 500 ? 4500 : 6000

// Settings live in the URL so a view can be shared (dropped files excepted)
function readUrl() {
  const q = new URLSearchParams(location.search)
  const o = q.get('o'), text = q.get('text')
  const source: Source = text ? { kind: 'text', text } : { kind: 'library', id: LIBRARY.some((l) => l.id === o) ? o! : LIBRARY[0].id }
  const pickOf = <T extends string>(v: string | null, all: readonly T[], d: T) => (all.includes(v as T) ? (v as T) : d)
  return {
    source, text: text ?? 'ascii',
    seed: Math.max(0, parseInt(q.get('seed') ?? '0') || 0),
    density: Math.max(1500, Math.min(12000, parseInt(q.get('n') ?? '') || DEFAULT_DENSITY)),
    mode: pickOf(q.get('mode'), MODES, 'letters'),
    theme: pickOf(q.get('theme') ?? document.documentElement.dataset.theme ?? null, ['dark', 'light'] as const, systemDark() ? 'dark' : 'light'),
    tint: pickOf(q.get('ink'), [...TINTS.map((t) => t.id), 'source'] as TintId[], 'ivory'),
    charset: pickOf(q.get('glyphs'), [...Object.keys(CHARSETS), 'custom'] as CharsetId[], 'letters'),
  }
}

export default function App() {
  const init = useMemo(readUrl, [])
  const [source, setSource] = useState<Source>(init.source)
  const [text, setText] = useState(init.text)
  const [seed, setSeed] = useState(init.seed)
  const [density, setDensity] = useState(init.density)
  const [draftDensity, setDraftDensity] = useState(init.density)
  const [mode, setMode] = useState<Mode>(init.mode)
  const [theme, setTheme] = useState<Theme>(init.theme)
  const [tint, setTint] = useState<TintId>(init.tint)
  const [charset, setCharset] = useState<CharsetId>(init.charset)
  const [custom, setCustom] = useState('')
  const [spin, setSpin] = useState(true)
  const [shape, setShape] = useState<Shape | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [fontsReady, setFontsReady] = useState(false)
  const [tune, setTune] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  // the glyph atlas is drawn in Plex Mono; wait so it rasterises the right shapes
  useEffect(() => { document.fonts.load('500 54px "IBM Plex Mono"').finally(() => setFontsReady(true)) }, [])

  const atlas = useMemo(() => {
    if (!fontsReady) return null
    const c = charsFor(charset, custom)
    return buildAtlas(c.chars, c.jitter)
  }, [fontsReady, charset, custom])
  useEffect(() => () => atlas?.tex.dispose(), [atlas])

  // the slider moves freely; the object resamples once it rests
  useEffect(() => { const t = setTimeout(() => setDensity(draftDensity), 250); return () => clearTimeout(t) }, [draftDensity])

  // typing rebuilds the type a moment after the last key
  useEffect(() => {
    if (source.kind !== 'text') return
    const clean = text.trim().slice(0, 40)
    if (!clean || clean === source.text) return
    const t = setTimeout(() => setSource({ kind: 'text', text: clean }), 400)
    return () => clearTimeout(t)
  }, [text, source])

  useEffect(() => {
    let live = true
    setBusy(true)
    // yield a frame first so the UI shows the change before sampling blocks the thread
    const t = setTimeout(() => {
      prepare(source, density, seed)
        .then((s) => { if (live) { setShape(s); setError('') } })
        .catch((err: Error) => { if (live) setError(err.message || 'Could not build that object.') })
        .finally(() => { if (live) setBusy(false) })
    }, 16)
    return () => { live = false; clearTimeout(t) }
  }, [source, density, seed])

  useEffect(() => {
    const q = new URLSearchParams()
    if (source.kind === 'library') q.set('o', source.id)
    if (source.kind === 'text') q.set('text', source.text)
    if (seed) q.set('seed', String(seed))
    if (density !== DEFAULT_DENSITY) q.set('n', String(density))
    if (mode !== 'letters') q.set('mode', mode)
    q.set('theme', theme)
    if (tint !== 'ivory') q.set('ink', tint)
    if (charset !== 'letters') q.set('glyphs', charset)
    try { history.replaceState(null, '', `${location.pathname}?${q}`) } catch { /* sandboxed: sharing via URL just won't work */ }
  }, [source, seed, density, mode, theme, tint, charset])

  const openFiles = useCallback(async (files: File[]) => {
    if (!files.length) return
    setBusy(true); setError(''); setStatus(`reading ${files[0].name}…`)
    try {
      // the parsers load on first use; most visits never open a file
      const { loadFiles } = await import('./objects/load')
      const l = await loadFiles(files)
      setSource({ kind: 'file', ...l }); setSeed(0); setTint('source'); setStatus('') // falls back to ivory if it has no colours
    } catch (err) {
      setError((err as Error).message || 'Could not read that file.'); setBusy(false); setStatus('')
    }
  }, [])

  // drop a model anywhere on the page
  useEffect(() => {
    let depth = 0
    const has = (e: DragEvent) => e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent) => { if (has(e)) { e.preventDefault(); depth++; setDragging(true) } }
    const over = (e: DragEvent) => { if (has(e)) e.preventDefault() }
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false) }
    const drop = (e: DragEvent) => { e.preventDefault(); depth = 0; setDragging(false); openFiles([...(e.dataTransfer?.files ?? [])]) }
    window.addEventListener('dragenter', enter); window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave); window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop)
    }
  }, [openFiles])

  const pickLibrary = useCallback((id: string) => { setSource({ kind: 'library', id }); setSeed(0) }, [])
  const reroll = useCallback(() => setSeed((s) => s + 1), [])
  const [exported, setExported] = useState<ExportItem | null>(null)
  const copy = useCallback(() => {
    const text = stageApi.snapshot(96)
    if (text) setExported({ kind: 'text', text })
  }, [])
  const png = useCallback(() => setExported({ kind: 'png', url: stageApi.png() }), [])

  // keys: arrows step through the library, space scatters, r rerolls, g changes mode, t theme
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (exported || e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return
      const at = source.kind === 'library' ? LIBRARY.findIndex((l) => l.id === source.id) : -1
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') pickLibrary(LIBRARY[at < 0 ? 0 : (at + (e.key === 'ArrowRight' ? 1 : LIBRARY.length - 1)) % LIBRARY.length].id)
      else if (e.key === ' ') { e.preventDefault(); stageApi.burst() }
      else if (e.key === 'r') reroll()
      else if (e.key === 'g') setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length])
      else if (e.key === 't') setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [source, pickLibrary, reroll, exported])

  const active = (id: string) => source.kind === 'library' && source.id === id
  // 'source' only means something for objects that bring their own colours
  const ink: TintId = tint === 'source' && !shape?.col ? 'ivory' : tint

  return (
    <>
      <Canvas className="stage" dpr={[1, 2]} flat camera={{ position: [0, 0, 7], fov: 40, near: 0.5, far: 60 }} gl={{ antialias: false, preserveDrawingBuffer: true }}>
        {atlas && <Stage shape={shape} mode={mode} theme={theme} tint={ink} atlas={atlas} spin={spin} />}
        {atlas && <Post mode={mode} theme={theme} atlas={atlas} />}
      </Canvas>

      <header className="top">
        <span className="brand">gen-ascii</span>
        <nav className="tabs" aria-label="Object">
          {LIBRARY.map((l) => (
            <button key={l.id} type="button" className={active(l.id) ? 'on' : ''} onClick={() => pickLibrary(l.id)}>{l.name}</button>
          ))}
          <button type="button" className={source.kind === 'text' ? 'on' : ''} onClick={() => setSource({ kind: 'text', text: text.trim() || 'ascii' })}>text</button>
          <button type="button" className={source.kind === 'file' ? 'on' : ''} onClick={() => fileInput.current?.click()}>{source.kind === 'file' ? 'model' : 'open…'}</button>
          <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { openFiles([...(e.target.files ?? [])]); e.target.value = '' }} />
        </nav>
        <div className="toggles">
          <button type="button" onClick={() => setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length])} title="render mode (g)">{mode}</button>
          <button type="button" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} title="theme (t)">{theme}</button>
          <button type="button" className={tune ? 'tune on' : 'tune'} aria-expanded={tune} onClick={() => setTune((v) => !v)}>tune</button>
        </div>
        {source.kind === 'text' && (
          <input className="field type" value={text} onChange={(e) => setText(e.target.value)} maxLength={40} placeholder="type a word" spellCheck={false} autoFocus aria-label="Text to render" />
        )}
      </header>

      <Hud shape={shape} status={busy ? status || 'sampling surface…' : status || HINT} error={error} />

      <Panel
        open={tune} theme={theme}
        charset={charset} setCharset={setCharset} custom={custom} setCustom={setCustom}
        tint={ink} setTint={setTint} hasColor={!!shape?.col}
        density={draftDensity} setDensity={setDraftDensity}
        spin={spin} setSpin={setSpin}
        onBurst={() => stageApi.burst()} onReroll={reroll} onText={copy} onPng={png}
      />

      {exported && <Export item={exported} onClose={() => setExported(null)} />}
      {dragging && <div className="drop"><span>drop a model<br /><small>glb · gltf · obj · stl · ply · fbx</small></span></div>}
    </>
  )
}
