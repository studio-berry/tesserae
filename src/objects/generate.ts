import { mulberry32 } from '../engine/core'
import { resultPasses } from '../safety/result.ts'
import { normalisePrompt } from './prompt.ts'
import { checkCode } from './scene.ts'

// The chat backend: a prompt goes to a scene writer and comes back as code, which the worker runs
// (src/objects/scene.ts) and the sampler draws.
//
// The writer is not called from the browser. A key cannot ship in a bundle, so the request goes to
// this app's own endpoint, which holds the key on the machine that serves it. That is also what
// makes the backend optional: a static build has no endpoint, the call fails, and the app says so
// instead of drawing something else.
//
// A scene costs about twenty seconds of a model's time, so a result is cached by prompt and seed.
// A repeat prompt, a reload, or a share link that was already opened on this machine draws the same
// scene without asking again.

const ENDPOINT = '/api/scene'

// One entry per prompt and seed. A code string is a few kilobytes, so forty of them fit in a
// browser store; the capacity is what keeps it from growing without a ceiling.
const CAPACITY = 40

export type Written = { code: string; title: string; model: string; ms: number }

// What the composer shows while a scene is on its way, and what it says afterwards. Published as a
// store, the way the engine publishes its own phase, so the canvas never re-renders for it.
export type Progress = {
  phase: 'idle' | 'asking' | 'ready' | 'failed'
  title: string
  model: string
  ms: number
  why: string
}

let progress: Progress = { phase: 'idle', title: '', model: '', ms: 0, why: '' }
const listeners = new Set<() => void>()

export const chatStore = {
  get: () => progress,
  set(next: Progress) {
    progress = next
    listeners.forEach((l) => l())
  },
  subscribe(l: () => void) {
    listeners.add(l)
    return () => { listeners.delete(l) }
  },
}

export const sceneKey = (text: string, seed: number) => `${normalisePrompt(text)}|${seed}`

let memory = new Map<string, string>()

// The browser's own store, or nothing. A private-mode browser throws on the first write, and a
// scene that cannot be remembered is still a scene that can be drawn, so both failures are quiet.
const save = (key: string, text: string | null) => {
  try {
    if (text === null) globalThis.localStorage?.removeItem(`scene:${key}`)
    else globalThis.localStorage?.setItem(`scene:${key}`, text)
  } catch {
    // nothing to do: the next prompt asks again
  }
}

// The order of the stored scenes, oldest first, kept in the store beside them. The in-memory map
// starts empty on every page load, so it cannot know what earlier visits saved; this list can, and
// it is what keeps the browser store at forty entries across visits rather than forty per visit.
// A key is a prompt and a seed joined by `|`, so no key is ever `index`.
const ORDER = 'scene:index'

const order = (): string[] => {
  try {
    const list = JSON.parse(globalThis.localStorage?.getItem(ORDER) ?? '[]') as unknown
    return Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

// `key` moves to the newest end, and whatever falls past the capacity is dropped from both stores.
const touch = (key: string) => {
  const keys = order().filter((k) => k !== key)
  keys.push(key)
  while (keys.length > CAPACITY) {
    const old = keys.shift()!
    memory.delete(old)
    save(old, null)
  }
  try { globalThis.localStorage?.setItem(ORDER, JSON.stringify(keys)) } catch { /* as in save */ }
}

const remember = (key: string, written: Written) => {
  const text = JSON.stringify(written)
  memory.delete(key)
  memory.set(key, text)
  while (memory.size > CAPACITY) {
    const [old] = memory.keys()
    memory.delete(old)
  }
  touch(key)
  save(key, text)
}

const recall = (key: string): Written | null => {
  let text = memory.get(key)
  if (!text) {
    try { text = globalThis.localStorage?.getItem(`scene:${key}`) ?? undefined } catch { text = undefined }
  }
  if (!text) return null
  try {
    const value = JSON.parse(text) as Written
    if (!value?.code || !value.title) return null
    memory.delete(key)
    memory.set(key, text)
    touch(key)
    return value
  } catch {
    return null
  }
}

// For a test, and for a share link that should draw something new.
export const forgetScenes = () => {
  memory = new Map()
  probe = null
}

type Reply = { title?: string; code?: string; model?: string; ms?: number; error?: string }

// Whether this server has a writer behind the endpoint at all, asked once.
//
// A static build answers the POST with a 404 or a 501 from whatever served the files, which the
// status-code reading below cannot tell apart from a writer that refused. One GET settles it: the
// endpoint exists and says whether it can write, or there is no endpoint and the box says so before
// a prompt is typed.
let probe: Promise<{ writing: boolean; model: string | null } | null> | null = null
export const sceneWriter = () => {
  if (!probe) {
    probe = fetch(ENDPOINT, { signal: AbortSignal.timeout(5_000) })
      .then(async (res) => (res.ok ? ((await res.json()) as { writing: boolean; model: string | null }) : null))
      .catch(() => null)
  }
  return probe
}

// The scene for a prompt and seed, or null when the writer is not reachable or its answer is not
// something this app will run. A seeded reply is never invented locally: null means the app says
// the writer is unavailable rather than drawing a stand-in for it.
export async function findChat(text: string, seed = 0): Promise<Written | null> {
  const clean = text.trim().slice(0, 80)
  if (!clean) return null
  const key = sceneKey(clean, seed)
  const hit = recall(key)
  if (hit) {
    chatStore.set({ phase: 'ready', title: hit.title, model: hit.model, ms: hit.ms, why: '' })
    return hit
  }

  chatStore.set({ phase: 'asking', title: '', model: '', ms: 0, why: '' })
  const writer = await sceneWriter()
  if (!writer) {
    chatStore.set({ phase: 'failed', title: '', model: '', ms: 0, why: 'the scene writer is not available on this server' })
    return null
  }
  if (!writer.writing) {
    chatStore.set({ phase: 'failed', title: '', model: '', ms: 0, why: 'no scene writer is configured on this server' })
    return null
  }
  let reply: Reply
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: clean, seed }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) {
      // The three failures read differently to a person: no endpoint at all, no credential behind
      // it, and a writer that answered but could not make the scene. One sentence for all three
      // told the user to try again when trying again could never work.
      const why = res.status === 503
        ? 'no scene writer is configured on this server'
        : res.status >= 500
          ? 'the scene writer could not make that one'
          : `the scene writer answered ${res.status}`
      chatStore.set({ phase: 'failed', title: '', model: '', ms: 0, why })
      return null
    }
    reply = (await res.json()) as Reply
  } catch {
    chatStore.set({ phase: 'failed', title: '', model: '', ms: 0, why: 'the scene writer is not reachable here' })
    return null
  }

  // A reply that arrived without a title is not a failed scene: the model was asked for one and
  // sometimes leaves it out, so the prompt names it, the way the prompt backend names a built form.
  const title = (reply.title ?? '').trim().slice(0, 60) || `“${clean}”`
  const code = (reply.code ?? '').trim()
  const verdict = checkCode(code)
  // The code is not shown, but it carries the title and a comment can carry anything, so a scene
  // whose text breaks the content rules is refused before it is drawn. The prompt that asked for it
  // already passed the typed check on the way in.
  if (!title || !verdict.ok || !resultPasses(title) || !resultPasses(code)) {
    chatStore.set({ phase: 'failed', title: '', model: reply.model ?? '', ms: 0, why: 'the scene writer returned something this app will not draw' })
    return null
  }

  const written: Written = { title, code, model: reply.model ?? '', ms: reply.ms ?? 0 }
  remember(key, written)
  chatStore.set({ phase: 'ready', title, model: written.model, ms: written.ms, why: '' })
  return written
}

// The scene's own randomness, so the same code and seed always build the same object.
export const sceneRng = (seed: number) => mulberry32(seed * 7919 + 17)
