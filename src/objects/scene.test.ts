import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { MAX_CODE, checkCode, runScene, sceneThree } from './scene'

const GROUP = `const group = new THREE.Group()
const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
group.add(box)
return group`

describe('checkCode', () => {
  it('accepts the code a scene is made of', () => {
    expect(checkCode(GROUP)).toEqual({ ok: true })
  })

  it('refuses the page, the network and the way out of the namespace', () => {
    // each of these is a capability a shape does not need, so the refusal happens before any of it
    // runs rather than after a call was made
    for (const code of [
      'const w = window.innerWidth; return new THREE.Group()',
      'fetch("https://example.com"); return new THREE.Group()',
      'return [].filter.constructor("return 1")()',
      'const x = globalThis; return new THREE.Group()',
      'return document.body',
    ]) {
      expect(checkCode(code).ok, code).toBe(false)
    }
  })

  it('refuses a loop that would never end', () => {
    expect(checkCode('while (true) {}').ok).toBe(false)
    expect(checkCode('for (;;) {}').ok).toBe(false)
    expect(checkCode('// meanwhile\ndo {} while (0)').ok).toBe(false)
    // a bounded for loop is the loop a scene is made of, so it stays allowed
    expect(checkCode('for (let i = 0; i < 4; i++) {} return new THREE.Group()').ok).toBe(true)
  })

  it('refuses nothing to run and too much to run', () => {
    expect(checkCode('   ').ok).toBe(false)
    expect(checkCode(`// ${'x'.repeat(MAX_CODE)}`).ok).toBe(false)
  })
})

describe('runScene', () => {
  it('builds the object the code returned, and counts what is in it', () => {
    const scene = runScene(GROUP, 1)
    expect(scene.object.isObject3D).toBe(true)
    expect(scene.parts).toBe(1)
    expect(scene.tris).toBe(12)
  })

  it('builds the same object twice from the same code and seed', () => {
    const code = `const g = new THREE.Group()
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
        m.position.x = rng()
        g.add(m)
      }
      return g`
    const a = runScene(code, 7)
    const b = runScene(code, 7)
    expect(a.parts).toBe(3)
    expect(a.object.children.map((c) => c.position.x)).toEqual(b.object.children.map((c) => c.position.x))
    // a different seed is a different throw of the same dice
    const c = runScene(code, 8)
    expect(c.object.children.map((c) => c.position.x)).not.toEqual(a.object.children.map((c) => c.position.x))
  })

  it('refuses what a scene must not be: not an object, empty, or unreadable', () => {
    expect(() => runScene('return 42', 1)).toThrow(/did not return an object/)
    expect(() => runScene('return new THREE.Group()', 1)).toThrow(/nothing to draw/)
    expect(() => runScene('throw new Error("no")', 1)).toThrow(/no/)
    expect(() => runScene('return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1', 1)).toThrow()
  })

  it('refuses a geometry too heavy to sample', () => {
    // a 300 segment sphere is about 180,000 triangles, past the ceiling the sampler can flatten
    expect(() => runScene('return new THREE.Mesh(new THREE.SphereGeometry(1, 300, 300), new THREE.MeshBasicMaterial())', 1)).toThrow(/too many triangles/)
  })

  it('gives the code no way to reach a file, a url or the page', () => {
    const three = sceneThree() as Record<string, unknown>
    expect(three.FileLoader).toBeUndefined()
    expect(three.TextureLoader).toBeUndefined()
    expect(three.ImageLoader).toBeUndefined()
    expect(three.AudioLoader).toBeUndefined()
    expect(typeof three.Mesh).toBe('function')
    // a name the namespace does not hold is undefined rather than the real loader, so the loader
    // path fails on its own without the check having to know every loader by name
    expect(() => runScene('return new THREE.FileLoader()', 1)).toThrow(/FileLoader/)
    // and the prototype chain is not a way back out to the real globals
    expect(() => runScene('return new (Object.getPrototypeOf(new THREE.Group()))()', 1)).toThrow(/not a constructor/)
  })

  it('flattens into a surface the sampler can read', () => {
    // the contract that matters downstream: what comes back is a three object the existing sampler
    // walks, not a description of one
    const { object } = runScene(GROUP, 1)
    const box = new THREE.Box3().setFromObject(object)
    expect(box.max.x - box.min.x).toBeCloseTo(1, 5)
  })
})
