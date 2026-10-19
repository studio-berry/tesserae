import * as THREE from 'three'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import { Font, FontData, FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'

let font: Font | null = null

// Long phrases wrap onto lines of about ten characters, so the type stays big enough to read in glyphs
export const wrap = (text: string, width = 10) => {
  const words = text.trim().split(/\s+/), lines: string[] = []
  for (const w of words) {
    const last = lines[lines.length - 1]
    if (last !== undefined && (last + ' ' + w).length <= width) lines[lines.length - 1] = last + ' ' + w
    else lines.push(w)
  }
  return lines.join('\n')
}

// Extruded, bevelled type; the font loads on first use so it stays out of the initial bundle
export const textObject = async (text: string) => {
  if (!font) {
    const json = (await import('three/examples/fonts/helvetiker_bold.typeface.json')).default
    font = new FontLoader().parse(json as unknown as FontData)
  }
  const g = new TextGeometry(wrap(text), {
    font, size: 1, depth: 0.12, curveSegments: 10,
    bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.018, bevelSegments: 2,
  })
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial())
}
