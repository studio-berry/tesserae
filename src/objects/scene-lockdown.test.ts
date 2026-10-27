import { describe, expect, it } from 'vitest'
import { lockdown, runScene } from './scene'

// The runtime half of the sandbox, on its own file: lockdown changes this process for good, the way
// it changes the scene worker, so no other test shares it.
lockdown()

const GROUP = `const group = new THREE.Group()
group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
return group`

describe('lockdown', () => {
  it('still builds a scene', () => {
    expect(runScene(GROUP, 1).tris).toBe(12)
  })

  it('takes away every Function constructor, whatever the text check missed', () => {
    // a name in a variable passes the text check, so these reach the constructor at runtime
    const reach = (fn: string) => `const k = ['con', 'structor'].join(''); const f = ${fn}; return f[k]('return 1')()`
    for (const fn of ['THREE.Mesh', 'rng', 'async () => 0', 'function* () {}', 'async function* () {}']) {
      expect(() => runScene(reach(fn), 1), fn).toThrow(/Function constructor/)
    }
  })

  it('takes the network away', () => {
    const scope = globalThis as Record<string, unknown>
    for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'BroadcastChannel', 'Worker']) {
      expect(scope[name], name).toBeUndefined()
    }
  })
})
