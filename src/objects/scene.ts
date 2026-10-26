import * as THREE from 'three'
import { mulberry32 } from '../engine/core.ts'

// A scene the prompt writer returned, run against a corner of three rather than the whole library.
//
// The code arrives from a model, and a shared `?chat=` link carries whatever prompt its author
// typed, so the code is untrusted input: a prompt can ask for a scene and get one that tries to
// reach the network or the page. Two rules hold it.
//
// The namespace is the first: `sceneThree` holds the constructors a scene needs and nothing else.
// `THREE.FileLoader` and `THREE.TextureLoader` can fetch, so they are not in it, and a name the
// model invents is `undefined` rather than a reachable global.
//
// The check is the second: a name that would reach past the namespace, or a loop that would never
// end, is refused before the code runs at all. The runner also runs in the worker, which has no
// document, and a scene is given a deadline there.
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
]

export type CodeVerdict = { ok: true } | { ok: false; reason: string }

// Checked before the code runs, so a refusal costs no execution at all.
export function checkCode(code: string): CodeVerdict {
  if (!code.trim()) return { ok: false, reason: 'the scene writer sent no code' }
  if (code.length > MAX_CODE) return { ok: false, reason: 'the scene code is too long' }
  for (const [pattern, label] of BANNED) if (pattern.test(code)) return { ok: false, reason: `the scene used ${label}` }
  return { ok: true }
}

export type RanScene = { object: THREE.Object3D; parts: number; tris: number }

// What the code made, checked: an object, something in it, finite bounds and a triangle count the
// sampler can flatten without a gigabyte of soup.
export function runScene(code: string, seed: number): RanScene {
  const verdict = checkCode(code)
  if (!verdict.ok) throw new Error(verdict.reason)
  // strict mode makes `this` undefined at the top of the body, so the global object is not reachable
  // through it, and the two bindings are the whole world the code gets
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
