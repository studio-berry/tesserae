import * as THREE from 'three'

// The stage drives a fixed pool of N dots. An object uses `count` of them; the rest drift as
// "dust", a faint far shell that gives the stage depth (the same trick the ivory scenes use).
export const N = 12000

// every object is centred and scaled so its bounding sphere has this radius
export const R = 1.9

export type Theme = 'dark' | 'light'
export type Mode = 'letters' | 'grid' | 'dots'

export const THEMES = {
  dark: { bg: '#0a0c11', dust: '#3a4152', lit: '#ffd08a' },
  light: { bg: '#f3efe6', dust: '#cbc4b5', lit: '#c27a1e' },
} as const

export const TINTS = [
  { id: 'ivory', dark: '#ece6d9', light: '#2a2620' },
  { id: 'blue', dark: '#7b95ff', light: '#3a5bd9' },
  { id: 'ember', dark: '#ff9c62', light: '#d9733a' },
  { id: 'jade', dark: '#4fd1a5', light: '#2f9e7a' },
  { id: 'violet', dark: '#c08bff', light: '#9a5bd9' },
] as const

// 'source' keeps the object's own colours (vertex colours, materials, textures) when it has any
export type TintId = (typeof TINTS)[number]['id'] | 'source'

export const linear = (hex: string) => new THREE.Color(hex)

// Small seeded PRNG so a seed always rebuilds the same object and the same sampling
export type Rng = () => number
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
export const smooth = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t) }

const gauss = (r: Rng) => (r() + r() + r() - 1.5) / 1.5

// far shell of dust, pushed behind the object so it never crowds the silhouette
export const DUST = (() => {
  const r = mulberry32(7), a = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) {
    let x = gauss(r), y = gauss(r), z = gauss(r)
    const l = Math.hypot(x, y, z) || 1, d = 7 + r() * 11
    x = (x / l) * d; y = (y / l) * d * 0.7; z = (z / l) * d
    if (z > 1) z = -z
    a.set([x, y, z], i * 3)
  }
  return a
})()
