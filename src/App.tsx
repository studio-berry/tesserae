import { Canvas } from '@react-three/fiber'
import { Component, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Mode, THEMES, Theme, TintId } from './engine/core'
import { buildAtlas, CHARSETS, CharsetId, charsFor, gridRamp } from './engine/glyphs'
import { stageApi } from './engine/info'
import { Post } from './engine/Post'
import { Stage } from './engine/Stage'
import { applyTokens } from './engine/tokens'
import { defaultDensity, MODES, readUrl, writeUrl } from './engine/url'
import { prepare, Shape, Source } from './objects'
import { LIBRARY } from './objects/library'
import { ACCEPT } from './objects/formats'
import { checkTyped, maskName } from './safety'
import { Export, ExportItem, creditText, exportText } from './ui/Export'
import { Coach, Frame } from './ui/Frame'
import { Hud } from './ui/Hud'
import { Panel } from './ui/Panel'

const HINT = 'drag to turn · tap to ripple · drop a model anywhere'
const systemDark = () => matchMedia('(prefers-color-scheme: dark)').matches
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const FADE = 150

// A renderer that fails must not take the page with it: the canvas is one element of the app, and
// the caption, the controls and the exports all still work without it.
class CanvasGuard extends Component<{ children: ReactNode; onError: (message: string) => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(err: Error) { this.props.onError(err.message || 'The scene stopped.') }
  render() { return this.state.failed ? null : this.props.children }
}

export default function App() {
  const init = useMemo(() => readUrl(location.search, defaultDensity(innerWidth, innerHeight), systemDark() ? 'dark' : 'light'), [])
  const [source, setSource] = useState<Source>(init.source)
  const [text, setText] = useState(init.text)
  const [prompt, setPrompt] = useState(init.prompt)
  const [seed, setSeed] = useState(init.seed)
  const [density, setDensity] = useState(init.density)
  const [draftDensity, setDraftDensity] = useState(init.density)
  const [mode, setMode] = useState<Mode>(init.mode)
  const [shown, setShown] = useState<Mode>(init.mode)
  const [theme, setTheme] = useState<Theme>(init.theme)
  const [tint, setTint] = useState<TintId>(init.tint)
  const [charset, setCharset] = useState<CharsetId>(init.charset)
  const [custom, setCustom] = useState('')
  const [spin, setSpin] = useState(() => !reduced())
  const [surprise, setSurprise] = useState(false)
  const [edges, setEdges] = useState(true)
  const [shape, setShape] = useState<Shape | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [fontsReady, setFontsReady] = useState(false)
  const [tune, setTune] = useState(false)
  const [gen, setGen] = useState(0) // bumped when the graphics context comes back, to rebuild everything
  const [exported, setExported] = useState<ExportItem | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const touched = useRef(false) // the density slider has been moved by hand

  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => { applyTokens(theme) }, [theme])
  // the glyph atlas is drawn in Plex Mono; wait so it rasterises the right shapes
  useEffect(() => { document.fonts.load('500 54px "IBM Plex Mono"').finally(() => setFontsReady(true)) }, [])

  const ramps = useMemo(() => {
    const c = charsFor(charset, custom)
    return { full: c.chars, grid: gridRamp(c.chars), jitter: c.jitter }
  }, [charset, custom])
  // grid mode drops vowel letters from its ramp: rows of adjacent glyphs cannot be scanned, so the
  // letters that would let a word form are simply not there
  const ramp = mode === 'grid' ? ramps.grid : ramps.full

  const atlas = useMemo(() => {
    if (!fontsReady) return null
    return buildAtlas(ramp, ramps.jitter)
  }, [fontsReady, ramp, ramps.jitter, gen])
  useEffect(() => () => atlas?.tex.dispose(), [atlas])

  // the slider moves freely; the object resamples once it rests
  useEffect(() => { const t = setTimeout(() => setDensity(draftDensity), 250); return () => clearTimeout(t) }, [draftDensity])

  // a rotation of the device or a resize changes how many glyphs suit the screen, but never overrides
  // a density the user set by hand
  useEffect(() => {
    const resize = () => { if (!touched.current) { const d = defaultDensity(innerWidth, innerHeight); setDraftDensity(d); setDensity(d) } }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  // typing rebuilds the type a moment after the last key, and refuses a word that is on the list
  useEffect(() => {
    if (source.kind !== 'text') return
    const clean = text.trim().slice(0, 40)
    if (!clean || clean === source.text) return
    const t = setTimeout(() => submitText(clean), 400)
    return () => clearTimeout(t)
  }, [text, source]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (source.kind !== 'prompt') return
    const clean = prompt.trim().slice(0, 60)
    if (!clean || clean === source.text) return
    const t = setTimeout(() => submitPrompt(clean), 500)
    return () => clearTimeout(t)
  }, [prompt, source]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true
    setBusy(true)
    // yield a frame first so the UI shows the change before sampling blocks the thread
    const t = setTimeout(() => {
      prepare(source, density, seed)
        .then((s) => { if (live) { setShape(s); setError(''); setBusy(false) } })
        .catch((err: Error) => { if (live) { setError(err.message || 'Could not build that object.'); setBusy(false) } })
    }, 16)
    return () => { live = false; clearTimeout(t) }
  }, [source, density, seed])

  useEffect(() => {
    const next = writeUrl({ source, text, prompt, seed, density, mode, theme, tint, charset }, defaultDensity(innerWidth, innerHeight))
    try { history.replaceState(null, '', `${location.pathname}${next}`) } catch { /* sandboxed: sharing via URL just won't work */ }
  }, [source, text, prompt, seed, density, mode, theme, tint, charset])

  // the canvas dims for one transition, the mode swaps while it is down, and it comes back up: that
  // reads as a crossfade without rendering both modes at once
  useEffect(() => {
    if (mode === shown) return
    const t = setTimeout(() => setShown(mode), FADE)
    return () => clearTimeout(t)
  }, [mode, shown])

  const submitText = useCallback((raw: string) => {
    const clean = raw.trim().slice(0, 40)
    if (!clean) return
    const verdict = checkTyped(clean)
    if (!verdict.ok) { setError(verdict.reason); return } // the previous object stays on screen
    setError(''); setSource({ kind: 'text', text: clean })
  }, [])

  const submitPrompt = useCallback((raw: string) => {
    const clean = raw.trim().slice(0, 60)
    if (!clean) return
    const verdict = checkTyped(clean)
    if (!verdict.ok) { setError(verdict.reason); return }
    setError(''); setSource({ kind: 'prompt', text: clean }); setSeed(0)
  }, [])

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
  const reroll = useCallback(() => {
    setSeed((s) => s + 1)
    // surprise also changes the glyph set, the way a slot machine changes everything at once
    if (surprise) setCharset(Object.keys(CHARSETS)[Math.floor(Math.random() * Object.keys(CHARSETS).length)] as CharsetId)
  }, [surprise])

  const caption = `${shape?.title ?? 'gen-ascii'} · ${mode} · ${(density / 1000).toFixed(1)}k · ${charset}`
  // a searched model or drawing carries its credit, and the licence asks for it in the export
  const credit = shape?.source ?? null
  const copy = useCallback(() => {
    const body = stageApi.snapshot(96)
    if (!body) return
    // every line is scanned for accidental words before it can be copied out of the app, and the
    // header carries a title that came from a third party, so it is scanned too
    setExported({ kind: 'text', text: exportText(body, caption, credit, ramps.full) })
  }, [caption, credit, ramps.full])
  const png = useCallback(() => {
    const url = stageApi.png()
    if (!url) return
    const img = new Image()
    img.onload = () => {
      const creditLine = creditText(credit, ramps.full)
      const pad = Math.round(Math.max(22, img.height * 0.045))
      // the strip grows to hold the credit, so the licence travels with the image
      const strip = creditLine ? pad * 2 : pad
      const cv = document.createElement('canvas')
      cv.width = img.width; cv.height = img.height + strip
      const g = cv.getContext('2d')!
      g.drawImage(img, 0, 0)
      g.fillStyle = THEMES[theme].bg; g.fillRect(0, img.height, cv.width, strip)
      g.fillStyle = THEMES[theme].dust
      g.font = `500 ${Math.round(pad * 0.4)}px "IBM Plex Mono", ui-monospace, monospace`
      g.textBaseline = 'middle'
      g.fillText(caption, Math.round(pad * 0.35), img.height + pad / 2)
      if (creditLine) g.fillText(creditLine, Math.round(pad * 0.35), img.height + pad * 1.5)
      setExported({ kind: 'png', url: cv.toDataURL('image/png') })
    }
    img.src = url
  }, [caption, credit, ramps.full, theme])

  // keys: arrows step through the library, wasd and shift+arrows turn it, space scatters,
  // r rerolls, g changes mode, t theme
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (exported || e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return
      const at = source.kind === 'library' ? LIBRARY.findIndex((l) => l.id === source.id) : -1
      const step = (d: number) => pickLibrary(LIBRARY[at < 0 ? 0 : (at + d + LIBRARY.length) % LIBRARY.length].id)
      if (e.shiftKey) {
        if (e.key === 'ArrowRight') { e.preventDefault(); stageApi.rotate(0.22, 0) }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); stageApi.rotate(-0.22, 0) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); stageApi.rotate(0, -0.22) }
        else if (e.key === 'ArrowDown') { e.preventDefault(); stageApi.rotate(0, 0.22) }
        return
      }
      if (e.key === 'ArrowRight') step(1)
      else if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === ' ') { e.preventDefault(); stageApi.burst() }
      else if (e.key === 'r') reroll()
      else if (e.key === 'g') setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length])
      else if (e.key === 't') setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
      else if (e.key === 'w' || e.key === 'a' || e.key === 's' || e.key === 'd') {
        const k = e.key
        stageApi.rotate(k === 'a' ? -0.22 : k === 'd' ? 0.22 : 0, k === 'w' ? -0.22 : k === 's' ? 0.22 : 0)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [source, pickLibrary, reroll, exported])

  // a lost context used to leave a black canvas, and rendering into it throws; the loop is paused
  // until the browser hands the context back, then the atlas and the geometry are rebuilt
  const canvasEl = useRef<HTMLCanvasElement | null>(null)
  const [paused, setPaused] = useState(false)
  const onCreated = useCallback(({ gl, setFrameloop: stop }: { gl: THREE.WebGLRenderer; setFrameloop: (f: 'always' | 'demand' | 'never') => void }) => {
    const el = gl.domElement
    canvasEl.current = el
    // the canvas is the picture; nothing else on the page says what it is, so the label goes here
    el.setAttribute('role', 'img')
    // the loop stops here rather than in an effect, because one more frame into a lost context throws
    const lost = (ev: Event) => {
      ev.preventDefault()
      stop('never')
      setPaused(true); setBusy(true); setStatus('the graphics context was lost, rebuilding…')
    }
    const back = () => { setPaused(false); setStatus(''); setBusy(false); setGen((g) => g + 1) }
    el.addEventListener('webglcontextlost', lost)
    el.addEventListener('webglcontextrestored', back)
  }, [])

  const active = (id: string) => source.kind === 'library' && source.id === id
  // 'source' only means something for objects that bring their own colours
  const ink: TintId = tint === 'source' && !shape?.col ? 'ivory' : tint
  const title = shape ? shape.title : 'gen-ascii'

  useEffect(() => { canvasEl.current?.setAttribute('aria-label', `${title}, drawn in ascii`) }, [title, gen])

  return (
    <>
      <CanvasGuard onError={setError}>
        <Canvas
          className={mode === shown ? 'stage' : 'stage fade'} dpr={[1, 2]} flat
          camera={{ position: [0, 0, 7], fov: 40, near: 0.5, far: 60 }}
          gl={{ antialias: false, preserveDrawingBuffer: true }} onCreated={onCreated}
        >
          {atlas && <Stage key={gen} shape={shape} mode={shown} theme={theme} tint={ink} atlas={atlas} spin={spin} orient={edges} paused={paused} />}
          {atlas && <Post mode={shown} theme={theme} atlas={atlas} orient={edges} />}
        </Canvas>
      </CanvasGuard>

      <Frame />

      <header className="top">
        <span className="brand">gen-ascii</span>
        <nav className="tabs" aria-label="Object">
          {LIBRARY.map((l) => (
            <button key={l.id} type="button" className={active(l.id) ? 'on' : ''} onClick={() => pickLibrary(l.id)}>{l.name}</button>
          ))}
          <button type="button" className={source.kind === 'text' ? 'on' : ''} onClick={() => setSource({ kind: 'text', text: text.trim() || 'ascii' })}>text</button>
          <button type="button" className={source.kind === 'prompt' ? 'on' : ''} onClick={() => setSource({ kind: 'prompt', text: prompt.trim() || 'a lighthouse' })}>prompt</button>
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
        {source.kind === 'prompt' && (
          <input className="field type" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={60} placeholder="a lighthouse, or an idea" spellCheck={false} autoFocus aria-label="What to draw" />
        )}
      </header>

      <Hud
        shape={shape} theme={theme} ramp={ramp} onRetry={() => prepare(source, density, seed).then(setShape).catch((err: Error) => setError(err.message))}
        status={busy ? status || (source.kind === 'prompt' ? 'working out what that looks like…' : 'sampling surface…') : status || HINT}
        error={source.kind === 'file' ? maskName(error) : error}
      />

      <Panel
        open={tune} theme={theme}
        charset={charset} setCharset={setCharset} custom={custom} setCustom={setCustom}
        tint={ink} setTint={setTint} hasColor={!!shape?.col}
        density={draftDensity} setDensity={(n) => { touched.current = true; setDraftDensity(n) }}
        spin={spin} setSpin={setSpin}
        surprise={surprise} setSurprise={setSurprise} edges={edges} setEdges={setEdges}
        onBurst={() => stageApi.burst()} onReroll={reroll} onText={copy} onPng={png}
      />

      <Coach />
      {exported && <Export item={exported} onClose={() => setExported(null)} caption={caption} credit={creditText(credit, ramps.full) || undefined} />}
      {dragging && <div className="drop"><span>drop a model<br /><small>glb · gltf · obj · stl · ply · fbx</small></span></div>}
    </>
  )
}
