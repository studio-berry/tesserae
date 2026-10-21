import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { Shape } from '../objects'
import { DUST, Mode, N, R, THEMES, TINTS, Theme, TintId, clamp01, mulberry32, paletteInk, smooth } from './core'
import { Atlas } from './glyphs'
import { infoStore, stageApi } from './info'
import { occluderFrag, occluderVert, pointFrag, pointVert, shadowFrag, shadowVert } from './shaders'
import { snapshotText } from './snapshot'

type Props = {
  shape: Shape | null
  mode: Mode
  theme: Theme
  palette: TintId
  atlas: Atlas
  spin: boolean
  orient: boolean // direction glyphs along the silhouette
  paused: boolean // the browser took the graphics context away
  onZoom?: (zoom: number) => void // the quantized zoom, reported so the caller can re-sample
}

// Where every dot is headed. Dots past shape.count are dust.
type Target = {
  shape: Shape | null
  pos: Float32Array; nrm: Float32Array; col: Float32Array
  size: Float32Array; alpha: Float32Array; order: Float32Array
}

const LIGHT = new THREE.Vector3(-0.5, 0.6, 0.62).normalize() // view space, from the upper left and a little in front
// dots and grid keep the size they had before the letters cell grew by 1.6/1.15
const SIZE_MUL = { letters: 1, dots: 0.52, grid: 1.1 }
const SHADOW_DOTS = 700
const TILT = 0.32

// The same curve the vertex shader uses, so a dot caught mid-flight keeps moving smoothly when the
// target changes under it. See the SPRING block in shaders.ts.
const springDecay = (t: number) => Math.exp(-3.1 * t) * (Math.cos(1.17914 * t) + 2.62924 * Math.sin(1.17914 * t))

// A stable number per shape, so the same URL builds the same picture
const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

const randomDir = (rnd: () => number) => new THREE.Vector3(rnd() - 0.5, rnd() * 1.2 - 0.3, rnd() - 0.5).normalize()

function makeTarget(shape: Shape | null, dir: THREE.Vector3, rnd: () => number): Target {
  const t: Target = {
    shape, pos: DUST.slice(), nrm: new Float32Array(N * 3), col: new Float32Array(N * 3),
    size: new Float32Array(N), alpha: new Float32Array(N), order: new Float32Array(N),
  }
  for (let i = 0; i < N; i++) { t.size[i] = 0.035 + rnd() * 0.04; t.alpha[i] = 0.04 + rnd() * 0.1; t.order[i] = rnd() }
  if (!shape) return t
  // one glyph size for every object at this density, so the family reads as one family
  const glyph = shape.glyphSize
  for (let i = 0; i < shape.count; i++) {
    const i3 = i * 3
    t.pos.set(shape.pos.subarray(i3, i3 + 3), i3)
    t.nrm.set(shape.nrm.subarray(i3, i3 + 3), i3)
    t.size[i] = glyph
    // release in a sweep across the object, so it assembles like a scan
    const d = (shape.pos[i3] * dir.x + shape.pos[i3 + 1] * dir.y + shape.pos[i3 + 2] * dir.z) / R
    t.order[i] = clamp01((d + 1) / 2 * 0.9 + rnd() * 0.1)
  }
  return t
}

// Colours and base brightness, which depend on theme and palette but not on where dots are
function paint(t: Target, theme: Theme, palette: TintId) {
  const dust = new THREE.Color(THEMES[theme].dust)
  // 'source' takes the object's own colours; its ink is only the fallback for a shape without any
  const ink = new THREE.Color(palette === 'source' ? TINTS[0][theme] : paletteInk(palette, theme))
  const src = palette === 'source' ? t.shape?.col : null, light = theme === 'light'
  for (let i = 0; i < N; i++) {
    const i3 = i * 3
    if (t.nrm[i3] === 0 && t.nrm[i3 + 1] === 0 && t.nrm[i3 + 2] === 0) {
      t.col[i3] = dust.r; t.col[i3 + 1] = dust.g; t.col[i3 + 2] = dust.b
      continue
    }
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

const yawOf = (q: THREE.Quaternion) => Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z))
const FACE = new THREE.Quaternion(), FACE_E = new THREE.Euler()
const Y = new THREE.Vector3(), Q = new THREE.Quaternion(), W = new THREE.Vector3(), X = new THREE.Vector3()

export function Stage({ shape, mode, theme, palette, atlas, spin, orient, paused, onZoom }: Props) {
  const { size, viewport, camera, gl, scene, invalidate, setDpr, setFrameloop } = useThree()
  const group = useRef<THREE.Group>(null!)
  const squash = useRef<THREE.Group>(null!)
  const occ = useRef<THREE.Mesh>(null!)
  const ground = useRef<THREE.Points>(null!)
  const [still, setStill] = useState(false)
  const reduce = useMemo(() => matchMedia('(prefers-reduced-motion: reduce)').matches, [])

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const dyn = (n: number) => new THREE.BufferAttribute(new Float32Array(N * n), n).setUsage(THREE.DynamicDrawUsage)
    for (const k of ['position', 'aNormal', 'aColor', 'aFrom', 'aPrevNormal', 'aPrevColor']) g.setAttribute(k, dyn(3))
    for (const k of ['aSize', 'aAlpha', 'aPrevSize', 'aPrevAlpha', 'aRel', 'aOrder']) g.setAttribute(k, dyn(1))
    const rnd = mulberry32(7), seed = new Float32Array(N)
    for (let i = 0; i < N; i++) seed[i] = rnd()
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40)
    return g
  }, [])

  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: pointVert, fragmentShader: pointFrag, transparent: true, depthWrite: false,
    uniforms: {
      uScale: { value: 1 }, uLightDir: { value: LIGHT.clone() }, uShade: { value: 1 }, uBackFade: { value: 1 }, uTwoSided: { value: 0 },
      uSizeMul: { value: 1 }, uModelScale: { value: 1 }, uLight: { value: 0 }, uMode: { value: 0 }, uTime: { value: 0 }, uEnter: { value: 0 }, uPhase: { value: 0 },
      uCount: { value: 1 }, uJitter: { value: 0 }, uCols: { value: 1 }, uRows: { value: 1 },
      uOrient: { value: 0 }, uOrientCount: { value: 4 }, uOrientBase: { value: 0 }, uEdge: { value: 0.22 },
      uAtlas: { value: null }, uGlint: { value: new THREE.Color() },
      uScan: { value: new THREE.Vector4(0, 1, 0, -1) },
      uRipples: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
      uRipple: { value: 0 }, uPop: { value: new THREE.Vector4(0, 0, 0, -1) },
      uGrab: { value: new THREE.Vector4(0, 0, 0, 0) }, uGrabMode: { value: 0 },
    },
  }), [])

  const occMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: occluderVert, fragmentShader: occluderFrag, colorWrite: false, side: THREE.DoubleSide,
    uniforms: { uPush: { value: 0.025 } },
  }), [])

  // the ground: a soft pool of the faintest glyphs, so the object sits somewhere instead of floating
  const shadowGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(SHADOW_DOTS * 3), ink = new Float32Array(SHADOW_DOTS), seed = new Float32Array(SHADOW_DOTS)
    const rnd = mulberry32(11)
    for (let i = 0; i < SHADOW_DOTS; i++) {
      const t = Math.sqrt(rnd()) * 2 - 1, a = rnd() * Math.PI * 2, rr = Math.sqrt(Math.max(0, 1 - t * t))
      pos[i * 3] = rr * Math.cos(a); pos[i * 3 + 1] = 0; pos[i * 3 + 2] = rr * Math.sin(a)
      ink[i] = Math.min(1, (1 - Math.abs(t)) ** 1.6 * 0.9 + 0.1)
      seed[i] = rnd()
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aInk', new THREE.BufferAttribute(ink, 1))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    return g
  }, [])

  const shadowMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: shadowVert, fragmentShader: shadowFrag, transparent: true, depthWrite: false,
    uniforms: {
      uTime: { value: 0 }, uScale: { value: 1 }, uModelScale: { value: 1 }, uCount: { value: 1 }, uCols: { value: 1 }, uRows: { value: 1 },
      uAtlas: { value: null }, uColor: { value: new THREE.Color() },
    },
  }), [])

  useEffect(() => {
    for (const m of [mat, shadowMat]) {
      m.uniforms.uAtlas.value = atlas.tex
      m.uniforms.uCount.value = atlas.count
      m.uniforms.uCols.value = atlas.cols
      m.uniforms.uRows.value = atlas.rows
    }
    mat.uniforms.uJitter.value = atlas.jitter
    mat.uniforms.uOrientCount.value = atlas.orient.count
    mat.uniforms.uOrientBase.value = atlas.orient.base
  }, [atlas, mat, shadowMat])

  useEffect(() => {
    const light = theme === 'light'
    mat.uniforms.uLight.value = light ? 1 : 0
    mat.uniforms.uMode.value = mode === 'letters' ? 0 : mode === 'dots' ? 1 : 2
    mat.uniforms.uSizeMul.value = SIZE_MUL[mode]
    mat.uniforms.uGlint.value.set(THEMES[theme].lit)
    shadowMat.uniforms.uColor.value.set(THEMES[theme].dust)
    // the grid effect reads an opaque splat image; the other modes blend glyphs or dots
    mat.transparent = mode !== 'grid'
    mat.depthWrite = mode === 'grid'
    mat.blending = mode === 'grid' ? THREE.NoBlending : mode === 'dots' && !light ? THREE.AdditiveBlending : THREE.NormalBlending
    mat.needsUpdate = true
    scene.background = mode === 'grid' ? null : new THREE.Color(THEMES[theme].bg)
  }, [mode, theme, mat, scene, shadowMat])

  // engine state lives in a ref so React never re-renders per frame
  const E = useRef({
    cur: null as Target | null, phase: 'idle' as 'assemble' | 'idle' | 'burst', start: 0, len: 0,
    time: 0, lastInfo: 0, lastFrame: 0, frameMs: 0.016,
    scanNext: 7, scanStart: -99, scanDir: new THREE.Vector3(0, 1, 0),
    ripples: [] as { c: THREE.Vector3; t: number }[],
    q: new THREE.Quaternion().setFromEuler(new THREE.Euler(TILT, -0.6, 0, 'XYZ')),
    w: new THREE.Vector3(), drag: false, lastTouch: -99, zoom: 1, zoomReported: 1, fit: 0.8, occ: 0, moving: false,
    grab: { point: new THREE.Vector3(), held: 0, mode: 0 },
    squash: 0, squashDir: new THREE.Vector2(1, 0),
  })

  // Takes on a new set of targets without moving anything by hand: what each dot is doing right now
  // is frozen into aFrom and the aPrev* attributes, and the vertex shader animates from there. This
  // runs when the target changes, never per frame.
  const commit = (next: Target, stagger: number) => {
    const e = E.current, t0 = e.time, A = geo.attributes
    const pos = A.position.array as Float32Array, nrm = A.aNormal.array as Float32Array, col = A.aColor.array as Float32Array
    const sz = A.aSize.array as Float32Array, al = A.aAlpha.array as Float32Array
    const from = A.aFrom.array as Float32Array, pn = A.aPrevNormal.array as Float32Array, pc = A.aPrevColor.array as Float32Array
    const ps = A.aPrevSize.array as Float32Array, pa = A.aPrevAlpha.array as Float32Array
    const rel = A.aRel.array as Float32Array, ord = A.aOrder.array as Float32Array
    for (let i = 0; i < N; i++) {
      const i3 = i * 3
      const tau = Math.max(0, t0 - rel[i]), d = springDecay(tau), kn = Math.exp(-7 * tau), kc = Math.exp(-5 * tau)
      for (let c = 0; c < 3; c++) {
        from[i3 + c] = pos[i3 + c] + (from[i3 + c] - pos[i3 + c]) * d
        pn[i3 + c] = nrm[i3 + c] + (pn[i3 + c] - nrm[i3 + c]) * kn
        pc[i3 + c] = col[i3 + c] + (pc[i3 + c] - col[i3 + c]) * kc
        pos[i3 + c] = next.pos[i3 + c]
        nrm[i3 + c] = next.nrm[i3 + c]
        col[i3 + c] = next.col[i3 + c]
      }
      ps[i] = sz[i] + (ps[i] - sz[i]) * kc
      pa[i] = al[i] + (pa[i] - al[i]) * kc
      sz[i] = next.size[i]; al[i] = next.alpha[i]
      ord[i] = next.order[i]
      rel[i] = t0 + next.order[i] * stagger
    }
    for (const k in A) if (k !== 'aSeed') A[k].needsUpdate = true
    e.cur = next
  }

  // Seeded from the origin, not the key: the key carries the count, so a detail re-sample would
  // re-roll the dust shell and the dust would jump while the object refined.
  const build = (nextShape: Shape | null) => {
    const rnd = mulberry32(hash(nextShape?.origin ?? 'dust'))
    const target = makeTarget(nextShape, randomDir(rnd), rnd)
    paint(target, theme, palette)
    return target
  }

  const enter = (nextShape: Shape | null, target: Target, burst = false) => {
    const e = E.current
    const scatter = burst && !reduce
    const stagger = scatter ? 0.5 : e.phase === 'idle' && e.time > 0.5 ? 1.1 : 1.7
    commit(target, stagger)
    e.phase = scatter ? 'burst' : 'assemble'; e.start = e.time; e.len = stagger + (scatter ? 2.2 : 1.2)
    e.occ = 0
    if (occ.current) occ.current.geometry = nextShape?.occluder ?? new THREE.BufferGeometry()
    invalidate()
  }

  // A re-sample of the same object at another count changes the picture, not the assembly: the
  // glyphs settle into the finer set in place instead of scattering in again. A new object enters.
  const load = (nextShape: Shape | null) => {
    const e = E.current, target = build(nextShape)
    if (nextShape && e.cur?.shape?.origin === nextShape.origin) {
      // The depth surface is rebuilt even though the object is the same, because the sample cache
      // disposes the occluder of an evicted count and this mesh must not keep drawing a dead one.
      if (occ.current) occ.current.geometry = nextShape.occluder ?? new THREE.BufferGeometry()
      commit(target, 0.35)
      invalidate()
      return
    }
    enter(nextShape, target)
  }

  useEffect(() => { load(shape) }, [shape]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const e = E.current
    if (!e.cur) return
    paint(e.cur, theme, palette)
    commit(e.cur, 0)
  }, [theme, palette]) // eslint-disable-line react-hooks/exhaustive-deps

  // shared by tap-to-ripple and the text snapshot: the current model-view transform
  const views = () => {
    const g = group.current
    g.updateMatrixWorld(); camera.updateMatrixWorld()
    return new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse, g.matrixWorld)
  }

  // ---------------------------------------------------------------- pointer: drag to turn, pinch or wheel to zoom, tap to react
  useEffect(() => {
    const el = gl.domElement, pts = new Map<number, { x: number; y: number }>()
    const rc = new THREE.Raycaster()
    const e = E.current
    // a trackball turns about the axis across the drag, so any direction works and nothing clamps
    const turn = new THREE.Quaternion()
    const axis = new THREE.Vector3(), ndc = new THREE.Vector2(), at = new THREE.Vector3()
    let down = { x: 0, y: 0, t: 0, moved: 0 }, pinch = 0, lastMove = 0, lastTap = -99, hold: number | undefined

    // the occluder gives an exact surface point, which beats scanning every projected dot for the
    // nearest one, and it is already in the depth buffer so it can never pick a hidden dot
    const hit = (cx: number, cy: number) => {
      const o = occ.current
      if (!o?.geometry.attributes.position || !o.visible) return null
      const rect = el.getBoundingClientRect()
      ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1)
      rc.setFromCamera(ndc, camera)
      const h = rc.intersectObject(o, false)[0]
      return h ? group.current.worldToLocal(h.point.clone()) : null
    }
    const onRay = (cx: number, cy: number) => {
      const rect = el.getBoundingClientRect()
      ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1)
      const far = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(camera)
      const dir = far.sub(camera.position).normalize()
      const dist = camera.position.distanceTo(group.current.getWorldPosition(at))
      return group.current.worldToLocal(new THREE.Vector3().copy(camera.position).addScaledVector(dir, dist))
    }
    const rippleAt = (p: THREE.Vector3) => {
      e.ripples.push({ c: p.clone(), t: e.time })
      if (e.ripples.length > 4) e.ripples.shift()
    }
    const tap = (cx: number, cy: number) => {
      const rect = el.getBoundingClientRect(), x = cx - rect.left, y = cy - rect.top
      const dx = x - rect.width / 2, dy = y - rect.height / 2, len = Math.hypot(dx, dy) || 1
      if (navigator.vibrate) navigator.vibrate(10)
      const surface = hit(cx, cy)
      if (surface) {
        rippleAt(surface)
        // tapping off centre turns the object, the way flicking it at the edge would
        e.w.addScaledVector(axis.set(dy / len, -dx / len, 0), 0.9 * Math.min(1, len / (rect.height * 0.4)))
        // a second tap in the same place bursts the glyphs around the point
        if (e.time - lastTap < 0.32) mat.uniforms.uPop.value.set(surface.x, surface.y, surface.z, e.time)
        lastTap = e.time
      } else {
        rippleAt(onRay(cx, cy))
        // a tap on the dust nudges the whole object rather than leaving it silent
        if (!reduce) e.w.addScaledVector(axis.set(dy > 0 ? 0.4 : -0.4, x > rect.width / 2 ? -0.3 : 0.3, 0), 0.2)
      }
    }

    // Pinch and wheel both come through here: one clamp, and a report only when the quantized
    // value changes, so a pinch asks for a handful of re-samples rather than one per event.
    const zoomTo = (z: number) => {
      e.zoom = Math.max(0.5, Math.min(2.6, z))
      const q = Math.round(e.zoom * 20) / 20
      if (q !== e.zoomReported) { e.zoomReported = q; onZoom?.(q) }
      invalidate()
    }

    const onDown = (ev: PointerEvent) => {
      el.setPointerCapture(ev.pointerId)
      pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
      if (pts.size === 1) {
        down = { x: ev.clientX, y: ev.clientY, t: performance.now(), moved: 0 }
        e.drag = true; e.w.set(0, 0, 0)
        const rect = el.getBoundingClientRect()
        const dx = ev.clientX - rect.left - rect.width / 2, dy = ev.clientY - rect.top - rect.height / 2
        const l = Math.hypot(dx, dy) || 1
        e.squashDir.set(Math.abs(dx) / l, Math.abs(dy) / l)
        const p = hit(ev.clientX, ev.clientY)
        e.grab.held = p ? 1 : 0; e.grab.mode = p ? 1 : 0
        if (p) e.grab.point.copy(p)
        window.clearTimeout(hold)
        if (!reduce && p) hold = window.setTimeout(() => { if (e.drag) e.grab.mode = 2 }, 480)
      }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y) }
      e.lastTouch = e.time
      invalidate()
    }
    const onMove = (ev: PointerEvent) => {
      const p = pts.get(ev.pointerId)
      if (!p) {
        // hover: the light leans a little toward the pointer
        const rect = el.getBoundingClientRect()
        const hx = ((ev.clientX - rect.left) / rect.width - 0.5) * 2, hy = ((ev.clientY - rect.top) / rect.height - 0.5) * 2
        mat.uniforms.uLightDir.value.copy(LIGHT).applyAxisAngle(Y, hx * 0.22).applyAxisAngle(X, -hy * 0.22)
        invalidate()
        return
      }
      const dx = ev.clientX - p.x, dy = ev.clientY - p.y, now = performance.now(), dt = Math.max(1, now - lastMove) / 1000
      p.x = ev.clientX; p.y = ev.clientY; lastMove = now
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinch > 0) zoomTo(e.zoom * (d / pinch))
        pinch = d; down.moved = 99
      } else {
        const k = 0.0065, len = Math.hypot(dx, dy)
        if (len > 0) {
          axis.set(dy / len, dx / len, 0).normalize()
          e.q.premultiply(turn.setFromAxisAngle(axis, len * k))
          e.w.copy(axis).multiplyScalar((len * k) / dt)
        }
        down.moved += Math.abs(dx) + Math.abs(dy)
      }
      e.lastTouch = e.time
      invalidate()
    }
    const onUp = (ev: PointerEvent) => {
      pts.delete(ev.pointerId)
      if (pts.size < 2) pinch = 0
      if (pts.size === 0) {
        e.drag = false
        window.clearTimeout(hold)
        e.grab.held = 0; e.grab.mode = 0
        if (performance.now() - lastMove > 80) e.w.set(0, 0, 0) // held still before letting go: no fling
        if (down.moved < 8 && performance.now() - down.t < 400) tap(ev.clientX, ev.clientY)
        invalidate()
      }
    }
    const onLeave = () => { if (!pts.size) mat.uniforms.uLightDir.value.copy(LIGHT) }
    const onWheel = (ev: WheelEvent) => { ev.preventDefault(); zoomTo(e.zoom * Math.exp(-ev.deltaY * 0.0012)) }
    el.addEventListener('pointerdown', onDown); el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp)
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.clearTimeout(hold)
      el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('pointerleave', onLeave); el.removeEventListener('wheel', onWheel)
    }
  }, [gl, camera, mat, reduce, invalidate, onZoom]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- imperative hooks for the UI
  useEffect(() => {
    stageApi.burst = () => { const e = E.current; if (e.cur?.shape) enter(e.cur.shape, build(e.cur.shape), true) }
    stageApi.rotate = (dx, dy) => {
      const e = E.current
      const len = Math.hypot(dx, dy)
      if (!len) return
      e.q.premultiply(Q.setFromAxisAngle(W.set(dy / len, dx / len, 0).normalize(), len))
      e.lastTouch = e.time
      invalidate()
    }
    stageApi.png = () => gl.domElement.toDataURL('image/png')
    stageApi.snapshot = (cols = 96) => {
      const e = E.current
      if (!e.cur?.shape) return ''
      return snapshotText({
        pos: geo.attributes.position.array as Float32Array,
        nrm: geo.attributes.aNormal.array as Float32Array,
        size: geo.attributes.aSize.array as Float32Array,
        alpha: geo.attributes.aAlpha.array as Float32Array,
        mv: views(), projection: camera.projectionMatrix, width: size.width, height: size.height,
        twoSided: e.cur.shape.twoSided, sizeMul: SIZE_MUL.grid, modelScale: e.zoom * e.fit, light: LIGHT,
        ramp: atlas.ranked, cols,
      })
    }
  })

  // ---------------------------------------------------------------- the frame loop
  useFrame((_, rawDt) => {
    const e = E.current, dt = Math.min(rawDt, 1 / 20)
    e.time += dt
    const now = e.time, cur = e.cur
    if (!cur) return
    const shp = cur.shape
    const tPh = now - e.start
    if (e.phase !== 'idle' && tPh > e.len) e.phase = 'idle'
    // every so often a bright band sweeps across the object, the way ivory's crest crosses its scenes
    if (e.phase === 'idle' && shp && now > e.scanNext) {
      const rnd = mulberry32(hash(`${shp.key}:${Math.floor(now)}`))
      e.scanStart = now; e.scanDir.copy(randomDir(rnd)); e.scanNext = now + 9 + rnd() * 7
    }
    const scanOn = now - e.scanStart <= 2.6
    e.ripples = e.ripples.filter((r) => now - r.t < 3.5)

    // dragging turns it, a fling coasts, and the slow spin picks up again once it is left alone
    if (!e.drag) {
      e.w.multiplyScalar(Math.exp(-dt * 2.4))
      const back = smooth((now - e.lastTouch - 1.2) / 1.8)
      if (shp?.pose === 'face') {
        // type should stay readable: rock gently around facing the viewer instead of turning away
        const yaw = yawOf(e.q)
        const ty = (spin && !reduce ? Math.sin(now * 0.4) * 0.5 : 0) + Math.PI * 2 * Math.round(yaw / (Math.PI * 2))
        const k = (1 - Math.exp(-dt * 1.4)) * back
        e.q.slerp(FACE.setFromEuler(FACE_E.set(TILT - 0.2, ty, 0, 'XYZ')), k)
        e.w.multiplyScalar(1 - k)
      } else if (spin && !reduce) {
        // the idle spin eases in from whatever axis the fling left behind instead of snapping to Y
        e.w.lerp(Y.set(0, Math.max(0.22, e.w.length()), 0), back * (1 - Math.exp(-dt * 2)))
      }
    }
    const wl = e.w.length()
    if (wl > 1e-6) e.q.premultiply(Q.setFromAxisAngle(W.copy(e.w).divideScalar(wl), wl * dt))
    group.current.quaternion.copy(e.q)

    // fit the object to the screen: its width as it turns, and its height clear of header and caption
    const vp = viewport.getCurrentViewport(camera, [0, 0, 0])
    const across = shp?.across ?? R, up = shp?.up ?? R
    const fitTo = Math.min(1.3, (vp.width * 0.9) / (2 * across), (vp.height * 0.58) / (2 * up))
    e.fit += (fitTo - e.fit) * (1 - Math.exp(-dt * 2.5))
    const fit = e.fit
    // while a grab is held the object squashes a few percent toward the pointer and springs back
    e.squash += ((e.grab.mode === 1 ? 0.04 : 0) - e.squash) * (1 - Math.exp(-dt * (e.grab.mode === 1 ? 9 : 4)))
    squash.current.scale.set(e.zoom * fit * (1 - e.squash * e.squashDir.x), e.zoom * fit * (1 - e.squash * e.squashDir.y), e.zoom * fit)
    // on tall phone screens lift the object clear of the caption
    group.current.position.y = vp.width / vp.height < 0.8 ? vp.height * 0.06 : 0
    const sh = ground.current
    sh.visible = !!shp && mode !== 'grid'
    if (sh.visible) {
      sh.position.y = group.current.position.y - up * e.zoom * fit * 0.95
      sh.scale.set(across * 1.25 * e.zoom * fit, 1, across * 0.8 * e.zoom * fit)
    }

    // the occluder grows with the object as it assembles, so dots fly in front of it, not through it
    const o = occ.current
    e.occ += ((e.phase === 'idle' || tPh > e.len * 0.6 ? 1 : 0.2) - e.occ) * (1 - Math.exp(-dt * 3))
    o.visible = !!shp?.occluder
    o.scale.setScalar(Math.max(0.01, e.occ))

    const persp = camera as THREE.PerspectiveCamera
    const u = mat.uniforms
    const scale = (size.height * viewport.dpr) / (2 * Math.tan((persp.fov * Math.PI) / 360))
    u.uTime.value = now
    u.uEnter.value = e.start
    u.uPhase.value = e.phase === 'assemble' ? 1 : e.phase === 'burst' ? 2 : 0
    u.uScan.value.set(e.scanDir.x, e.scanDir.y, e.scanDir.z, scanOn ? e.scanStart : -1)
    u.uRipple.value = e.ripples.length
    e.ripples.forEach((r, i) => u.uRipples.value[i].set(r.c.x, r.c.y, r.c.z, r.t))
    u.uGrab.value.set(e.grab.point.x, e.grab.point.y, e.grab.point.z, e.grab.held)
    u.uGrabMode.value = e.grab.mode
    u.uOrient.value = orient && mode === 'letters' ? 1 : 0
    u.uScale.value = scale
    u.uTwoSided.value = shp?.twoSided ? 1 : 0
    u.uBackFade.value += ((shp?.twoSided ? 0 : 1) - u.uBackFade.value) * (1 - Math.exp(-dt * 3))
    occMat.uniforms.uPush.value = 0.03 * e.zoom * fit
    // the glyph size is in object space now, so the model's own scale multiplies it into screen;
    // the ground carries its own x/z scale on top of that
    u.uModelScale.value = e.zoom * fit
    shadowMat.uniforms.uTime.value = now
    shadowMat.uniforms.uScale.value = scale
    // zoom only: the ground keeps the size it has at 1x, and its glyphs spread with the object
    shadowMat.uniforms.uModelScale.value = e.zoom

    // adaptive quality: a phone that cannot hold 20 ms a frame gets fewer pixels rather than fewer frames
    e.frameMs += (dt - e.frameMs) * 0.05
    if (now - e.lastFrame > 1.5) {
      e.lastFrame = now
      const dpr = viewport.dpr
      if (e.frameMs > 0.02 && dpr > 1) setDpr(Math.max(1, dpr - 0.25))
      else if (e.frameMs < 0.012 && dpr < 2) setDpr(Math.min(2, dpr + 0.25))
    }

    // once nothing is moving the canvas stops: no rAF, no work, until something asks for a frame
    const moving = e.drag || e.phase !== 'idle' || e.ripples.length > 0 || scanOn || (spin && !reduce) ||
      wl > 0.005 || e.squash > 0.001 || Math.abs(fitTo - fit) > 0.002
    if (moving !== e.moving) { e.moving = moving; setStill(!moving) }

    if (now - e.lastInfo > 0.1) {
      e.lastInfo = now
      infoStore.set({ phase: e.phase === 'assemble' ? 'assembling' : e.phase === 'burst' ? 'scattering' : scanOn ? 'scanning' : 'rendering', glyphs: shp?.count ?? 0 })
    }
  })

  useEffect(() => {
    setFrameloop(paused ? 'never' : still ? 'demand' : 'always')
    if (still && !paused) invalidate()
  }, [still, paused, setFrameloop, invalidate])

  return (
    <group ref={squash}>
      <points ref={ground} geometry={shadowGeo} material={shadowMat} frustumCulled={false} />
      <group ref={group}>
        <mesh ref={occ} material={occMat} renderOrder={-1} frustumCulled={false} />
        <points geometry={geo} material={mat} frustumCulled={false} />
      </group>
    </group>
  )
}
