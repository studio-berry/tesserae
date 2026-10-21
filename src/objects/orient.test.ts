import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { alignFront, alignUp, applyOrientation, bottomFlatness, extentsOf, orient, standing } from './orient'
import { surfaceFrom } from './soup'

// A box of points, standing on a face, in a given orientation.
const box = (w: number, h: number, d: number, rot?: THREE.Quaternion) => {
  const g = new THREE.BoxGeometry(w, h, d)
  if (rot) g.applyQuaternion(rot)
  const pos = g.getAttribute('position')
  const out = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    out[i * 3] = pos.getX(i)
    out[i * 3 + 1] = pos.getY(i)
    out[i * 3 + 2] = pos.getZ(i)
  }
  g.dispose()
  return out
}

const sphere = (r: number) => {
  const g = new THREE.SphereGeometry(r, 16, 12)
  const pos = g.getAttribute('position')
  const out = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    out[i * 3] = pos.getX(i); out[i * 3 + 1] = pos.getY(i); out[i * 3 + 2] = pos.getZ(i)
  }
  g.dispose()
  return out
}

// The model's own height after the correction, in world terms.
const correctedHeight = (pos: Float32Array, q: THREE.Quaternion) => {
  const v = new THREE.Vector3()
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < pos.length; i += 3) {
    v.set(pos[i], pos[i + 1], pos[i + 2]).applyQuaternion(q)
    if (v.y < lo) lo = v.y
    if (v.y > hi) hi = v.y
  }
  return hi - lo
}

// The model's own width after the correction, in world terms.
const correctedWidth = (pos: Float32Array, q: THREE.Quaternion) => {
  const v = new THREE.Vector3()
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (let i = 0; i < pos.length; i += 3) {
    v.set(pos[i], pos[i + 1], pos[i + 2]).applyQuaternion(q)
    if (v.x < x0) x0 = v.x
    if (v.x > x1) x1 = v.x
    if (v.z < z0) z0 = v.z
    if (v.z > z1) z1 = v.z
  }
  return Math.max(x1 - x0, z1 - z0)
}

// A model stands when it is taller than it is wide.
const standsUpright = (pos: Float32Array, q: THREE.Quaternion) =>
  correctedHeight(pos, q) > correctedWidth(pos, q) * 0.9

describe('extentsOf', () => {
  it('reads the bounds and the centre', () => {
    const e = extentsOf(new Float32Array([0, 0, 0, 2, 4, 6]))
    expect(e.min.toArray()).toEqual([0, 0, 0])
    expect(e.max.toArray()).toEqual([2, 4, 6])
    expect(e.centre.toArray()).toEqual([1, 2, 3])
    expect(e.radius).toBeCloseTo(Math.sqrt(14), 5)
  })
})

describe('bottomFlatness', () => {
  it('scores a box on its base high', () => {
    expect(bottomFlatness(box(2, 3, 1), new THREE.Quaternion())).toBeGreaterThan(0.8)
  })

  it('scores a ball low, because a ball has no flat base', () => {
    expect(bottomFlatness(sphere(1), new THREE.Quaternion())).toBeLessThan(0.5)
  })
})

describe('standing', () => {
  it('reads a tall box as standing and a flat one as lying', () => {
    expect(standing(box(1, 3, 1), new THREE.Quaternion())).toBeGreaterThan(2)
    expect(standing(box(3, 0.5, 3), new THREE.Quaternion())).toBeLessThan(0.3)
  })
})

describe('alignUp', () => {
  it('carries a direction onto the world up', () => {
    // the axis that carries one direction onto another is the cross of the two in that order,
    // and the other order spins the wrong way round
    for (const up of [
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(1, 1, 0).normalize(),
    ]) {
      const after = up.clone().applyQuaternion(alignUp(up))
      expect(after.y, `up ${up.toArray()}`).toBeCloseTo(1, 6)
      expect(after.x, `up ${up.toArray()}`).toBeCloseTo(0, 6)
      expect(after.z, `up ${up.toArray()}`).toBeCloseTo(0, 6)
    }
  })

  it('leaves the world up alone', () => {
    expect(alignUp(new THREE.Vector3(0, 1, 0)).angleTo(new THREE.Quaternion())).toBeCloseTo(0, 6)
  })

  it('turns an upside-down model the right way round', () => {
    const down = new THREE.Vector3(0, -1, 0)
    const after = down.clone().applyQuaternion(alignUp(down))
    expect(after.y).toBeCloseTo(1, 6)
  })
})

describe('alignFront', () => {
  it('carries a direction onto the world front', () => {
    for (const front of [
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, -1),
    ]) {
      const after = front.clone().applyQuaternion(alignFront(front))
      expect(after.z, `front ${front.toArray()}`).toBeCloseTo(1, 6)
      expect(after.x, `front ${front.toArray()}`).toBeCloseTo(0, 6)
      expect(after.y, `front ${front.toArray()}`).toBeCloseTo(0, 6)
    }
  })
})

describe('applyOrientation', () => {
  it('reaches the geometry the stage draws', () => {
    // the triangle soup is built in the root's own space, so a correction that only turned the
    // root would be cancelled before it reached the samples
    //
    // The model is a box lying on its side, and the correction is the one orient reads from
    // it, so the test goes through the whole path rather than through a hand-made rotation.
    const g = new THREE.BoxGeometry(1, 3, 1)
    g.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2))
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial())
    const root = new THREE.Group()
    root.add(mesh)
    root.updateMatrixWorld(true)

    const pts: number[] = []
    const attr = g.getAttribute('position')
    for (let i = 0; i < attr.count; i++) pts.push(attr.getX(i), attr.getY(i), attr.getZ(i))
    const o = orient(new Float32Array(pts))
    expect(o.confidence).toBeGreaterThan(0)
    applyOrientation(root, o)

    const s = surfaceFrom(root)
    expect(s.soup).not.toBeNull()
    const pos = s.soup!.pos
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i] < x0) x0 = pos[i]
      if (pos[i] > x1) x1 = pos[i]
      if (pos[i + 1] < y0) y0 = pos[i + 1]
      if (pos[i + 1] > y1) y1 = pos[i + 1]
    }
    // the box was three long and one wide, so standing it up makes it taller than it is wide
    expect((y1 - y0) / (x1 - x0)).toBeGreaterThan(2)
  })

  it('reaches the geometry at any depth of the model', () => {
    // The same correction as the test above, but through groups instead of straight onto the
    // mesh, because that is how models in the index are built: in a sample of sixteen, not one
    // mesh was a direct child of the scene root.
    //
    // A correction premultiplied onto every descendant is applied once per level, so a mesh two
    // groups down came out turned three times over. The box was only right by luck at one depth
    // and wrong at the others, so all of them are checked rather than one.
    for (const depth of [1, 2, 3]) {
      const g = new THREE.BoxGeometry(1, 3, 1)
      g.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2))
      const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial())
      const root = new THREE.Group()
      let parent: THREE.Object3D = root
      for (let i = 0; i < depth; i++) {
        const inner = new THREE.Group()
        parent.add(inner)
        parent = inner
      }
      parent.add(mesh)
      root.updateMatrixWorld(true)

      const attr = g.getAttribute('position')
      const pts: number[] = []
      for (let i = 0; i < attr.count; i++) pts.push(attr.getX(i), attr.getY(i), attr.getZ(i))
      const o = orient(new Float32Array(pts))
      expect(o.confidence, `depth ${depth}`).toBeGreaterThan(0)
      applyOrientation(root, o)

      const s = surfaceFrom(root)
      const pos = s.soup!.pos
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
      for (let i = 0; i < pos.length; i += 3) {
        if (pos[i] < x0) x0 = pos[i]
        if (pos[i] > x1) x1 = pos[i]
        if (pos[i + 1] < y0) y0 = pos[i + 1]
        if (pos[i + 1] > y1) y1 = pos[i + 1]
      }
      // three long and one wide before the turn, so standing it up makes it taller than wide
      expect((y1 - y0) / (x1 - x0), `depth ${depth}`).toBeGreaterThan(2)
    }
  })

  it('leaves a model alone when there is nothing to correct', () => {
    const g = new THREE.BoxGeometry(1, 3, 1)
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial())
    const root = new THREE.Group()
    root.add(mesh)
    const before = mesh.quaternion.clone()
    applyOrientation(root, { quaternion: new THREE.Quaternion(), confidence: 0 })
    expect(mesh.quaternion.angleTo(before)).toBeCloseTo(0, 6)
  })
})

describe('orient', () => {
  it('leaves a model that is already upright alone', () => {
    const pos = box(1, 3, 1)
    const o = orient(pos)
    // nothing was corrected, so there is nothing to report
    expect(o.confidence).toBe(0)
    expect(o.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 6)
    expect(standsUpright(pos, o.quaternion)).toBe(true)
  })

  it('turns a model that lies on its side so it stands', () => {
    const tipped = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)
    const pos = box(1, 3, 1, tipped)
    const o = orient(pos)
    expect(o.confidence).toBeGreaterThan(0)
    expect(standsUpright(pos, o.quaternion)).toBe(true)
  })

  it('turns a model that is upside down', () => {
    // an upside-down box is as tall as an upright one, so the flat base is what tells them
    // apart: an upside-down box has its flat face at the top
    const flipped = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI)
    const pos = box(1, 3, 1, flipped)
    const o = orient(pos)
    expect(standsUpright(pos, o.quaternion)).toBe(true)
  })

  it('turns a model that is on its front', () => {
    const rolled = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
    const pos = box(1, 3, 1, rolled)
    const o = orient(pos)
    expect(o.confidence).toBeGreaterThan(0)
    expect(standsUpright(pos, o.quaternion)).toBe(true)
  })

  it('leaves a round model alone, because a ball has no base to read', () => {
    const o = orient(sphere(1))
    expect(o.confidence).toBe(0)
    expect(o.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 6)
  })

  it('leaves a model with too few points alone', () => {
    expect(orient(new Float32Array([0, 0, 0, 1, 0, 0])).confidence).toBe(0)
  })

  it('never mirrors the model', () => {
    const pos = box(1, 3, 1)
    const m = new THREE.Matrix4().makeRotationFromQuaternion(orient(pos).quaternion)
    expect(m.determinant()).toBeCloseTo(1, 6)
  })

  it('turns a model that was authored lying down', () => {
    // a model authored on its side, which is how a model saved from a modelling package often
    // arrives
    for (const axis of [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)]) {
      const rot = new THREE.Quaternion().setFromAxisAngle(axis, Math.PI / 2)
      const pos = box(1, 3, 1, rot)
      const o = orient(pos)
      expect(standsUpright(pos, o.quaternion), `axis ${axis.toArray()}`).toBe(true)
    }
  })

  it('stands a bottle up, because a bottle has a round bottom and no flat base', () => {
    // a cylinder on its side: the height says it is a bottle, even though its bottom is curved
    const g = new THREE.CylinderGeometry(0.4, 0.4, 2, 16)
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)
    g.applyQuaternion(rot)
    const pos = g.getAttribute('position')
    const arr = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      arr[i * 3] = pos.getX(i); arr[i * 3 + 1] = pos.getY(i); arr[i * 3 + 2] = pos.getZ(i)
    }
    g.dispose()
    const o = orient(arr)
    expect(o.confidence).toBeGreaterThan(0)
    expect(standsUpright(arr, o.quaternion)).toBe(true)
  })

  it('does not turn a model that is already standing', () => {
    const pos = box(2, 3, 1)
    const o = orient(pos)
    // the identity leaves the model where it was
    expect(o.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 6)
  })
})
