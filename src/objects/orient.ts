import * as THREE from 'three'

// A model has to meet the style contract before it is sampled: Y up, and its front facing +Z.
//
// glTF says Y is up, and the Hub's models are glTF, so most of them already stand. But a model
// uploaded to Sketchfab can be authored any way up, and a sample of sixty models taken from the
// collection the app would ship found plenty that are not.
//
// The correction has to come from the geometry alone, because nothing else knows which way a
// model should face. What the geometry can say is where a model's flat base is: an object that
// stands has a flat face underneath it, and an object lying on its side has that flat face
// sideways.
//
// The correction is therefore a search over the ways a model can be stood up, scored by how flat
// its bottom is. It is deliberately conservative: a model whose bottom is already flat is left
// alone, because a model that is already standing must not be turned. A wrong turn reads worse
// than the original.

export type Orientation = {
  // the rotation that brings the model into the contract, as a quaternion
  quaternion: THREE.Quaternion
  // how sure the model is, from 0 (no idea, leave it alone) to 1 (a clear flat base)
  confidence: number
}

// The identity rotation, which is also the answer when nothing can be read.
const IDENTITY = new THREE.Quaternion()

// The bounds of a point set and the spread of its mass about the middle of those bounds.
export type Extents = {
  min: THREE.Vector3
  max: THREE.Vector3
  centre: THREE.Vector3
  radius: number
}

export const extentsOf = (positions: ArrayLike<number>): Extents => {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity)
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
  const n = positions.length / 3
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2]
    if (x < min.x) min.x = x
    if (y < min.y) min.y = y
    if (z < min.z) min.z = z
    if (x > max.x) max.x = x
    if (y > max.y) max.y = y
    if (z > max.z) max.z = z
  }
  if (!n) return { min, max, centre: new THREE.Vector3(), radius: 0 }
  const centre = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5)
  let radius = 0
  for (let i = 0; i < n; i++) {
    const dx = positions[i * 3] - centre.x, dy = positions[i * 3 + 1] - centre.y, dz = positions[i * 3 + 2] - centre.z
    radius = Math.max(radius, dx * dx + dy * dy + dz * dz)
  }
  return { min, max, centre, radius: Math.sqrt(radius) }
}

// The eigenvector of the largest eigenvalue of a symmetric 3x3, by power iteration.
//
// The matrix is deflated between the axes so each one is found in turn. The deflation subtracts
// the found eigenvalue along its own direction rather than zeroing the diagonal, which keeps the
// remaining eigenvectors correct; a power iteration that starts from a vector close to the
// direction it is looking for converges on it.
export const principalAxes = (positions: ArrayLike<number>, centre: THREE.Vector3) => {
  const c = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  const n = positions.length / 3
  for (let i = 0; i < n; i++) {
    const d = [positions[i * 3] - centre.x, positions[i * 3 + 1] - centre.y, positions[i * 3 + 2] - centre.z]
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) c[a][b] += d[a] * d[b]
  }
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) c[a][b] /= Math.max(1, n)

  const apply = (m: number[][], v: THREE.Vector3) =>
    new THREE.Vector3(
      m[0][0] * v.x + m[0][1] * v.y + m[0][2] * v.z,
      m[1][0] * v.x + m[1][1] * v.y + m[1][2] * v.z,
      m[2][0] * v.x + m[2][1] * v.y + m[2][2] * v.z,
    )

  // the largest eigenvector, found from a start that is not along any axis
  const eigen = (m: number[][]) => {
    let v = new THREE.Vector3(0.577, 0.577, 0.577)
    for (let i = 0; i < 64; i++) {
      const w = apply(m, v)
      if (w.lengthSq() < 1e-20) break
      v = w.normalize()
    }
    const lambda = v.dot(apply(m, v))
    return { vector: v, value: lambda }
  }

  const first = eigen(c)
  const long = first.vector
  // the matrix with the first direction removed
  const deflated = c.map((row, i) =>
    row.map((v, j) => v - first.value * long.getComponent(i) * long.getComponent(j)),
  )
  const second = eigen(deflated)
  const mid = second.vector.clone()
  // the third is what is left, and it has to be perpendicular to the first two
  const short = new THREE.Vector3().crossVectors(long, mid).normalize()
  // the middle axis has to be perpendicular to the first as well
  const cleanMid = new THREE.Vector3().crossVectors(short, long).normalize()
  return [long, cleanMid, short]
}

// The rotation that carries one direction onto another, and the twist about it.
//
// A model has to be turned so its own up becomes the world up, and then spun about that up so
// its own front faces the viewer. The twist is the part that needs the model's own axes, and
// it is what lets a model authored at an angle be read.
export const alignUp = (up: THREE.Vector3) => {
  const from = new THREE.Vector3(0, 1, 0)
  const axis = new THREE.Vector3().crossVectors(from, up)
  const angle = Math.acos(Math.min(1, Math.max(-1, from.dot(up))))
  if (axis.lengthSq() < 1e-12) {
    // the model's up is already the world up, or exactly opposite it
    return up.y > 0 ? new THREE.Quaternion() : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI)
  }
  return new THREE.Quaternion().setFromAxisAngle(axis.normalize(), angle)
}

// The rotation that carries the model's own front onto the world front, about the world up.
//
// It is a spin about the world up, chosen so the model's front ends up pointing at the viewer.
export const alignFront = (front: THREE.Vector3) => {
  const world = new THREE.Vector3(0, 0, 1)
  const from = front.clone().projectOnPlane(new THREE.Vector3(0, 1, 0))
  const to = world.clone().projectOnPlane(new THREE.Vector3(0, 1, 0))
  if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) return new THREE.Quaternion()
  from.normalize()
  to.normalize()
  const axis = new THREE.Vector3().crossVectors(from, to)
  const angle = Math.acos(Math.min(1, Math.max(-1, from.dot(to))))
  if (axis.lengthSq() < 1e-12) return new THREE.Quaternion()
  return new THREE.Quaternion().setFromAxisAngle(axis.normalize(), angle)
}

// How flat the bottom of a model is under a given rotation.
//
// The bottom is the band of points just above the lowest one. A model that stands on a flat base
// has those points all at the same height, so their spread is near zero. A ball has them spread
// across a curve, so the spread is large.
//
// Two things have to hold for a bottom to read as a base. The points in the band have to be level
// with each other, and they have to cover a real part of the model. The second test matters: the
// bottom of a ball is a tiny cap, and although a sphere's lowest ring sits at one height, that
// ring is a point rather than a face, so the ball must not read as standing on a base.
export const bottomFlatness = (positions: ArrayLike<number>, q: THREE.Quaternion) => {
  const n = positions.length / 3
  if (n < 12) return 0
  const v = new THREE.Vector3()
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < n; i++) {
    v.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]).applyQuaternion(q)
    if (v.y < lo) lo = v.y
    if (v.y > hi) hi = v.y
  }
  const span = hi - lo
  if (span <= 1e-9) return 0
  const band = span * 0.06
  let count = 0, sum = 0, sumSq = 0
  let cx = 0, cz = 0
  for (let i = 0; i < n; i++) {
    v.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]).applyQuaternion(q)
    if (v.y > lo + band) continue
    count++
    sum += v.y
    sumSq += v.y * v.y
    cx += v.x
    cz += v.z
  }
  if (count < 4) return 0
  const mean = sum / count
  const variance = Math.max(0, sumSq / count - mean * mean)
  const spread = Math.sqrt(variance)
  // the flatness of the band
  const flat = 1 - Math.min(1, spread / (band * 0.5))

  // how much of the model's width the band covers, which tells a face from a point
  cx /= count
  cz /= count
  let bandWide = 0, modelWide = 0
  for (let i = 0; i < n; i++) {
    v.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]).applyQuaternion(q)
    const r = Math.hypot(v.x, v.z)
    if (r > modelWide) modelWide = r
    if (v.y <= lo + band) {
      const d = Math.hypot(v.x - cx, v.z - cz)
      if (d > bandWide) bandWide = d
    }
  }
  if (modelWide <= 1e-9) return 0
  const share = Math.min(1, bandWide / modelWide)
  return flat * share
}

// How turned the model is under a given rotation, measured by how tall it stands.
//
// A model that stands is taller than it is wide. The score is the height over the wider of its
// other two axes, from 0 (flat on the ground) upwards.
export const standing = (positions: ArrayLike<number>, q: THREE.Quaternion) => {
  const n = positions.length / 3
  if (n < 12) return 0
  const v = new THREE.Vector3()
  const min = new THREE.Vector3(Infinity, Infinity, Infinity)
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
  for (let i = 0; i < n; i++) {
    v.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]).applyQuaternion(q)
    if (v.x < min.x) min.x = v.x
    if (v.y < min.y) min.y = v.y
    if (v.z < min.z) min.z = v.z
    if (v.x > max.x) max.x = v.x
    if (v.y > max.y) max.y = v.y
    if (v.z > max.z) max.z = v.z
  }
  const h = max.y - min.y
  const w = Math.max(max.x - min.x, max.z - min.z)
  if (w <= 1e-9) return 0
  return h / w
}

// How the model is turned to meet the contract.
//
// Every way of standing the model up is tried: the world's own axes, and the model's own
// principal axes. For each, the model is turned so that axis points up, and then spun so the
// model's broad face towards the viewer.
//
// Two things are measured. How tall the model stands is the stronger signal: a bottle that
// happens to be lying down is still a bottle, and standing it up makes it read as one. How flat
// its bottom is is the weaker signal, because a round-bottomed object such as a bottle has no
// flat base at all, and its height says more than its base does.
//
// The model as it stands wins when it is good enough, so a model that already stands is never
// turned. A model that reads no way up is left alone: there is nothing to read, and a wrong turn
// reads worse than the original.
export const orient = (positions: ArrayLike<number>): Orientation => {
  const n = positions.length / 3
  if (n < 12) return { quaternion: IDENTITY.clone(), confidence: 0 }
  const { centre } = extentsOf(positions)
  const own = principalAxes(positions, centre)

  // the model as it stands
  const asIs = { q: IDENTITY.clone(), flat: bottomFlatness(positions, IDENTITY), stand: standing(positions, IDENTITY) }
  let best = asIs

  // a reading is better than another when it stands the model more upright, or when it stands
  // it just as upright but on a flatter base. The tolerance keeps a model that is already
  // upright from being turned for the sake of a fraction of a millimetre.
  const better = (a: { flat: number; stand: number }, b: { flat: number; stand: number }) =>
    a.stand > b.stand + 0.01 || (Math.abs(a.stand - b.stand) <= 0.01 && a.flat > b.flat + 0.01)

  const consider = (up: THREE.Vector3, front: THREE.Vector3) => {
    const lift = alignUp(up)
    const twist = alignFront(front.clone().applyQuaternion(lift))
    const q = twist.multiply(lift)
    const stand = standing(positions, q)
    // a rotation that lays the model flat is not a reading of how it stands
    if (stand < 0.75) return
    const flat = bottomFlatness(positions, q)
    if (better({ flat, stand }, best)) best = { q, flat, stand }
  }

  // the world's axes, then the model's own. The model as it stands is one of the readings.
  const world = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]
  for (const up of world) for (const front of world) if (!front.equals(up)) consider(up, front)
  for (const up of own) for (const front of own) if (!front.equals(up)) consider(up, front)

  // the model as it stands wins when it is just as good, so a model that already stands is
  // never turned for the sake of a fraction of a millimetre
  const chosen = better(asIs, best) ? asIs : best

  // a model that was not turned has no confidence to report: there was nothing to correct, and
  // a rotation of a quarter turn on a model that is already upright is a change, not a fix
  if (chosen.q.angleTo(IDENTITY) < 0.01) return { quaternion: IDENTITY.clone(), confidence: 0 }

  // the confidence is how well the chosen reading stands the model: a model that was plainly
  // lying down and is now plainly standing is a sure read
  if (chosen.stand < 1.0) return { quaternion: IDENTITY.clone(), confidence: 0 }
  const confidence = Math.max(0, Math.min(1, (chosen.stand - 0.75) / 0.4))
  return { quaternion: chosen.q.clone(), confidence }
}

// Applies an orientation to a model, in place.
export const applyOrientation = (root: THREE.Object3D, o: Orientation) => {
  if (o.confidence <= 0) return root
  root.quaternion.premultiply(o.quaternion)
  return root
}
