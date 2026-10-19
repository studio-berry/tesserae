import * as THREE from 'three'
import { Cloud, Material, Soup, TexSampler, normalize } from './sample'

const SRGB = Float32Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
const LIN = Float32Array.from({ length: 256 }, (_, i) => i / 255)

// Reads a texture's pixels once (scaled down to 512 px) and samples it by uv, honouring the
// texture's transform, wrapping and flip, so textured models keep their colours.
const texSampler = (tex: THREE.Texture): TexSampler | null => {
  const img = tex.image as (CanvasImageSource & { width: number; height: number }) | undefined
  if (!img || !img.width || !img.height || 'data' in (img as object)) return null
  const k = Math.min(1, 512 / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k))
  let d: Uint8ClampedArray
  try {
    const cv = document.createElement('canvas')
    cv.width = w; cv.height = h
    const g = cv.getContext('2d', { willReadFrequently: true })!
    g.drawImage(img, 0, 0, w, h)
    d = g.getImageData(0, 0, w, h).data
  } catch {
    return null // a tainted or undecodable image: fall back to the material colour
  }
  tex.updateMatrix()
  const m = tex.matrix.elements, lut = tex.colorSpace === THREE.SRGBColorSpace ? SRGB : LIN, flip = tex.flipY
  return (u, v, out) => {
    let x = m[0] * u + m[3] * v + m[6], y = m[1] * u + m[4] * v + m[7]
    x -= Math.floor(x); y -= Math.floor(y)
    if (flip) y = 1 - y
    const o = (Math.min(h - 1, (y * h) | 0) * w + Math.min(w - 1, (x * w) | 0)) * 4
    out[0] = lut[d[o]]; out[1] = lut[d[o + 1]]; out[2] = lut[d[o + 2]]
  }
}

type Part = { geo: THREE.BufferGeometry; matrix: THREE.Matrix4; material: THREE.Material | THREE.Material[] }

// Flattens every mesh under root into one triangle soup in root's space; points become a cloud
export const soupFrom = (root: THREE.Object3D): { soup: Soup | null; cloud: Cloud | null } => {
  root.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const parts: Part[] = [], points: Part[] = []
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.geometry?.attributes?.position || o.visible === false) return
    const base = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)
    if ((o as THREE.Points).isPoints) points.push({ geo: m.geometry, matrix: base, material: m.material })
    else if ((o as THREE.InstancedMesh).isInstancedMesh) {
      const im = o as THREE.InstancedMesh, t = new THREE.Matrix4()
      for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, t); parts.push({ geo: m.geometry, matrix: base.clone().multiply(t), material: m.material }) }
    } else if (m.isMesh) parts.push({ geo: m.geometry, matrix: base, material: m.material })
  })

  // count triangles up front so the soup is allocated once
  let tris = 0
  for (const p of parts) tris += Math.floor((p.geo.index ? p.geo.index.count : p.geo.attributes.position.count) / 3)

  let soup: Soup | null = null
  if (tris > 0) {
    const anyUv = parts.some((p) => p.geo.attributes.uv), anyCol = parts.some((p) => p.geo.attributes.color)
    const pos = new Float32Array(tris * 9), nrm = new Float32Array(tris * 9)
    const uv = anyUv ? new Float32Array(tris * 6) : null, vcol = anyCol ? new Float32Array(tris * 9).fill(1) : null
    const mat = new Uint16Array(tris), mats: Material[] = [], matIndex = new Map<string, number>()
    const v = new THREE.Vector3(), nm = new THREE.Matrix3()
    let t = 0
    const materialId = (mtl: THREE.Material | undefined) => {
      if (!mtl) return 0
      let id = matIndex.get(mtl.uuid)
      if (id === undefined) {
        const any = mtl as THREE.MeshStandardMaterial
        const c = any.color ? [any.color.r, any.color.g, any.color.b] as [number, number, number] : [1, 1, 1] as [number, number, number]
        mats.push({ color: c, tex: any.map ? texSampler(any.map) : null })
        id = mats.length - 1
        matIndex.set(mtl.uuid, id)
      }
      return id
    }
    if (!parts.length) mats.push({ color: [1, 1, 1], tex: null })
    for (const p of parts) {
      const g = p.geo, P = g.attributes.position, Nn = g.attributes.normal, U = g.attributes.uv, Cc = g.attributes.color, I = g.index
      nm.getNormalMatrix(p.matrix)
      const total = I ? I.count : P.count
      const groups = g.groups.length ? g.groups : [{ start: 0, count: total, materialIndex: 0 }]
      for (const grp of groups) {
        const mtl = Array.isArray(p.material) ? p.material[grp.materialIndex ?? 0] : p.material
        const mid = materialId(mtl)
        const end = Math.min(total, grp.start + grp.count)
        for (let s = grp.start; s + 2 < end; s += 3, t++) {
          if (t >= tris) break
          mat[t] = mid
          for (let c = 0; c < 3; c++) {
            const vi = I ? I.getX(s + c) : s + c
            v.fromBufferAttribute(P, vi).applyMatrix4(p.matrix)
            pos[t * 9 + c * 3] = v.x; pos[t * 9 + c * 3 + 1] = v.y; pos[t * 9 + c * 3 + 2] = v.z
            if (Nn) {
              v.fromBufferAttribute(Nn, vi).applyMatrix3(nm).normalize()
              nrm[t * 9 + c * 3] = v.x; nrm[t * 9 + c * 3 + 1] = v.y; nrm[t * 9 + c * 3 + 2] = v.z
            }
            if (uv && U) { uv[t * 6 + c * 2] = U.getX(vi); uv[t * 6 + c * 2 + 1] = U.getY(vi) }
            if (vcol && Cc) { vcol[t * 9 + c * 3] = Cc.getX(vi); vcol[t * 9 + c * 3 + 1] = Cc.getY(vi); vcol[t * 9 + c * 3 + 2] = Cc.getZ(vi) }
          }
          if (!Nn) faceNormal(pos, nrm, t)
        }
      }
    }
    const white = (c: number[]) => c[0] > 0.98 && c[1] > 0.98 && c[2] > 0.98
    const colored = !!vcol || mats.some((m) => m.tex || !white(m.color))
    soup = { tris: t, pos, nrm, uv, vcol, mat, mats, colored }
  }

  let cloud: Cloud | null = null
  const pn = points.reduce((a, p) => a + p.geo.attributes.position.count, 0)
  if (pn > 0) {
    const pos = new Float32Array(pn * 3)
    const hasN = points.every((p) => p.geo.attributes.normal), hasC = points.some((p) => p.geo.attributes.color)
    const nrm = hasN ? new Float32Array(pn * 3) : null, col = hasC ? new Float32Array(pn * 3).fill(1) : null
    const v = new THREE.Vector3(), nm = new THREE.Matrix3()
    let k = 0
    for (const p of points) {
      const P = p.geo.attributes.position, Nn = p.geo.attributes.normal, Cc = p.geo.attributes.color
      nm.getNormalMatrix(p.matrix)
      for (let i = 0; i < P.count; i++, k++) {
        v.fromBufferAttribute(P, i).applyMatrix4(p.matrix); pos.set([v.x, v.y, v.z], k * 3)
        if (nrm && Nn) { v.fromBufferAttribute(Nn, i).applyMatrix3(nm).normalize(); nrm.set([v.x, v.y, v.z], k * 3) }
        if (col && Cc) col.set([Cc.getX(i), Cc.getY(i), Cc.getZ(i)], k * 3)
      }
    }
    cloud = { n: pn, pos, nrm, col }
  }
  return { soup, cloud }
}

// What every caller needs after flattening: centred on the origin, farthest point at radius R
export const surfaceFrom = (root: THREE.Object3D) => {
  const { soup, cloud } = soupFrom(root)
  if (soup && soup.tris > 0) {
    normalize(soup.pos)
    return { soup, cloud: null }
  }
  if (cloud && cloud.n > 0) {
    normalize(cloud.pos)
    return { soup: null, cloud }
  }
  return { soup: null, cloud: null }
}

// Type is read from the front: its faces get the full share of glyphs, the side walls (which
// hold most of the area but are seen edge-on) a quarter, and the back none
export const frontWeighted = (s: Soup): Soup => {
  const weight = new Float32Array(s.tris)
  for (let t = 0; t < s.tris; t++) {
    const nz = (s.nrm[t * 9 + 2] + s.nrm[t * 9 + 5] + s.nrm[t * 9 + 8]) / 3
    weight[t] = nz > 0.7 ? 1 : nz < -0.7 ? 0 : 0.25
  }
  return { ...s, weight }
}

const faceNormal = (pos: Float32Array, nrm: Float32Array, t: number) => {
  const o = t * 9
  const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2]
  const vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2]
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
  const l = Math.hypot(nx, ny, nz) || 1
  nx /= l; ny /= l; nz /= l
  for (let c = 0; c < 3; c++) { nrm[o + c * 3] = nx; nrm[o + c * 3 + 1] = ny; nrm[o + c * 3 + 2] = nz }
}
