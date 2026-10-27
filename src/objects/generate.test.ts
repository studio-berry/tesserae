import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatStore, findChat, forgetScenes, sceneKey } from './generate'

// The chat backend's client half: one request per prompt and seed, and every way the request can
// fail turned into a sentence rather than an exception.

const SCENE = {
  title: 'Brass Padlock',
  code: 'const group = new THREE.Group()\nreturn group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))',
  model: 'glm-5.3-flash',
  ms: 9400,
}

type Reply = { status?: number; json?: unknown }

// The endpoint answers two ways: a GET that says whether it can write, and the POST that writes.
// A stub that answers both with the same thing would let a broken probe pass unnoticed.
const stubFetch = (route: () => Reply, probe: Reply | null = { json: { writing: true, model: 'glm-5.3-flash' } }) => {
  const calls: { url: string; method: string; body: string; headers: Record<string, string> }[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.body === undefined ? 'GET' : 'POST'
    calls.push({ url: String(input), method, body: String(init?.body ?? ''), headers: (init?.headers ?? {}) as Record<string, string> })
    const reply = (method === 'GET' ? probe : route()) ?? { status: 404 }
    const status = reply.status ?? 200
    return { ok: status >= 200 && status < 300, status, json: async () => reply.json } as unknown as Response
  })
  vi.stubGlobal('fetch', fn as unknown as typeof fetch)
  return calls
}

const posts = (calls: { method: string; body: string }[]) => calls.filter((c) => c.method === 'POST')

afterEach(() => {
  vi.unstubAllGlobals()
  forgetScenes()
  chatStore.set({ phase: 'idle', title: '', model: '', ms: 0, why: '' })
})

describe('findChat', () => {
  it('asks this app for a scene, never the model', async () => {
    const calls = stubFetch(() => ({ json: SCENE }))
    const scene = await findChat('a brass padlock', 0)
    expect(scene).toEqual({ title: SCENE.title, code: SCENE.code, model: SCENE.model, ms: SCENE.ms })
    expect(posts(calls)).toHaveLength(1)
    // no credential and no provider host on the client: the endpoint holds both
    expect(calls[0].url).toBe('/api/scene')
    expect(JSON.stringify(calls[0].headers)).not.toMatch(/authorization|bearer|api[-_]?key/i)
    expect(chatStore.get().phase).toBe('ready')
  })

  it('sends the prompt and the seed, so a reroll asks a different question', async () => {
    const calls = stubFetch(() => ({ json: SCENE }))
    await findChat('a brass padlock', 4)
    expect(JSON.parse(posts(calls)[0].body)).toEqual({ prompt: 'a brass padlock', seed: 4 })
  })

  it('draws a repeat prompt from what it kept, without asking again', async () => {
    const calls = stubFetch(() => ({ json: SCENE }))
    const first = await findChat('a brass padlock', 0)
    const again = await findChat('a brass padlock', 0)
    expect(again).toEqual(first)
    expect(posts(calls)).toHaveLength(1)
    // a reroll is a different scene, so it is a different question
    await findChat('a brass padlock', 1)
    expect(posts(calls)).toHaveLength(2)
  })

  it('keeps the browser store at forty scenes across visits, not forty per visit', async () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
    stubFetch(() => ({ json: SCENE }))
    // three visits of thirty prompts each; forgetScenes is a page load, which empties the memory
    for (let visit = 0; visit < 3; visit++) {
      forgetScenes()
      for (let i = 0; i < 30; i++) await findChat(`prompt ${visit * 30 + i}`, 0)
    }
    const scenes = [...store.keys()].filter((k) => k !== 'scene:index')
    expect(scenes).toHaveLength(40)
    // the newest are the ones kept
    expect(store.has(`scene:${sceneKey('prompt 89', 0)}`)).toBe(true)
    expect(store.has(`scene:${sceneKey('prompt 49', 0)}`)).toBe(false)
    expect(JSON.parse(store.get('scene:index')!)).toHaveLength(40)
  })

  it('keys a prompt the way the backend does, so spacing and case do not cost a second scene', async () => {
    const calls = stubFetch(() => ({ json: SCENE }))
    expect(sceneKey(' A  Brass   Padlock ', 0)).toBe(sceneKey('a brass padlock', 0))
    await findChat('A Brass  Padlock', 0)
    await findChat('a brass padlock', 0)
    expect(posts(calls)).toHaveLength(1)
  })

  it('names a scene the writer left unnamed after the prompt that asked for it', async () => {
    stubFetch(() => ({ json: { ...SCENE, title: '' } }))
    const scene = await findChat('a brass padlock', 0)
    expect(scene?.title).toBe('“a brass padlock”')
  })

  it('says which of the three failures happened, rather than one shrug for all of them', async () => {
    stubFetch(() => ({ status: 503 }))
    expect(await findChat('a fox', 0)).toBeNull()
    expect(chatStore.get().why).toBe('no scene writer is configured on this server')

    stubFetch(() => ({ status: 502 }))
    expect(await findChat('a fox', 0)).toBeNull()
    expect(chatStore.get().why).toBe('the scene writer could not make that one')

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch)
    expect(await findChat('a fox', 0)).toBeNull()
    expect(chatStore.get().why).toBe('the scene writer is not reachable here')
  })

  it('refuses a scene whose code the sandbox would not run, and one whose words break the rules', async () => {
    stubFetch(() => ({ json: { ...SCENE, code: 'const g = new THREE.Group(); g.x = window.innerWidth; return g' } }))
    expect(await findChat('a fox', 0)).toBeNull()
    expect(chatStore.get().why).toMatch(/will not draw/)

    stubFetch(() => ({ json: { ...SCENE, title: 'fucking padlock' } }))
    expect(await findChat('a fox', 0)).toBeNull()
    expect(chatStore.get().why).toMatch(/will not draw/)
  })

  it('refuses a scene whose code is empty', async () => {
    stubFetch(() => ({ json: { ...SCENE, code: '' } }))
    expect(await findChat('a fox', 0)).toBeNull()
  })

  it('asks for nothing when there is nothing to ask', async () => {
    const calls = stubFetch(() => ({ json: SCENE }))
    expect(await findChat('   ', 0)).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('says the box is unavailable when there is no endpoint behind the page', async () => {
    // a static build answers POST with whatever the file server says, which is not a writer refusing
    const calls = stubFetch(() => ({ json: SCENE }), null)
    expect(await findChat('a fox', 0)).toBeNull()
    expect(posts(calls)).toHaveLength(0)
    expect(chatStore.get().why).toBe('the scene writer is not available on this server')
  })

  it('says no writer is configured when the endpoint answers without a key behind it', async () => {
    const calls = stubFetch(() => ({ json: SCENE }), { json: { writing: false, model: null } })
    expect(await findChat('a fox', 0)).toBeNull()
    expect(posts(calls)).toHaveLength(0)
    expect(chatStore.get().why).toBe('no scene writer is configured on this server')
  })
})
