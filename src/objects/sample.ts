import { R, Rng } from '../engine/core'

// A triangle soup: every triangle stored on its own, already in the object's final space.
// Colour comes from vertex colours x material colour x texture, all resolved per sample.
export type TexSampler = (u: number, v: number, out: number[]) => void
export type Material = { color: [number, number, number]; tex: TexSampler | null }
export type Soup = {
  tris: number
  pos: Float32Array // tris * 9
  nrm: Float32Array // tris * 9, vertex normals (face normals when the mesh had none)
  uv: Float32Array | null // tris * 6
  vcol: Float32Array | null // tris * 9, linear rgb
  mat: Uint16Array // tris, index into mats
  mats: Material[]
  colored: boolean // false when every colour source is plain white
  weight?: Float32Array // tris; how much of its share of glyphs each triangle gets (default 1)
}

// A bare point cloud (a .ply scan, or a mesh with no faces)
export type Cloud = { n: number; pos: Float32Array; nrm: Float32Array | null; col: Float32Array | null }

export type Samples = {
  count: number
  pos: Float32Array
  nrm: Float32Array
  col: Float32Array | null
  spacing: number // mean distance between neighbouring samples
}

// Centre on the bounding box and scale so the farthest point sits at radius R
export function normalize(pos: Float32Array, radius = R) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2]
    if (x < x0) x0 = x; if (x > x1) x1 = x
    if (y < y0) y0 = y; if (y > y1) y1 = y
    if (z < z0) z0 = z; if (z > z1) z1 = z
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2
  let far = 0
  for (let i = 0; i < pos.length; i += 3) far = Math.max(far, (pos[i] - cx) ** 2 + (pos[i + 1] - cy) ** 2 + (pos[i + 2] - cz) ** 2)
  const s = far > 0 ? radius / Math.sqrt(far) : 1
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] = (pos[i] - cx) * s; pos[i + 1] = (pos[i + 1] - cy) * s; pos[i + 2] = (pos[i + 2] - cz) * s
  }
  return s
}

// Spreads 10 bits of n out to every third bit, for a Morton (Z-order) key
const part = (n: number) => {
  n &= 0x3ff
  n = (n | (n << 16)) & 0x30000ff
  n = (n | (n << 8)) & 0x300f00f
  n = (n | (n << 4)) & 0x30c30c3
  n = (n | (n << 2)) & 0x9249249
  return n
}

// Sort samples along a Z-order curve. Two objects sorted this way morph coherently: dot i of
// one lands near dot i of the other, so a change of object flows instead of scrambling.
export function mortonOrder(pos: Float32Array, n: number, radius = R): Uint32Array {
  const keys = new Uint32Array(n), q = (v: number) => Math.max(0, Math.min(1023, ((v / radius + 1) / 2) * 1023)) | 0
  for (let i = 0; i < n; i++) keys[i] = (part(q(pos[i * 3])) | (part(q(pos[i * 3 + 1])) << 1) | (part(q(pos[i * 3 + 2])) << 2)) >>> 0
  return Uint32Array.from({ length: n }, (_, i) => i).sort((a, b) => keys[a] - keys[b])
}

function permute(s: Samples, order: Uint32Array): Samples {
  const pos = new Float32Array(s.count * 3), nrm = new Float32Array(s.count * 3), col = s.col ? new Float32Array(s.count * 3) : null
  order.forEach((src, dst) => {
    pos.set(s.pos.subarray(src * 3, src * 3 + 3), dst * 3)
    nrm.set(s.nrm.subarray(src * 3, src * 3 + 3), dst * 3)
    if (col) col.set(s.col!.subarray(src * 3, src * 3 + 3), dst * 3)
  })
  return { ...s, pos, nrm, col }
}

// Dart throwing on a hash grid: walk the candidates in their (random) order and keep each one
// that has no kept neighbour closer than r. The result is an even, blue-noise spread, so glyphs
// tile the surface without clumping or leaving holes.
export function dart(cp: Float32Array, nc: number, r: number, max: number): number[] {
  const off = R * 1.05, cell = Math.max(r, (2 * off) / 127), dim = Math.ceil((2 * off) / cell) + 1
  const head = new Int32Array(dim * dim * dim).fill(-1), next = new Int32Array(nc).fill(-1)
  const r2 = r * r, out: number[] = []
  const ix = (v: number) => Math.max(0, Math.min(dim - 1, ((v + off) / cell) | 0))
  for (let k = 0; k < nc && out.length < max; k++) {
    const x = cp[k * 3], y = cp[k * 3 + 1], z = cp[k * 3 + 2]
    const cx = ix(x), cy = ix(y), cz = ix(z)
    let ok = true
    for (let a = Math.max(0, cx - 1); ok && a <= Math.min(dim - 1, cx + 1); a++)
      for (let b = Math.max(0, cy - 1); ok && b <= Math.min(dim - 1, cy + 1); b++)
        for (let c = Math.max(0, cz - 1); ok && c <= Math.min(dim - 1, cz + 1); c++)
          for (let j = head[(a * dim + b) * dim + c]; j >= 0; j = next[j]) {
            const dx = cp[j * 3] - x, dy = cp[j * 3 + 1] - y, dz = cp[j * 3 + 2] - z
            if (dx * dx + dy * dy + dz * dz < r2) { ok = false; break }
          }
    if (!ok) continue
    const h = (cx * dim + cy) * dim + cz
    next[k] = head[h]; head[h] = k; out.push(k)
  }
  return out
}

export function soupArea(s: Soup) {
  const cdf = new Float64Array(s.tris), P = s.pos
  let A = 0
  for (let t = 0; t < s.tris; t++) {
    const o = t * 9
    const ux = P[o + 3] - P[o], uy = P[o + 4] - P[o + 1], uz = P[o + 5] - P[o + 2]
    const vx = P[o + 6] - P[o], vy = P[o + 7] - P[o + 1], vz = P[o + 8] - P[o + 2]
    A += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) * (s.weight ? s.weight[t] : 1)
    cdf[t] = A
  }
  return { A, cdf }
}

export function sampleSoup(s: Soup, count: number, rng: Rng): Samples {
  const { A, cdf } = soupArea(s)
  const P = s.pos
  if (!(A > 0)) return sampleCloud({ n: s.tris * 3, pos: P, nrm: s.nrm, col: null }, count, rng)

  // area-weighted candidates, several per final sample, then thin them out evenly
  const nc = Math.min(200000, Math.max(30000, count * 7))
  const cp = new Float32Array(nc * 3), ct = new Uint32Array(nc), cb = new Float32Array(nc * 2)
  for (let k = 0; k < nc; k++) {
    const u = rng() * A
    let lo = 0, hi = s.tris - 1
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < u) lo = mid + 1; else hi = mid }
    const r1 = Math.sqrt(rng()), r2 = rng(), b = r1 * (1 - r2), c = r1 * r2, a = 1 - b - c, o = lo * 9
    for (let d = 0; d < 3; d++) cp[k * 3 + d] = a * P[o + d] + b * P[o + 3 + d] + c * P[o + 6 + d]
    ct[k] = lo; cb[k * 2] = b; cb[k * 2 + 1] = c
  }
  let r = 0.9 * Math.sqrt(A / count), kept: number[] = []
  for (let attempt = 0; attempt < 6; attempt++) {
    kept = dart(cp, nc, r, count)
    if (kept.length >= count * 0.985) break
    r *= 0.88
  }
  // top up from the leftovers if the surface could not take the full count evenly
  if (kept.length < count) {
    const used = new Uint8Array(nc)
    kept.forEach((k) => (used[k] = 1))
    for (let k = 0; k < nc && kept.length < count; k++) if (!used[k]) kept.push(k)
  }

  const n = kept.length
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = s.colored ? new Float32Array(n * 3) : null
  const tc = [1, 1, 1]
  kept.forEach((k, i) => {
    const t = ct[k], b = cb[k * 2], c = cb[k * 2 + 1], a = 1 - b - c, o = t * 9
    pos.set(cp.subarray(k * 3, k * 3 + 3), i * 3)
    let nx = a * s.nrm[o] + b * s.nrm[o + 3] + c * s.nrm[o + 6]
    let ny = a * s.nrm[o + 1] + b * s.nrm[o + 4] + c * s.nrm[o + 7]
    let nz = a * s.nrm[o + 2] + b * s.nrm[o + 5] + c * s.nrm[o + 8]
    const l = Math.hypot(nx, ny, nz) || 1
    nx /= l; ny /= l; nz /= l
    nrm[i * 3] = nx; nrm[i * 3 + 1] = ny; nrm[i * 3 + 2] = nz
    if (col) {
      const m = s.mats[s.mat[t]]
      let cr = m.color[0], cg = m.color[1], cbl = m.color[2]
      if (s.vcol) {
        cr *= a * s.vcol[o] + b * s.vcol[o + 3] + c * s.vcol[o + 6]
        cg *= a * s.vcol[o + 1] + b * s.vcol[o + 4] + c * s.vcol[o + 7]
        cbl *= a * s.vcol[o + 2] + b * s.vcol[o + 5] + c * s.vcol[o + 8]
      }
      if (m.tex && s.uv) {
        const q = t * 6
        m.tex(a * s.uv[q] + b * s.uv[q + 2] + c * s.uv[q + 4], a * s.uv[q + 1] + b * s.uv[q + 3] + c * s.uv[q + 5], tc)
        cr *= tc[0]; cg *= tc[1]; cbl *= tc[2]
      }
      col[i * 3] = cr; col[i * 3 + 1] = cg; col[i * 3 + 2] = cbl
    }
  })
  const out = { count: n, pos, nrm, col, spacing: Math.sqrt(A / Math.max(1, n)) }
  return permute(out, mortonOrder(pos, n))
}

// Smallest-eigenvalue eigenvector of a symmetric 3x3 matrix (cyclic Jacobi), i.e. the normal of
// the plane that best fits a neighbourhood of points
export function planeNormal(m: number[]): [number, number, number] {
  const a = [[m[0], m[1], m[2]], [m[1], m[3], m[4]], [m[2], m[4], m[5]]]
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  for (let sweep = 0; sweep < 12; sweep++) {
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-12) continue
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1))
      const c = 1 / Math.sqrt(t * t + 1), s = t * c
      for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y }
      for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y }
      for (let k = 0; k < 3; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = c * x - s * y; v[k][q] = s * x + c * y }
    }
  }
  const j = [0, 1, 2].reduce((b, i) => (a[i][i] < a[b][b] ? i : b), 0)
  return [v[0][j], v[1][j], v[2][j]]
}

// Normals for a scan that came without them: fit a plane to each point's neighbours on a hash
// grid, then turn it to face away from the centre
function cloudNormals(c: Cloud, picks: Uint32Array, n: number, spacing: number): Float32Array {
  const r = spacing * 2.2, off = R * 1.05, cell = Math.max(r, (2 * off) / 127), dim = Math.ceil((2 * off) / cell) + 1
  const ix = (x: number) => Math.max(0, Math.min(dim - 1, ((x + off) / cell) | 0))
  const head = new Int32Array(dim * dim * dim).fill(-1), next = new Int32Array(c.n)
  for (let k = 0; k < c.n; k++) { const h = (ix(c.pos[k * 3]) * dim + ix(c.pos[k * 3 + 1])) * dim + ix(c.pos[k * 3 + 2]); next[k] = head[h]; head[h] = k }
  const out = new Float32Array(n * 3), r2 = r * r
  for (let i = 0; i < n; i++) {
    const k0 = picks[i], x = c.pos[k0 * 3], y = c.pos[k0 * 3 + 1], z = c.pos[k0 * 3 + 2]
    const cx = ix(x), cy = ix(y), cz = ix(z)
    let cnt = 0, sx = 0, sy = 0, sz = 0, xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0
    for (let a = Math.max(0, cx - 1); a <= Math.min(dim - 1, cx + 1); a++)
      for (let b = Math.max(0, cy - 1); b <= Math.min(dim - 1, cy + 1); b++)
        for (let d = Math.max(0, cz - 1); d <= Math.min(dim - 1, cz + 1); d++)
          for (let k = head[(a * dim + b) * dim + d]; k >= 0 && cnt < 64; k = next[k]) {
            const px = c.pos[k * 3] - x, py = c.pos[k * 3 + 1] - y, pz = c.pos[k * 3 + 2] - z
            if (px * px + py * py + pz * pz > r2) continue
            cnt++; sx += px; sy += py; sz += pz
            xx += px * px; xy += px * py; xz += px * pz; yy += py * py; yz += py * pz; zz += pz * pz
          }
    let nx = x, ny = y, nz = z
    if (cnt >= 5) {
      const mx = sx / cnt, my = sy / cnt, mz = sz / cnt
      ;[nx, ny, nz] = planeNormal([xx / cnt - mx * mx, xy / cnt - mx * my, xz / cnt - mx * mz, yy / cnt - my * my, yz / cnt - my * mz, zz / cnt - mz * mz])
      if (nx * x + ny * y + nz * z < 0) { nx = -nx; ny = -ny; nz = -nz }
    }
    const l = Math.hypot(nx, ny, nz) || 1
    out[i * 3] = nx / l; out[i * 3 + 1] = ny / l; out[i * 3 + 2] = nz / l
  }
  return out
}

export function sampleCloud(c: Cloud, count: number, rng: Rng): Samples {
  const idx = Uint32Array.from({ length: c.n }, (_, i) => i)
  const n = Math.min(count, c.n)
  for (let i = 0; i < n; i++) { const j = i + ((rng() * (c.n - i)) | 0); const t = idx[i]; idx[i] = idx[j]; idx[j] = t }
  // a scan is a surface too; assume it covers about half a sphere's area
  const spacing = Math.sqrt((2 * Math.PI * R * R) / Math.max(1, n)), rawSpacing = Math.sqrt((2 * Math.PI * R * R) / Math.max(1, c.n))
  const pos = new Float32Array(n * 3), col = c.col ? new Float32Array(n * 3) : null
  let nrm = new Float32Array(n * 3)
  if (!c.nrm) nrm = cloudNormals(c, idx, n, Math.max(rawSpacing, spacing * 0.5))
  for (let i = 0; i < n; i++) {
    const k = idx[i]
    pos.set(c.pos.subarray(k * 3, k * 3 + 3), i * 3)
    if (c.nrm) {
      const src = c.nrm.subarray(k * 3, k * 3 + 3), l = Math.hypot(src[0], src[1], src[2]) || 1
      nrm.set([src[0] / l, src[1] / l, src[2] / l], i * 3)
    }
    if (col) col.set(c.col!.subarray(k * 3, k * 3 + 3), i * 3)
  }
  const out = { count: n, pos, nrm, col, spacing }
  return permute(out, mortonOrder(pos, n))
}
