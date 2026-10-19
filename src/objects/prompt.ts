import * as THREE from 'three'
import { Rng } from '../engine/core'
import { checkTyped, REFUSAL } from '../safety'
import { LIBRARY } from './library'
import { findDrawing, findModel } from './search'
import { svgObject } from './svg'

export type Provenance = { author: string; licence: string; url: string }

export type PromptResult = {
  object: THREE.Object3D
  title: string
  detail: string
  twoSided?: boolean
  flat: boolean
  source: Provenance | null
}

const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'with', 'in', 'on', 'for', 'my', 'our', 'your'])
const MARKS = /[\u0300-\u036f]/g

// Lowercase ascii words, without punctuation or repeated spacing, so the same prompt always
// asks the backends the same question.
export function normalisePrompt(s: string) {
  return s
    .normalize('NFKD')
    .replace(MARKS, '')
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .slice(0, 80)
    .trim()
}

const searchable = (s: string) => s.split(' ').filter((w) => w && !STOP.has(w)).join(' ')

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

// Words that name one of the built-in forms. Anything else is a fresh abstract form.
const FORMS: Record<string, string> = {
  teapot: 'teapot', tea: 'teapot', kettle: 'teapot',
  donut: 'donut', doughnut: 'donut', torus: 'donut', ring: 'donut', bagel: 'donut',
  knot: 'knot', trefoil: 'knot', tangle: 'knot',
  crystal: 'crystal', gem: 'crystal', diamond: 'crystal', jewel: 'crystal', solid: 'crystal', dice: 'crystal', die: 'crystal',
  shell: 'shell', snail: 'shell', spiral: 'shell', nautilus: 'shell',
  klein: 'klein', bottle: 'klein',
  helix: 'helix', dna: 'helix', strand: 'helix', corkscrew: 'helix',
  asteroid: 'asteroid', rock: 'asteroid', stone: 'asteroid', moon: 'asteroid', meteor: 'asteroid', planet: 'asteroid',
  shape: 'supershape', star: 'supershape', flower: 'supershape', blob: 'supershape', cloud: 'supershape', alien: 'supershape',
}

const display = (text: string) => text.trim().replace(/\s+/g, ' ').slice(0, 48) || 'something'

function procedural(text: string, rng: Rng): PromptResult {
  const keys = normalisePrompt(text).split(' ')
  const named = keys.map((k) => FORMS[k]).find(Boolean)
  const item = LIBRARY.find((l) => l.id === named) ?? LIBRARY[Math.floor(rng() * LIBRARY.length) % LIBRARY.length]
  const seed = (hash(text) % 100000) + Math.floor(rng() * 1000) + 1
  const built = item.build(rng, seed)
  return {
    object: built.object,
    title: `“${display(text)}”`,
    detail: `procedural · ${built.title.toLowerCase()}`,
    twoSided: built.twoSided,
    flat: false,
    source: null,
  }
}

// Searched model, then searched drawing, then a built form. A normal word never leaves here
// without an object; only a blocked prompt stops the chain.
export async function fromPrompt(text: string, rng: Rng): Promise<PromptResult> {
  const verdict = checkTyped(text)
  if (!verdict.ok) throw new Error(REFUSAL)

  const query = searchable(normalisePrompt(text))
  if (query) {
    try {
      const model = await findModel(query)
      if (model) return model
    } catch {
      // the next backend gets a turn
    }
    try {
      const drawing = await findDrawing(query)
      if (drawing) {
        const object = svgObject(drawing.svg)
        if (object) {
          return {
            object,
            title: drawing.title,
            detail: `flat svg · ${drawing.licence}`,
            twoSided: true,
            flat: true,
            source: drawing.source,
          }
        }
      }
    } catch {
      // the drawing was malformed or gone
    }
  }
  try {
    return procedural(text, rng)
  } catch {
    return {
      object: new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshBasicMaterial()),
      title: `“${display(text)}”`,
      detail: 'procedural',
      flat: false,
      source: null,
    }
  }
}
