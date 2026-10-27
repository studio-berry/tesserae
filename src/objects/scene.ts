import * as THREE from 'three'
import { mulberry32 } from '../engine/core.ts'

// A scene the prompt writer returned, run against a corner of three rather than the whole library.
//
// The code arrives from a model, and a shared `?chat=` link carries whatever prompt its author
// typed, so the code is untrusted input: a prompt can ask for a scene and get one that tries to
// reach the network or the page. Three rules hold it.
//
// The namespace is the first: `sceneThree` holds the constructors a scene needs and nothing else.
// `THREE.FileLoader` and `THREE.TextureLoader` can fetch, so they are not in it, and a name the
// model invents is `undefined` rather than a reachable global.
//
// The check is the second: a name that would reach past the namespace, or a loop that would never
// end, is refused before the code runs at all, an escaped name or a looked-up string included.
//
// The worker is the third. A scene runs in a worker of its own, with no document, no Function
// constructor and no network (`lockdown`), killed at a deadline. A scene that fails or runs out of
// time there is reported, and never run again on the page.
export const MAX_CODE = 24_000
export const MAX_TRIS = 120_000
export const MAX_PARTS = 400

// The constructors a scene is built from. Everything here is geometry or a material; nothing here
// reads a file, a URL or the page.
export const sceneThree = () => ({
  Group: THREE.Group,
  Mesh: THREE.Mesh,
  Points: THREE.Points,
  BoxGeometry: THREE.BoxGeometry,
  SphereGeometry: THREE.SphereGeometry,
  CylinderGeometry: THREE.CylinderGeometry,
  ConeGeometry: THREE.ConeGeometry,
  TorusGeometry: THREE.TorusGeometry,
  TorusKnotGeometry: THREE.TorusKnotGeometry,
  CapsuleGeometry: THREE.CapsuleGeometry,
  IcosahedronGeometry: THREE.IcosahedronGeometry,
  OctahedronGeometry: THREE.OctahedronGeometry,
  DodecahedronGeometry: THREE.DodecahedronGeometry,
  TetrahedronGeometry: THREE.TetrahedronGeometry,
  CircleGeometry: THREE.CircleGeometry,
  RingGeometry: THREE.RingGeometry,
  PlaneGeometry: THREE.PlaneGeometry,
  LatheGeometry: THREE.LatheGeometry,
  ExtrudeGeometry: THREE.ExtrudeGeometry,
  TubeGeometry: THREE.TubeGeometry,
  Shape: THREE.Shape,
  CatmullRomCurve3: THREE.CatmullRomCurve3,
  Vector2: THREE.Vector2,
  Vector3: THREE.Vector3,
  Euler: THREE.Euler,
  Color: THREE.Color,
  MeshStandardMaterial: THREE.MeshStandardMaterial,
  MeshBasicMaterial: THREE.MeshBasicMaterial,
  MeshLambertMaterial: THREE.MeshLambertMaterial,
  FrontSide: THREE.FrontSide,
  BackSide: THREE.BackSide,
  DoubleSide: THREE.DoubleSide,
})

// The names a scene may not mention, and why. A reach past the namespace is a `constructor` or a
// global; a loop that never ends is a `while`; everything else is a capability a scene does not
// need to draw a shape.
const BANNED: [RegExp, string][] = [
  [/\bwhile\s*\(/, 'a while loop'],
  [/\bdo\s*\{/, 'a do loop'],
  [/\bfor\s*\(\s*;/, 'a loop with no end'],
  [/\bconstructor\b/, 'constructor'],
  [/\bprototype\b/, '__proto__ access'],
  [/__proto__/, '__proto__ access'],
  [/\bimport\b/, 'import'],
  [/\brequire\b/, 'require'],
  [/\beval\b/, 'eval'],
  [/\bFunction\b/, 'the Function constructor'],
  [/\bglobalThis\b/, 'globalThis'],
  [/\bself\b/, 'self'],
  [/\bwindow\b/, 'window'],
  [/\bdocument\b/, 'document'],
  [/\blocalStorage\b/, 'localStorage'],
  [/\bsessionStorage\b/, 'sessionStorage'],
  [/\bindexedDB\b/, 'indexedDB'],
  [/\bnavigator\b/, 'navigator'],
  [/\bcrypto\b/, 'crypto'],
  [/\bfetch\b/, 'fetch'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bimportScripts\b/, 'importScripts'],
  [/\bpostMessage\b/, 'postMessage'],
  [/\bSharedArrayBuffer\b/, 'SharedArrayBuffer'],
  [/\bAtomics\b/, 'Atomics'],
  [/\bWorker\b/, 'Worker'],
  // A banned name can also be spelled past every pattern above with an escape (`constructor`),
  // so a backslash anywhere is refused. Scene code has no use for one.
  [/\\/, 'an escape'],
]

// The other way to spell a banned name: build it as a string and look it up (`x['con' +
// 'structor']`). A subscript is a `[` straight after a name, a `)` or a `]`; one that holds a string
// is refused. A numeric index (`pts[i]`, `a[i + 1]`) and an array of strings (`['#f00', '#0f0']`)
// stay allowed. A string in a variable (`x[k]`) passes here, and `lockdown` is what holds it.
const KEYWORDS = new Set(['return', 'typeof', 'in', 'of', 'case', 'yield', 'await', 'void', 'delete', 'else'])

const looksUpString = (code: string) => {
  for (let i = code.indexOf('['); i >= 0; i = code.indexOf('[', i + 1)) {
    const before = code.slice(0, i).trimEnd()
    if (!/[\w$)\]]$/.test(before)) continue
    const word = /[\w$]+$/.exec(before)?.[0]
    if (word && KEYWORDS.has(word)) continue
    const end = code.indexOf(']', i)
    if (/['"`]/.test(code.slice(i + 1, end < 0 ? undefined : end))) return true
  }
  return false
}

export type CodeVerdict = { ok: true } | { ok: false; reason: string }

// Checked before the code runs, so a refusal costs no execution at all.
export function checkCode(code: string): CodeVerdict {
  if (!code.trim()) return { ok: false, reason: 'the scene writer sent no code' }
  if (code.length > MAX_CODE) return { ok: false, reason: 'the scene code is too long' }
  for (const [pattern, label] of BANNED) if (pattern.test(code)) return { ok: false, reason: `the scene used ${label}` }
  if (looksUpString(code)) return { ok: false, reason: 'the scene used a looked-up property name' }
  return { ok: true }
}

// The runtime half, for a worker that runs scenes and nothing else: what the check cannot see is
// taken away. A name looked up through a variable passes any text check, and every way from a
// function back to the global object goes through a Function constructor, so the constructor of each
// kind of function throws, and the globals that reach the network are gone. Only the scene worker
// calls it: three never asks a function for its constructor, but the rest of the app is not promised.
const NETWORK = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker']

export function lockdown() {
  const refused = function () {
    throw new Error('the scene used the Function constructor')
  }
  for (const kind of [function () {}, async function () {}, function* () {}, async function* () {}]) {
    Object.defineProperty(Object.getPrototypeOf(kind), 'constructor', { value: refused, writable: false, configurable: false })
  }
  const scope = globalThis as Record<string, unknown>
  for (const name of NETWORK) {
    try {
      delete scope[name]
      Object.defineProperty(scope, name, { value: undefined, writable: false, configurable: false })
    } catch {
      // a name this runtime defines for good is checked by the test, not silently trusted
    }
  }
}

export type RanScene = { object: THREE.Object3D; parts: number; tris: number }

// What the code made, checked: an object, something in it, finite bounds and a triangle count the
// sampler can flatten without a gigabyte of soup.
export function runScene(code: string, seed: number): RanScene {
  const verdict = checkCode(code)
  if (!verdict.ok) throw new Error(verdict.reason)
  // strict mode makes `this` undefined at the top of the body, so the global object is not reachable
  // through it, and the two bindings are the whole world the code gets.
  //
  // Running the writer's code is the point of the feature, so the scan below is suppressed rather
  // than a pattern to be removed: the string really is untrusted, and four things hold it. The check
  // above refuses a name that reaches past the namespace before anything runs. The namespace holds
  // no loader, so no constructor in reach can read a file or a URL. Strict mode leaves no global on
  // `this`. And the caller runs this in a locked-down worker with no document, under a deadline that
  // kills the worker. The alternative that removes the class of risk is a scene described as data (a list of
  // primitives and transforms, no code at all); it is recorded in docs/run-log.tsv and not done,
  // because the measured pass rate belongs to code the model writes, not to a format it would have
  // to be taught.
  // This is the line code scanning reports as js/code-injection, and it is not suppressed: the
  // repo's setup does not honor suppression comments, so the finding stays visible until it is
  // dismissed after merge. The four rules above are what hold it, and #55 carries the alternative.
  const make = new Function('THREE', 'rng', `'use strict';\n${code}`) as (t: unknown, r: () => number) => unknown
  const made = make(sceneThree(), mulberry32(seed))
  const object = made as THREE.Object3D | null
  if (!object || typeof object !== 'object' || !object.isObject3D) throw new Error('the scene writer did not return an object')

  let parts = 0
  let tris = 0
  object.traverse((o) => {
    const mesh = o as THREE.Mesh
    const position = mesh.geometry?.attributes?.position
    if (!position || o.visible === false) return
    parts++
    const index = mesh.geometry.index
    tris += Math.floor((index ? index.count : position.count) / 3)
  })
  if (!parts) throw new Error('the scene holds nothing to draw')
  if (parts > MAX_PARTS) throw new Error('the scene holds too many parts')
  if (tris > MAX_TRIS) throw new Error('the scene holds too many triangles')

  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const reach = Math.max(size.x, size.y, size.z)
  if (!Number.isFinite(reach) || !Number.isFinite(box.min.x + box.min.y + box.min.z)) throw new Error('the scene has no bounds')
  if (reach < 1e-4) throw new Error('the scene is empty')
  return { object, parts, tris }
}
