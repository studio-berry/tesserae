import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// SVG y grows down, three y grows up; the mesh is scaled at the end instead of every point
type Affine = readonly [number, number, number, number, number, number]

const ONE: Affine = [1, 0, 0, 1, 0, 0]
const KAPPA = 0.5522847498
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline'])
// containers whose children are definitions or labels, never geometry to draw on their own
const HIDDEN = new Set(['defs', 'clippath', 'mask', 'symbol', 'pattern', 'marker', 'metadata', 'title', 'desc', 'style', 'script', 'text', 'image', 'use'])

const mul = (a: Affine, b: Affine): Affine => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
]

const at = (m: Affine, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

const nums = (s: string) => (s.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? []).map(Number)

// sticky, so a long path does not slice the string on every number
const NUMBER = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/y

const number = (v: string | undefined, fallback = 0) => {
  const n = parseFloat(v ?? '')
  return Number.isFinite(n) ? n : fallback
}

function transform(text: string | undefined): Affine {
  if (!text) return ONE
  let m: Affine = ONE
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g
  let hit: RegExpExecArray | null
  while ((hit = re.exec(text))) {
    const a = nums(hit[2])
    let t: Affine = ONE
    if (hit[1] === 'matrix' && a.length >= 6) t = [a[0], a[1], a[2], a[3], a[4], a[5]]
    else if (hit[1] === 'translate' && a.length) t = [1, 0, 0, 1, a[0], a[1] ?? 0]
    else if (hit[1] === 'scale' && a.length) t = [a[0], 0, 0, a[1] ?? a[0], 0, 0]
    else if (hit[1] === 'rotate' && a.length) {
      const r = (a[0] * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r)
      t = [c, s, -s, c, 0, 0]
      if (a.length >= 3) t = mul(mul([1, 0, 0, 1, a[1], a[2]], t), [1, 0, 0, 1, -a[1], -a[2]])
    } else if (hit[1] === 'skewX' && a.length) t = [1, 0, Math.tan((a[0] * Math.PI) / 180), 1, 0, 0]
    else if (hit[1] === 'skewY' && a.length) t = [1, Math.tan((a[0] * Math.PI) / 180), 0, 1, 0, 0]
    m = mul(m, t)
  }
  return m
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole
    }
    return NAMED[e.toLowerCase()] ?? whole
  })

function attributes(text: string) {
  const out: Record<string, string> = {}
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let hit: RegExpExecArray | null
  while ((hit = re.exec(text))) out[hit[1].toLowerCase()] = decode(hit[2] ?? hit[3] ?? '')
  return out
}

type Paint = { fill: string; skip: boolean }

function paint(attrs: Record<string, string>, parent: Paint): Paint {
  let fill = attrs.fill ?? parent.fill
  let skip = parent.skip
  const style = attrs.style
  if (style) {
    for (const part of style.split(';')) {
      const cut = part.indexOf(':')
      if (cut < 0) continue
      const key = part.slice(0, cut).trim().toLowerCase(), value = part.slice(cut + 1).trim()
      if (key === 'fill') fill = value
      else if (key === 'display' && value === 'none') skip = true
      else if (key === 'visibility' && value === 'hidden') skip = true
      else if (key === 'opacity' && parseFloat(value) === 0) skip = true
    }
  }
  if (attrs.display === 'none' || attrs.visibility === 'hidden' || parseFloat(attrs.opacity ?? '') === 0) skip = true
  fill = fill.toLowerCase()
  return { fill: fill === 'none' || fill === 'transparent' ? 'none' : fill, skip }
}

type Sink = {
  move: (x: number, y: number) => void
  line: (x: number, y: number) => void
  quad: (cx: number, cy: number, x: number, y: number) => void
  cubic: (a: number, b: number, c: number, d: number, x: number, y: number) => void
  close: () => void
}

function sink(path: THREE.ShapePath, m: Affine): Sink {
  return {
    move(x, y) { const [X, Y] = at(m, x, y); path.moveTo(X, Y) },
    line(x, y) { const [X, Y] = at(m, x, y); path.lineTo(X, Y) },
    quad(cx, cy, x, y) {
      const [A, B] = at(m, cx, cy), [X, Y] = at(m, x, y)
      path.quadraticCurveTo(A, B, X, Y)
    },
    cubic(a, b, c, d, x, y) {
      const [A, B] = at(m, a, b), [C, D] = at(m, c, d), [X, Y] = at(m, x, y)
      path.bezierCurveTo(A, B, C, D, X, Y)
    },
    close() {
      const current = path.currentPath
      if (current?.curves.length) current.closePath()
    },
  }
}

// Three's own SVG parser needs a DOM. Icons only use this small command set, so read it directly
// and keep the module usable in node tests as well as the page.
function drawPath(d: string, out: Sink) {
  let i = 0, cmd = '', prev = ''
  let x = 0, y = 0, sx = 0, sy = 0, qx = 0, qy = 0, cx2 = 0, cy2 = 0
  let open = false

  const skip = () => {
    while (i < d.length && (d[i] === ' ' || d[i] === ',' || d[i] === '\n' || d[i] === '\r' || d[i] === '\t')) i++
  }
  const num = () => {
    skip()
    NUMBER.lastIndex = i
    const hit = NUMBER.exec(d)
    if (!hit) return null
    i = NUMBER.lastIndex
    return parseFloat(hit[0])
  }
  const flag = () => {
    skip()
    const c = d[i]
    if (c !== '0' && c !== '1') return null
    i++
    return c === '1'
  }
  const begin = () => { if (!open) { out.move(x, y); open = true } }
  const end = () => { if (open) { out.close(); open = false } }

  while (i < d.length) {
    skip()
    if (i >= d.length) break
    const c = d[i]
    if (/[a-zA-Z]/.test(c)) { cmd = c; i++ }
    else if (!cmd) break
    if (cmd === 'Z' || cmd === 'z') {
      end()
      x = sx; y = sy; prev = 'Z'; cmd = ''
      continue
    }
    const rel = cmd === cmd.toLowerCase()
    const ox = rel ? x : 0, oy = rel ? y : 0

    switch (cmd) {
      case 'M': case 'm': {
        const nx = num(), ny = num()
        if (nx === null || ny === null) { i = d.length; break }
        end()
        x = ox + nx; y = oy + ny; sx = x; sy = y
        out.move(x, y); open = true
        cmd = rel ? 'l' : 'L'
        break
      }
      case 'L': case 'l': {
        const nx = num(), ny = num()
        if (nx === null || ny === null) { i = d.length; break }
        if (!open) begin()
        x = ox + nx; y = oy + ny; out.line(x, y)
        break
      }
      case 'H': case 'h': {
        const nx = num()
        if (nx === null) { i = d.length; break }
        if (!open) begin()
        x = ox + nx; out.line(x, y)
        break
      }
      case 'V': case 'v': {
        const ny = num()
        if (ny === null) { i = d.length; break }
        if (!open) begin()
        y = oy + ny; out.line(x, y)
        break
      }
      case 'C': case 'c': {
        const a = num(), b = num(), c1 = num(), d1 = num(), nx = num(), ny = num()
        if (a === null || b === null || c1 === null || d1 === null || nx === null || ny === null) { i = d.length; break }
        if (!open) begin()
        const A = ox + a, B = oy + b, C = ox + c1, D = oy + d1
        x = ox + nx; y = oy + ny
        out.cubic(A, B, C, D, x, y)
        cx2 = C; cy2 = D
        break
      }
      case 'S': case 's': {
        const c1 = num(), d1 = num(), nx = num(), ny = num()
        if (c1 === null || d1 === null || nx === null || ny === null) { i = d.length; break }
        if (!open) begin()
        const A = /[CcSs]/.test(prev) ? 2 * x - cx2 : x, B = /[CcSs]/.test(prev) ? 2 * y - cy2 : y
        const C = ox + c1, D = oy + d1
        x = ox + nx; y = oy + ny
        out.cubic(A, B, C, D, x, y)
        cx2 = C; cy2 = D
        break
      }
      case 'Q': case 'q': {
        const a = num(), b = num(), nx = num(), ny = num()
        if (a === null || b === null || nx === null || ny === null) { i = d.length; break }
        if (!open) begin()
        qx = ox + a; qy = oy + b
        x = ox + nx; y = oy + ny
        out.quad(qx, qy, x, y)
        break
      }
      case 'T': case 't': {
        const nx = num(), ny = num()
        if (nx === null || ny === null) { i = d.length; break }
        if (!open) begin()
        if (/[QqTt]/.test(prev)) { qx = 2 * x - qx; qy = 2 * y - qy }
        else { qx = x; qy = y }
        x = ox + nx; y = oy + ny
        out.quad(qx, qy, x, y)
        break
      }
      case 'A': case 'a': {
        const rx = num(), ry = num(), rot = num(), large = flag(), sweep = flag(), nx = num(), ny = num()
        if (rx === null || ry === null || rot === null || large === null || sweep === null || nx === null || ny === null) { i = d.length; break }
        if (!open) begin()
        const ex = ox + nx, ey = oy + ny
        arc(out, x, y, Math.abs(rx), Math.abs(ry), (rot * Math.PI) / 180, large, sweep, ex, ey)
        x = ex; y = ey
        break
      }
      default:
        i = d.length
        break
    }
    prev = cmd
  }
  end()
}

function arc(out: Sink, x1: number, y1: number, rx: number, ry: number, phi: number, large: boolean, sweep: boolean, x2: number, y2: number) {
  if (x1 === x2 && y1 === y2) return
  if (!rx || !ry) { out.line(x2, y2); return }
  const cs = Math.cos(phi), sn = Math.sin(phi)
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2
  const xp = cs * dx + sn * dy, yp = -sn * dx + cs * dy
  let rx2 = rx * rx, ry2 = ry * ry
  const grow = (xp * xp) / rx2 + (yp * yp) / ry2
  if (grow > 1) {
    const k = Math.sqrt(grow)
    rx *= k; ry *= k; rx2 = rx * rx; ry2 = ry * ry
  }
  const top = Math.max(0, rx2 * ry2 - rx2 * yp * yp - ry2 * xp * xp)
  const den = rx2 * yp * yp + ry2 * xp * xp
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(den ? top / den : 0)
  const cxp = (factor * (rx * yp)) / ry
  const cyp = (factor * (-ry * xp)) / rx
  const cx = cs * cxp - sn * cyp + (x1 + x2) / 2
  const cy = sn * cxp + cs * cyp + (y1 + y2) / 2
  const ux = (xp - cxp) / rx, uy = (yp - cyp) / ry
  const vx = (-xp - cxp) / rx, vy = (-yp - cyp) / ry
  const first = Math.atan2(uy, ux)
  let turn = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  if (!sweep && turn > 0) turn -= Math.PI * 2
  if (sweep && turn < 0) turn += Math.PI * 2
  const steps = Math.max(1, Math.ceil(Math.abs(turn) / (Math.PI / 2)))
  const step = turn / steps
  const point = (a: number): [number, number] => [
    cx + cs * rx * Math.cos(a) - sn * ry * Math.sin(a),
    cy + sn * rx * Math.cos(a) + cs * ry * Math.sin(a),
  ]
  const slope = (a: number): [number, number] => [
    -cs * rx * Math.sin(a) - sn * ry * Math.cos(a),
    -sn * rx * Math.sin(a) + cs * ry * Math.cos(a),
  ]
  for (let k = 0; k < steps; k++) {
    const a = first + k * step, b = a + step
    const p1 = point(a), p2 = point(b), d1 = slope(a), d2 = slope(b)
    const kk = (4 / 3) * Math.tan((b - a) / 4)
    out.cubic(p1[0] + kk * d1[0], p1[1] + kk * d1[1], p2[0] - kk * d2[0], p2[1] - kk * d2[1], p2[0], p2[1])
  }
}

function drawShape(name: string, attrs: Record<string, string>, path: THREE.ShapePath, m: Affine) {
  const out = sink(path, m)
  if (name === 'path') {
    if (attrs.d) drawPath(attrs.d, out)
    return
  }
  if (name === 'rect') {
    const x = number(attrs.x), y = number(attrs.y), w = number(attrs.width), h = number(attrs.height)
    if (!(w > 0) || !(h > 0)) return
    const rx = Math.min(w / 2, Math.abs(number(attrs.rx ?? attrs.ry))), ry = Math.min(h / 2, Math.abs(number(attrs.ry ?? attrs.rx)))
    if (!rx || !ry) {
      out.move(x, y); out.line(x + w, y); out.line(x + w, y + h); out.line(x, y + h); out.close()
    } else {
      out.move(x + rx, y)
      out.line(x + w - rx, y); out.quad(x + w, y, x + w, y + ry)
      out.line(x + w, y + h - ry); out.quad(x + w, y + h, x + w - rx, y + h)
      out.line(x + rx, y + h); out.quad(x, y + h, x, y + h - ry)
      out.line(x, y + ry); out.quad(x, y, x + rx, y)
      out.close()
    }
    return
  }
  if (name === 'circle' || name === 'ellipse') {
    const cx = number(attrs.cx), cy = number(attrs.cy)
    const rx = Math.abs(number(name === 'circle' ? attrs.r : attrs.rx))
    const ry = Math.abs(number(name === 'circle' ? attrs.r : attrs.ry))
    if (!(rx > 0) || !(ry > 0)) return
    const kx = rx * KAPPA, ky = ry * KAPPA
    out.move(cx + rx, cy)
    out.cubic(cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry)
    out.cubic(cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy)
    out.cubic(cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry)
    out.cubic(cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy)
    out.close()
    return
  }
  const p = nums(attrs.points ?? '')
  if (p.length < 4) return
  out.move(p[0], p[1])
  for (let k = 2; k + 1 < p.length; k += 2) out.line(p[k], p[k + 1])
  out.close()
}

function area(geo: THREE.BufferGeometry) {
  const p = geo.getAttribute('position'), index = geo.getIndex()
  const n = index ? index.count : p.count
  let sum = 0
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  for (let i = 0; i + 2 < n; i += 3) {
    const ia = index ? index.getX(i) : i, ib = index ? index.getX(i + 1) : i + 1, ic = index ? index.getX(i + 2) : i + 2
    a.fromBufferAttribute(p, ia); b.fromBufferAttribute(p, ib); c.fromBufferAttribute(p, ic)
    sum += b.sub(a).cross(c.sub(a)).length() / 2
  }
  return sum
}

// The runs whose tags are not drawn: comments, CDATA and scripts. One pass of removal can join the
// halves around a removed run into a new opener (`<!-<!-- x -->- y -->`), so the removal repeats
// until nothing changes. A run left open eats the rest of the file, the way a parser would read it,
// and a closing script tag may carry anything before its `>` (`</script foo>`), as a browser allows.
const HIDDEN_RUNS = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<script\b[\s\S]*?(?:<\/script\b[^>]*>|$)/gi

const unhidden = (text: string) => {
  let body = text
  for (let before = ''; before !== body; ) {
    before = body
    body = body.replace(HIDDEN_RUNS, ' ')
  }
  return body
}

export function svgObject(text: string): THREE.Object3D | null {
  if (text.length > 2_000_000) return null
  const body = unhidden(text)
  const shapePath = new THREE.ShapePath()
  const stack: { paint: Paint; matrix: Affine }[] = []
  let now = { paint: { fill: '#000', skip: false } as Paint, matrix: ONE }
  let count = 0

  const re = /<\s*(\/?)\s*([a-zA-Z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)\s*(\/?)\s*>/g
  let hit: RegExpExecArray | null
  while ((hit = re.exec(body))) {
    const closing = hit[1] === '/'
    const name = hit[2].toLowerCase()
    if (closing) {
      now = stack.pop() ?? now
      continue
    }
    const attrs = attributes(hit[3] ?? '')
    const own = paint(attrs, now.paint)
    own.skip = own.skip || HIDDEN.has(name)
    const matrix = mul(now.matrix, transform(attrs.transform))
    if (!own.skip && SHAPES.has(name) && own.fill !== 'none' && count < 500) {
      drawShape(name, attrs, shapePath, matrix)
      count++
    }
    if (hit[4] !== '/') {
      stack.push(now)
      now = { paint: own, matrix }
    }
  }

  const shapes = shapePath.toShapes(false)
  const geos: THREE.BufferGeometry[] = []
  let tris = 0
  for (const s of shapes) {
    const g = new THREE.ShapeGeometry(s, 8)
    const p = g.getAttribute('position')
    if (!p || p.count < 3) { g.dispose(); continue }
    tris += p.count / 3
    if (tris > 200_000) { g.dispose(); geos.forEach((x) => x.dispose()); return null }
    geos.push(g)
  }
  if (!geos.length) return null
  const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos)
  if (!geo) { geos.forEach((g) => g.dispose()); return null }
  if (geos.length > 1) geos.forEach((g) => g.dispose())
  geo.scale(1, -1, 1)
  geo.computeVertexNormals()
  geo.computeBoundingBox()
  const box = geo.boundingBox!
  const w = box.max.x - box.min.x, h = box.max.y - box.min.y
  if (!(w > 0) || !(h > 0) || !(area(geo) > Math.max(w * h, 1e-9) * 1e-4)) {
    geo.dispose()
    return null
  }
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial())
}
