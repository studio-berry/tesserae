import * as THREE from 'three'
import { klein } from 'three/examples/jsm/geometries/ParametricFunctions.js'
import { ParametricGeometry } from 'three/examples/jsm/geometries/ParametricGeometry.js'
import { TeapotGeometry } from 'three/examples/jsm/geometries/TeapotGeometry.js'
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Rng } from '../engine/core'

// Built-in objects. Each takes a seeded rng: seed 0 gives the canonical form, any other seed a
// variation (a different knot, solid, shell or rock), which is what "reroll" asks for.
export type Built = { object: THREE.Object3D; title: string; detail: string; twoSided?: boolean }
export type LibItem = { id: string; name: string; build: (rng: Rng, seed: number) => Built }

const mesh = (g: THREE.BufferGeometry, color?: string) => new THREE.Mesh(g, new THREE.MeshBasicMaterial(color ? { color } : {}))
const pick = <T,>(rng: Rng, a: readonly T[]) => a[Math.floor(rng() * a.length) % a.length]
const f2 = (x: number) => x.toFixed(2).replace(/\.?0+$/, '')

// a thin cylinder from a to b, for edges and rungs
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 8) {
  const d = new THREE.Vector3().subVectors(b, a), g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1, true)
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()))
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
  return g
}

// ---------------------------------------------------------------- supershape
// Gielis' superformula in 3D: a handful of numbers span stars, shells, flowers and blobs, so
// every reroll grows a new form.
const ss = (t: number, m: number, n1: number, n2: number, n3: number) => {
  const a = Math.abs(Math.cos((m * t) / 4)) ** n2 + Math.abs(Math.sin((m * t) / 4)) ** n3
  return a === 0 ? 0 : Math.min(2.5, a ** (-1 / n1))
}
type SS = [number, number, number, number]
const RIM: SS[] = [[6, 1, 1, 1], [5, 0.3, 1.7, 1.7], [7, 0.2, 1.7, 1.7], [3, 4.5, 10, 10], [4, 12, 15, 15], [8, 1.5, 4, 8], [5, 1, 1, 1], [6, 0.6, 2, 2], [9, 2, 6, 6], [4, 0.4, 1, 3], [12, 3, 20, 20]]
const PROFILE: SS[] = [[0, 1, 1, 1], [0, 1, 1, 1], [4, 2, 4, 4], [6, 3, 6, 6], [4, 1.6, 3, 3], [8, 4, 6, 6], [3, 3, 5, 5]]
const supershape: LibItem = {
  id: 'supershape', name: 'supershape',
  build: (rng, seed) => {
    const jit = (p: SS): SS => [p[0], p[1] * (0.8 + rng() * 0.4), p[2] * (0.8 + rng() * 0.4), p[3] * (0.8 + rng() * 0.4)]
    const A: SS = seed ? jit(pick(rng, RIM)) : [8, 1.5, 4, 8]
    const B: SS = seed ? jit(pick(rng, PROFILE)) : [4, 1.6, 3, 3]
    const g = new ParametricGeometry((u, v, t) => {
      const th = -Math.PI + u * 2 * Math.PI, ph = -Math.PI / 2 + v * Math.PI
      const r1 = ss(th, ...A), r2 = ss(ph, ...B)
      // the rim's outline faces the camera, so the turntable shows it face-on, then edge-on
      t.set(r1 * Math.cos(th) * r2 * Math.cos(ph), r1 * Math.sin(th) * r2 * Math.cos(ph), r2 * Math.sin(ph))
    }, 220, 110)
    const fmt = (p: SS) => `m ${p[0]} · n ${p.slice(1).map(f2).join(' ')}`
    return { object: mesh(g), title: 'Supershape', detail: `${fmt(A)} / ${fmt(B)}`, twoSided: true }
  },
}

// ---------------------------------------------------------------- donut
const donut: LibItem = {
  id: 'donut', name: 'donut',
  build: (rng, seed) => {
    const r = seed ? 0.25 + rng() * 0.35 : 0.45
    return { object: mesh(new THREE.TorusGeometry(1, r, 72, 180)), title: 'Donut', detail: `torus · R 1 · r ${f2(r)}` }
  },
}

// ---------------------------------------------------------------- teapot
const teapot: LibItem = {
  id: 'teapot', name: 'teapot',
  build: (_rng, seed) => {
    const lid = seed % 2 === 0
    const g = new TeapotGeometry(1, 18, true, lid, true, true, true)
    return { object: mesh(g), title: 'Utah teapot', detail: `Martin Newell, 1975${lid ? '' : ' · lid off'}`, twoSided: true }
  },
}

// ---------------------------------------------------------------- knot
const KNOTS: [number, number][] = [[2, 3], [3, 5], [2, 5], [3, 7], [3, 4], [2, 7], [4, 5], [5, 6], [3, 8]]
const knot: LibItem = {
  id: 'knot', name: 'knot',
  build: (rng, seed) => {
    const [p, q] = seed ? pick(rng, KNOTS.slice(1)) : KNOTS[0]
    const tube = 0.5 / Math.sqrt(Math.max(p, q))
    const g = new THREE.TorusKnotGeometry(1, tube, 600, 40, p, q)
    return { object: mesh(g), title: p === 2 && q === 3 ? 'Trefoil knot' : 'Torus knot', detail: `(${p}, ${q}) torus knot` }
  },
}

// ---------------------------------------------------------------- crystal
const SOLIDS = [
  { name: 'Icosahedron', make: () => new THREE.IcosahedronGeometry(1, 0) },
  { name: 'Dodecahedron', make: () => new THREE.DodecahedronGeometry(1, 0) },
  { name: 'Octahedron', make: () => new THREE.OctahedronGeometry(1, 0) },
  { name: 'Tetrahedron', make: () => new THREE.TetrahedronGeometry(1, 0) },
  { name: 'Cube', make: () => new THREE.BoxGeometry(1.2, 1.2, 1.2) },
]
// flat faces each take one glyph density, so the solid reads like cut stone; the edges are
// drawn as fine rods so the facets stay separated
const crystal: LibItem = {
  id: 'crystal', name: 'crystal',
  build: (rng, seed) => {
    const s = seed ? pick(rng, SOLIDS.slice(1)) : SOLIDS[0]
    const g = s.make().toNonIndexed()
    g.computeVertexNormals()
    const e = new THREE.EdgesGeometry(g, 10).attributes.position, rods: THREE.BufferGeometry[] = []
    const a = new THREE.Vector3(), b = new THREE.Vector3()
    for (let i = 0; i < e.count; i += 2) rods.push(rod(a.fromBufferAttribute(e, i), b.fromBufferAttribute(e, i + 1), 0.018, 6))
    const group = new THREE.Group()
    group.add(mesh(g), mesh(mergeGeometries(rods), '#ffd08a'))
    group.rotation.set(0.35, 0.2, 0.1)
    return { object: group, title: s.name, detail: `platonic solid · ${g.attributes.position.count / 3} faces` }
  },
}

// ---------------------------------------------------------------- shell
// a logarithmic seashell: the tube grows exponentially as it winds
const shell: LibItem = {
  id: 'shell', name: 'shell',
  build: (rng, seed) => {
    const turns = seed ? 2.2 + rng() * 1.4 : 3, flare = seed ? 5 + rng() * 2.5 : 6
    const g = new ParametricGeometry((u, v, t) => {
      const U = u * turns * 2 * Math.PI, V = v * 2 * Math.PI, e = Math.exp(U / (flare * Math.PI)), e2 = Math.exp(U / ((flare / 2) * Math.PI))
      t.set(2 * (1 - e) * Math.cos(U) * Math.cos(V / 2) ** 2, 1 - e2 - Math.sin(V) + e * Math.sin(V), 2 * (-1 + e) * Math.sin(U) * Math.cos(V / 2) ** 2)
    }, 260, 70)
    g.rotateX(Math.PI)
    return { object: mesh(g), title: 'Seashell', detail: `logarithmic spiral · ${f2(turns)} turns`, twoSided: true }
  },
}

// ---------------------------------------------------------------- klein
const kleinBottle: LibItem = {
  id: 'klein', name: 'klein',
  build: () => {
    const g = new ParametricGeometry(klein, 160, 160)
    g.rotateX(-Math.PI / 2)
    return { object: mesh(g), title: 'Klein bottle', detail: 'one surface, no inside', twoSided: true }
  },
}

// ---------------------------------------------------------------- helix
class Helix extends THREE.Curve<THREE.Vector3> {
  constructor(private turns: number, private phase: number, private h: number, private r: number) { super() }
  getPoint(t: number, out = new THREE.Vector3()) {
    const a = t * this.turns * 2 * Math.PI + this.phase
    return out.set(this.r * Math.cos(a), (t - 0.5) * this.h, this.r * Math.sin(a))
  }
}
const BASES = { A: '#ff9c62', T: '#4fd1a5', C: '#c08bff', G: '#f2c94c' }
const helix: LibItem = {
  id: 'helix', name: 'helix',
  build: (rng, seed) => {
    const turns = seed ? 1.6 + rng() * 1.2 : 2.2, H = 4.4, Rr = 0.9, groove = 0.78 * Math.PI
    const group = new THREE.Group()
    const s1 = new Helix(turns, 0, H, Rr), s2 = new Helix(turns, groove, H, Rr)
    group.add(mesh(mergeGeometries([new THREE.TubeGeometry(s1, 420, 0.12, 12), new THREE.TubeGeometry(s2, 420, 0.12, 12)]), '#8fa6d6'))
    const n = Math.round(turns * 10.5), byBase: Record<string, THREE.BufferGeometry[]> = { A: [], T: [], C: [], G: [] }
    let seq = ''
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, a = s1.getPoint(t), b = s2.getPoint(t), mid = a.clone().lerp(b, 0.5)
      const x = pick(rng, ['A', 'T', 'C', 'G'] as const), y = ({ A: 'T', T: 'A', C: 'G', G: 'C' } as const)[x]
      byBase[x].push(rod(a, mid, 0.055)); byBase[y].push(rod(mid, b, 0.055))
      seq += x
    }
    for (const [base, rods] of Object.entries(byBase)) if (rods.length) group.add(mesh(mergeGeometries(rods), BASES[base as keyof typeof BASES]))
    return { object: group, title: 'Double helix', detail: `${n} base pairs · ${seq.slice(0, 12)}…` }
  },
}

// ---------------------------------------------------------------- asteroid
const asteroid: LibItem = {
  id: 'asteroid', name: 'asteroid',
  build: (rng, seed) => {
    const noise = new SimplexNoise({ random: rng })
    const fbm = (x: number, y: number, z: number) => {
      let a = 0, f = 1.3, amp = 1, sum = 0
      for (let o = 0; o < 5; o++) { a += amp * noise.noise3d(x * f, y * f, z * f); sum += amp; f *= 2.03; amp *= 0.5 }
      return a / sum
    }
    const craters = Array.from({ length: 7 + Math.floor(rng() * 6) }, () => {
      const c = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(), r = 0.12 + rng() * 0.28
      return { c, r, d: r * 0.4 }
    })
    let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 48)
    g.deleteAttribute('normal'); g.deleteAttribute('uv')
    g = mergeVertices(g)
    const P = g.attributes.position, p = new THREE.Vector3(), stretch = new THREE.Vector3(1.25 + rng() * 0.2, 0.85 + rng() * 0.1, 0.95)
    for (let i = 0; i < P.count; i++) {
      p.fromBufferAttribute(P, i).normalize()
      let h = 0.2 * fbm(p.x, p.y, p.z)
      for (const k of craters) {
        const d = Math.acos(Math.min(1, p.dot(k.c))) / k.r
        if (d < 1) h -= k.d * (1 - d * d)
        else if (d < 1.5) h += k.d * 0.3 * (1 - (d - 1) / 0.5) ** 2
      }
      p.multiplyScalar(1 + h).multiply(stretch)
      P.setXYZ(i, p.x, p.y, p.z)
    }
    g.computeVertexNormals()
    return { object: mesh(g), title: 'Asteroid', detail: `${craters.length} craters · #${(seed + 1).toString(16).padStart(3, '0')}` }
  },
}

export const LIBRARY: LibItem[] = [teapot, supershape, donut, knot, crystal, shell, kleinBottle, helix, asteroid]
