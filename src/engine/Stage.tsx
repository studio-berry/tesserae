import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Shape } from '../objects'
import { DUST, Mode, N, R, THEMES, TINTS, Theme, TintId, clamp01, linear, smooth } from './core'
import { Atlas } from './glyphs'
import { infoStore, stageApi } from './info'
import { occluderFrag, occluderVert, pointFrag, pointVert } from './shaders'

type Props = { shape: Shape | null; mode: Mode; theme: Theme; tint: TintId; atlas: Atlas; spin: boolean }

// Where every dot is headed. Dots past shape.count are dust.
type Target = {
  shape: Shape | null
  pos: Float32Array; nrm: Float32Array; col: Float32Array
  size: Float32Array; alpha: Float32Array; order: Float32Array
  on: Uint8Array // 1 = part of the object
}

const LIGHT = new THREE.Vector3(-0.5, 0.6, 0.62).normalize() // view space, from the upper left and a little in front
const SIZE_MUL = { letters: 1, dots: 0.9, grid: 1.9 }
const rnd = Math.random

function makeTarget(shape: Shape | null, dir: THREE.Vector3): Target {
  const t: Target = {
    shape, pos: DUST.slice(), nrm: new Float32Array(N * 3), col: new Float32Array(N * 3),
    size: new Float32Array(N), alpha: new Float32Array(N), order: new Float32Array(N), on: new Uint8Array(N),
  }
  for (let i = 0; i < N; i++) { t.size[i] = 0.035 + rnd() * 0.04; t.alpha[i] = 0.04 + rnd() * 0.1; t.order[i] = rnd() }
  if (!shape) return t
  // glyphs sized to the spacing between samples, so they tile the surface
  const glyph = Math.max(0.03, Math.min(0.16, shape.spacing * 1.15))
  for (let i = 0; i < shape.count; i++) {
    const i3 = i * 3
    t.pos.set(shape.pos.subarray(i3, i3 + 3), i3)
    t.nrm.set(shape.nrm.subarray(i3, i3 + 3), i3)
    t.size[i] = glyph; t.on[i] = 1
    // release in a sweep across the object, so it assembles like a scan
    const d = (shape.pos[i3] * dir.x + shape.pos[i3 + 1] * dir.y + shape.pos[i3 + 2] * dir.z) / R
    t.order[i] = clamp01((d + 1) / 2 * 0.9 + rnd() * 0.1)
  }
  return t
}

// Colours and base brightness, which depend on theme and tint but not on where dots are
function paint(t: Target, theme: Theme, tint: TintId) {
  const dust = linear(THEMES[theme].dust), ink = linear(TINTS.find((x) => x.id === tint)?.[theme] ?? TINTS[0][theme])
  const src = tint === 'source' ? t.shape?.col : null, light = theme === 'light'
  for (let i = 0; i < N; i++) {
    const i3 = i * 3
    if (!t.on[i]) { t.col[i3] = dust.r; t.col[i3 + 1] = dust.g; t.col[i3 + 2] = dust.b; continue }
    t.alpha[i] = 0.95
    if (!src) { t.col[i3] = ink.r; t.col[i3 + 1] = ink.g; t.col[i3 + 2] = ink.b; continue }
    let r = src[i3], g = src[i3 + 1], b = src[i3 + 2]
    const hi = Math.max(r, g, b, 1e-4), lo = Math.min(r, g, b), sat = (hi - lo) / hi, lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    if (light) {
      // on paper, keep the hue but take it dark; greys fall back to ink
      const k = clamp01(sat * 1.6)
      r = ink.r + (r / hi * 0.22 - ink.r) * k; g = ink.g + (g / hi * 0.22 - ink.g) * k; b = ink.b + (b / hi * 0.22 - ink.b) * k
      t.alpha[i] = 0.95 * (0.6 + 0.4 * Math.sqrt(1 - Math.min(1, lum)))
    } else {
      // near-black has no reliable hue; let it read as grey, and let darker areas take lighter glyphs
      const k = smooth(hi / 0.08)
      r = 0.55 + (r - 0.55) * k; g = 0.55 + (g - 0.55) * k; b = 0.55 + (b - 0.55) * k
      t.alpha[i] = 0.95 * (0.45 + 0.55 * Math.sqrt(Math.min(1, lum)))
    }
    t.col[i3] = r; t.col[i3 + 1] = g; t.col[i3 + 2] = b
  }
}

const randomDir = () => new THREE.Vector3(rnd() - 0.5, rnd() * 1.2 - 0.3, rnd() - 0.5).normalize()

export function Stage({ shape, mode, theme, tint, atlas, spin }: Props) {
  const { size, viewport, camera, gl, scene } = useThree()
  const group = useRef<THREE.Group>(null!)
  const occ = useRef<THREE.Mesh>(null!)

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const dyn = (n: number) => new THREE.BufferAttribute(new Float32Array(N * n), n).setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('position', dyn(3)); g.setAttribute('aNormal', dyn(3)); g.setAttribute('aColor', dyn(3))
    g.setAttribute('aSize', dyn(1)); g.setAttribute('aAlpha', dyn(1))
    g.setAttribute('aSeed', new THREE.BufferAttribute(Float32Array.from({ length: N }, () => rnd()), 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40)
    return g
  }, [])

  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: pointVert, fragmentShader: pointFrag, transparent: true, depthWrite: false,
    uniforms: {
      uScale: { value: 1 }, uLightDir: { value: LIGHT }, uShade: { value: 1 }, uBackFade: { value: 1 }, uTwoSided: { value: 0 },
      uSizeMul: { value: 1 }, uLight: { value: 0 }, uMode: { value: 0 }, uTime: { value: 0 },
      uCount: { value: 1 }, uJitter: { value: 0 }, uAtlas: { value: null }, uGlint: { value: new THREE.Color() },
    },
  }), [])

  const occMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: occluderVert, fragmentShader: occluderFrag, colorWrite: false, side: THREE.DoubleSide,
    uniforms: { uPush: { value: 0.025 } },
  }), [])

  useEffect(() => {
    mat.uniforms.uAtlas.value = atlas.tex
    mat.uniforms.uCount.value = atlas.count
    mat.uniforms.uJitter.value = atlas.jitter
  }, [atlas, mat])

  useEffect(() => {
    const light = theme === 'light'
    mat.uniforms.uLight.value = light ? 1 : 0
    mat.uniforms.uMode.value = mode === 'letters' ? 0 : mode === 'dots' ? 1 : 2
    mat.uniforms.uSizeMul.value = SIZE_MUL[mode]
    mat.uniforms.uGlint.value.set(THEMES[theme].lit)
    // the grid effect reads an opaque splat image; the other modes blend glyphs or dots
    mat.transparent = mode !== 'grid'
    mat.depthWrite = mode === 'grid'
    mat.blending = mode === 'grid' ? THREE.NoBlending : mode === 'dots' && !light ? THREE.AdditiveBlending : THREE.NormalBlending
    mat.needsUpdate = true
    scene.background = mode === 'grid' ? null : new THREE.Color(THEMES[theme].bg)
  }, [mode, theme, mat, scene])

  const litColor = useMemo(() => linear(THEMES[theme].lit), [theme])

  // engine state lives in a ref so React never re-renders per frame
  const E = useRef({
    P: Float32Array.from(DUST), V: new Float32Array(N * 3), Nn: new Float32Array(N * 3),
    col: new Float32Array(N * 3), sz: new Float32Array(N), al: new Float32Array(N),
    cur: null as Target | null, prev: null as Target | null, rel: new Float32Array(N),
    seed: Float32Array.from({ length: N * 2 }, () => rnd() * 6.283),
    time: 0, phase: 'idle' as 'assemble' | 'idle' | 'burst', start: 0, len: 0, lastInfo: 0,
    scanNext: 7, scanStart: -99, scanDir: new THREE.Vector3(0, 1, 0),
    ripples: [] as { c: [number, number, number]; t: number }[],
    rx: 0.32, ry: -0.6, vx: 0, vy: 0, zoom: 1, fit: 0.8, drag: false, lastTouch: -99, occ: 0,
  })

  const enter = (next: Shape | null, burst = false) => {
    const e = E.current, now = e.time
    // freeze each dot's effective target, so dots still waiting on the last change keep moving smoothly
    if (e.cur) {
      const c = e.cur, p = e.prev ?? c
      const frozen: Target = { ...c, pos: c.pos.slice(), nrm: c.nrm.slice(), col: c.col.slice(), size: c.size.slice(), alpha: c.alpha.slice(), on: c.on.slice() }
      for (let i = 0; i < N; i++) if (now < e.rel[i]) {
        const i3 = i * 3
        frozen.pos.set(p.pos.subarray(i3, i3 + 3), i3); frozen.nrm.set(p.nrm.subarray(i3, i3 + 3), i3); frozen.col.set(p.col.subarray(i3, i3 + 3), i3)
        frozen.size[i] = p.size[i]; frozen.alpha[i] = p.alpha[i]; frozen.on[i] = p.on[i]
      }
      e.prev = frozen
    }
    e.cur = makeTarget(next, randomDir())
    paint(e.cur, theme, tint)
    if (!e.prev) e.prev = e.cur
    const stagger = burst ? 0.5 : e.phase === 'idle' && e.time > 0.5 ? 1.1 : 1.7
    for (let i = 0; i < N; i++) e.rel[i] = now + e.cur.order[i] * stagger
    e.phase = burst ? 'burst' : 'assemble'; e.start = now; e.len = stagger + (burst ? 2.2 : 1.2)
    e.occ = 0
    if (occ.current) occ.current.geometry = next?.occluder ?? new THREE.BufferGeometry()
  }

  useEffect(() => { enter(shape) }, [shape]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const e = E.current
    if (e.cur) paint(e.cur, theme, tint)
    if (e.prev && e.prev !== e.cur) paint(e.prev, theme, tint)
  }, [theme, tint])

  // shared by tap-to-ripple and the text snapshot: the current model-view transform
  const views = () => {
    const g = group.current
    g.updateMatrixWorld(); camera.updateMatrixWorld()
    const mv = new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse, g.matrixWorld)
    return { mv, nm: new THREE.Matrix3().getNormalMatrix(mv) }
  }

  // ---------------------------------------------------------------- pointer: drag to turn, pinch or wheel to zoom, tap to ripple
  useEffect(() => {
    const el = gl.domElement, pts = new Map<number, { x: number; y: number }>()
    let down = { x: 0, y: 0, t: 0, moved: 0 }, pinch = 0, lastMove = 0
    const e = E.current
    const onDown = (ev: PointerEvent) => {
      el.setPointerCapture(ev.pointerId)
      pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
      if (pts.size === 1) { down = { x: ev.clientX, y: ev.clientY, t: performance.now(), moved: 0 }; e.drag = true; e.vx = e.vy = 0 }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y) }
      e.lastTouch = e.time
    }
    const onMove = (ev: PointerEvent) => {
      const p = pts.get(ev.pointerId)
      if (!p) return
      const dx = ev.clientX - p.x, dy = ev.clientY - p.y, now = performance.now(), dt = Math.max(1, now - lastMove) / 1000
      p.x = ev.clientX; p.y = ev.clientY; lastMove = now
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinch > 0) e.zoom = Math.max(0.5, Math.min(2.6, e.zoom * (d / pinch)))
        pinch = d; down.moved = 99
      } else {
        const k = 0.0065
        e.ry += dx * k; e.rx += dy * k
        e.vy = (dx * k) / dt; e.vx = (dy * k) / dt
        down.moved += Math.abs(dx) + Math.abs(dy)
      }
      e.lastTouch = e.time
    }
    const onUp = (ev: PointerEvent) => {
      pts.delete(ev.pointerId)
      if (pts.size < 2) pinch = 0
      if (pts.size === 0) {
        e.drag = false
        if (performance.now() - lastMove > 80) e.vx = e.vy = 0 // held still before letting go: no fling
        if (down.moved < 8 && performance.now() - down.t < 400) tap(ev.clientX, ev.clientY)
      }
    }
    const onWheel = (ev: WheelEvent) => { ev.preventDefault(); e.zoom = Math.max(0.5, Math.min(2.6, e.zoom * Math.exp(-ev.deltaY * 0.0012))) }
    // a ripple starts at the front-most glyph under the finger
    const tap = (cx: number, cy: number) => {
      const t = e.cur
      if (!t?.shape) return
      const rect = el.getBoundingClientRect(), x = cx - rect.left, y = cy - rect.top
      const { mv } = views(), pos = geo.attributes.position.array as Float32Array, v = new THREE.Vector3()
      let best = -1, bestZ = Infinity
      for (let i = 0; i < t.shape.count; i++) {
        v.fromArray(pos, i * 3).applyMatrix4(mv)
        const z = -v.z
        v.applyMatrix4(camera.projectionMatrix)
        const sx = (v.x * 0.5 + 0.5) * rect.width, sy = (0.5 - v.y * 0.5) * rect.height
        if ((sx - x) ** 2 + (sy - y) ** 2 < 28 * 28 && z < bestZ) { bestZ = z; best = i }
      }
      if (best < 0) return
      e.ripples.push({ c: [t.pos[best * 3], t.pos[best * 3 + 1], t.pos[best * 3 + 2]], t: e.time })
      if (e.ripples.length > 4) e.ripples.shift()
    }
    el.addEventListener('pointerdown', onDown); el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('wheel', onWheel)
    }
  }, [gl, camera, geo]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- imperative hooks for the UI
  useEffect(() => {
    stageApi.burst = () => { const e = E.current; if (e.cur?.shape) enter(e.cur.shape, true) }
    stageApi.png = () => gl.domElement.toDataURL('image/png')
    stageApi.snapshot = (cols = 96) => snapshot(cols)
  })

  // Renders the current view as plain text: project the visible dots, crop to the object, splat
  // them into a fine depth buffer, then give each character cell the glyph its average ink calls for
  const snapshot = (cols: number) => {
    const e = E.current, t = e.cur
    if (!t?.shape) return ''
    const { mv, nm } = views()
    const W = size.width, H = size.height
    const pos = geo.attributes.position.array as Float32Array, v = new THREE.Vector3(), n = new THREE.Vector3(), h = new THREE.Vector3(), view = new THREE.Vector3()
    const persp = camera as THREE.PerspectiveCamera, focal = H / (2 * Math.tan((persp.fov * Math.PI) / 360))
    const twoSided = t.shape.twoSided
    const dots: { x: number; y: number; z: number; ink: number; r: number }[] = []
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i < N; i++) {
      if (!t.on[i]) continue
      v.fromArray(pos, i * 3).applyMatrix4(mv)
      const z = -v.z
      if (z <= 0.1) continue
      n.fromArray(e.Nn, i * 3).applyMatrix3(nm).normalize()
      view.copy(v).negate().normalize()
      let facing = n.dot(view)
      if (twoSided && facing < 0) { n.negate(); facing = -facing }
      if (!twoSided && facing < -0.05) continue
      const lam = Math.max(0, n.dot(LIGHT)), spec = Math.max(0, n.dot(h.copy(LIGHT).add(view).normalize())) ** 24
      const graze = 0.5 + 0.5 * smooth(facing / 0.45)
      const ink = clamp01(e.al[i] * (0.16 + 0.84 * lam + 0.55 * spec + 0.06 * (1 - clamp01(facing)) ** 3) * graze * 0.72)
      v.applyMatrix4(camera.projectionMatrix)
      const x = (v.x * 0.5 + 0.5) * W, y = (0.5 - v.y * 0.5) * H, r = (e.sz[i] * SIZE_MUL.grid * focal) / z / 2
      dots.push({ x, y, z, ink, r })
      x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); y0 = Math.min(y0, y - r); y1 = Math.max(y1, y + r)
    }
    if (!dots.length) return ''
    // character cells are twice as tall as wide; the columns span the object, not the screen
    const cw = (x1 - x0) / cols, ch = cw * 2, rows = Math.max(1, Math.ceil((y1 - y0) / ch))
    const SX = 3, SY = 6, gw = cols * SX, gh = rows * SY, sub = cw / SX
    const zb = new Float32Array(gw * gh).fill(Infinity), ib = new Float32Array(gw * gh)
    for (const d of dots) {
      const sx = (d.x - x0) / sub, sy = (d.y - y0) / sub, rad = Math.max(0.6, d.r / sub)
      for (let gy = Math.max(0, Math.floor(sy - rad)); gy <= Math.min(gh - 1, Math.ceil(sy + rad)); gy++)
        for (let gx = Math.max(0, Math.floor(sx - rad)); gx <= Math.min(gw - 1, Math.ceil(sx + rad)); gx++) {
          if ((gx + 0.5 - sx) ** 2 + (gy + 0.5 - sy) ** 2 > rad * rad) continue
          const k = gy * gw + gx
          if (d.z < zb[k]) { zb[k] = d.z; ib[k] = d.ink }
        }
    }
    const ramp = atlas.ranked, lines: string[] = []
    for (let r = 0; r < rows; r++) {
      let line = ''
      for (let c = 0; c < cols; c++) {
        let sum = 0
        for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) sum += ib[(r * SY + y) * gw + c * SX + x]
        const ink = sum / (SX * SY)
        line += ink < 0.05 ? ' ' : ramp[Math.min(ramp.length - 1, Math.floor(ink ** 0.8 * ramp.length))]
      }
      lines.push(line.replace(/\s+$/, ''))
    }
    while (lines.length && !lines[0]) lines.shift()
    while (lines.length && !lines[lines.length - 1]) lines.pop()
    const indent = Math.min(...lines.filter(Boolean).map((l) => l.match(/^ */)![0].length))
    return lines.map((l) => l.slice(indent)).join('\n')
  }

  // ---------------------------------------------------------------- the frame loop
  useFrame((_, rawDt) => {
    const e = E.current, dt = Math.min(rawDt, 1 / 20)
    e.time += dt
    const now = e.time, cur = e.cur
    if (!cur) return
    const prev = e.prev ?? cur, shp = cur.shape
    const tPh = now - e.start
    if (e.phase !== 'idle' && tPh > e.len) e.phase = 'idle'
    // every so often a bright band sweeps across the object, the way ivory's crest crosses its scenes
    if (e.phase === 'idle' && now > e.scanNext && shp) { e.scanStart = now; e.scanDir = randomDir(); e.scanNext = now + 9 + rnd() * 7 }
    const scan = (now - e.scanStart) / 2.6
    e.ripples = e.ripples.filter((r) => now - r.t < 3.5)

    const pos = geo.attributes.position.array as Float32Array
    const nrmA = geo.attributes.aNormal.array as Float32Array
    const colA = geo.attributes.aColor.array as Float32Array
    const szA = geo.attributes.aSize.array as Float32Array
    const alA = geo.attributes.aAlpha.array as Float32Array
    const lit = litColor
    const K = 11, DAMP = 6.2 // soft spring: dots visibly travel (~1 s) and settle with a hint of overshoot
    const kc = 1 - Math.exp(-dt * 5), kn = 1 - Math.exp(-dt * 7)
    const { P, V, Nn, seed, rel } = e
    const sd = e.scanDir, burst = e.phase === 'burst'
    for (let i = 0; i < N; i++) {
      const on = now >= rel[i], T = on ? cur : prev, i3 = i * 3, inShape = T.on[i] === 1
      let ox = 0, oy = 0, oz = 0, b = 1, glow = 0
      if (inShape && on) {
        const px = T.pos[i3], py = T.pos[i3 + 1], pz = T.pos[i3 + 2], nx = T.nrm[i3], ny = T.nrm[i3 + 1], nz = T.nrm[i3 + 2]
        if (e.phase === 'assemble') { const age = (now - rel[i]) / 0.9; if (age < 1) { glow = 1 - age; b += glow * 1.2 } }
        if (scan >= 0 && scan <= 1) {
          const d = (px * sd.x + py * sd.y + pz * sd.z) / R, w = 1 - Math.abs(d - (-1.25 + scan * 2.5)) / 0.14
          if (w > 0) { glow = Math.max(glow, w); b += w * 1.3 }
        }
        for (const r of e.ripples) {
          const age = now - r.t, dist = Math.hypot(px - r.c[0], py - r.c[1], pz - r.c[2])
          const k = Math.exp(-(((dist - age * 1.6) / 0.16) ** 2)) * Math.exp(-age * 1.1)
          if (k > 0.01) { const a = k * 0.17; ox += nx * a; oy += ny * a; oz += nz * a; b += k * 1.6; glow = Math.max(glow, k) }
        }
        if (burst) {
          // blow outward along the surface normal and come back together
          const u = clamp01((tPh - T.order[i] * 0.5) / 2.2), amt = (u < 0.22 ? 1 - (1 - u / 0.22) ** 3 : 1 - smooth((u - 0.22) / 0.78)) * (0.35 + seed[i * 2] * 0.25)
          ox += (nx * 0.8 + px * 0.3) * amt; oy += (ny * 0.8 + py * 0.3) * amt; oz += (nz * 0.8 + pz * 0.3) * amt
          glow = Math.max(glow, amt * 0.6)
        }
      }
      for (let a = 0; a < 3; a++) {
        V[i3 + a] += ((T.pos[i3 + a] - P[i3 + a]) * K - V[i3 + a] * DAMP) * dt
        P[i3 + a] += V[i3 + a] * dt
        Nn[i3 + a] += (T.nrm[i3 + a] - Nn[i3 + a]) * kn
      }
      const s1 = seed[i * 2], s2 = seed[i * 2 + 1], jit = inShape ? 0.003 : 0.06
      pos[i3] = P[i3] + ox + Math.sin(now * 0.7 + s1) * jit
      pos[i3 + 1] = P[i3 + 1] + oy + Math.cos(now * 0.6 + s2) * jit
      pos[i3 + 2] = P[i3 + 2] + oz + Math.sin(now * 0.5 + s1 + s2) * jit
      nrmA[i3] = Nn[i3]; nrmA[i3 + 1] = Nn[i3 + 1]; nrmA[i3 + 2] = Nn[i3 + 2]
      const gk = glow * 0.85
      colA[i3] = e.col[i3] += (T.col[i3] + (lit.r - T.col[i3]) * gk - e.col[i3]) * kc
      colA[i3 + 1] = e.col[i3 + 1] += (T.col[i3 + 1] + (lit.g - T.col[i3 + 1]) * gk - e.col[i3 + 1]) * kc
      colA[i3 + 2] = e.col[i3 + 2] += (T.col[i3 + 2] + (lit.b - T.col[i3 + 2]) * gk - e.col[i3 + 2]) * kc
      szA[i] = e.sz[i] += (T.size[i] * (1 + glow * 0.25) - e.sz[i]) * kc
      alA[i] = e.al[i] += (Math.min(1.6, T.alpha[i] * b) - e.al[i]) * kc
    }
    for (const k of ['position', 'aNormal', 'aColor', 'aSize', 'aAlpha']) geo.attributes[k].needsUpdate = true

    // turntable: drag turns it, a fling coasts, and the slow spin picks up again once left alone
    if (!e.drag) {
      const decay = Math.exp(-dt * 2.4)
      e.vx *= decay; e.vy *= decay
      const back = smooth((now - e.lastTouch - 1.2) / 1.8)
      if (shp?.kind === 'text') {
        // type should stay readable: rock gently around facing the viewer instead of turning away
        const ty = (spin ? Math.sin(now * 0.4) * 0.5 : 0) + Math.PI * 2 * Math.round(e.ry / (Math.PI * 2))
        const k = (1 - Math.exp(-dt * 1.4)) * back
        e.ry += e.vy * dt + (ty - e.ry) * k; e.rx += e.vx * dt + (0.12 - e.rx) * k
      } else {
        e.ry += (e.vy + (spin ? 0.22 * back : 0)) * dt; e.rx += e.vx * dt
      }
    }
    e.rx = Math.max(-1.35, Math.min(1.35, e.rx))
    const g = group.current
    g.rotation.set(e.rx, e.ry, 0, 'XYZ')
    // fit the object to the screen: its width as it turns, and its height clear of header and caption
    const vp = viewport.getCurrentViewport(camera, [0, 0, 0])
    const across = shp?.across ?? R, up = shp?.up ?? R
    e.fit += (Math.min(1.3, (vp.width * 0.9) / (2 * across), (vp.height * 0.58) / (2 * up)) - e.fit) * (1 - Math.exp(-dt * 2.5))
    const fit = e.fit
    g.scale.setScalar(e.zoom * fit)
    // on tall phone screens lift the object clear of the caption
    g.position.y = vp.width / vp.height < 0.8 ? vp.height * 0.06 : 0

    // the occluder grows with the object as it assembles, so dots fly in front of it, not through it
    const o = occ.current
    e.occ += ((e.phase === 'idle' || tPh > e.len * 0.6 ? 1 : 0.2) - e.occ) * (1 - Math.exp(-dt * 3))
    o.visible = !!shp?.occluder
    o.scale.setScalar(Math.max(0.01, e.occ))

    const persp = camera as THREE.PerspectiveCamera
    const u = mat.uniforms
    u.uTime.value = now
    u.uScale.value = (size.height * viewport.dpr) / (2 * Math.tan((persp.fov * Math.PI) / 360))
    u.uTwoSided.value = shp?.twoSided ? 1 : 0
    u.uBackFade.value += ((shp?.twoSided ? 0 : 1) - u.uBackFade.value) * (1 - Math.exp(-dt * 3))
    occMat.uniforms.uPush.value = 0.03 * e.zoom * fit

    if (now - e.lastInfo > 0.1) {
      e.lastInfo = now
      infoStore.set({ phase: e.phase === 'assemble' ? 'assembling' : e.phase === 'burst' ? 'scattering' : scan >= 0 && scan <= 1 ? 'scanning' : 'rendering', glyphs: shp?.count ?? 0 })
    }
  })

  return (
    <group ref={group}>
      <mesh ref={occ} material={occMat} renderOrder={-1} frustumCulled={false} />
      <points geometry={geo} material={mat} frustumCulled={false} />
    </group>
  )
}
