// What the HUD shows, published by the engine about ten times a second. A tiny external store
// keeps those updates in the HUD alone, so the 3D canvas never re-renders for them.

export type Info = { phase: string; glyphs: number }

let current: Info = { phase: '', glyphs: 0 }
const listeners = new Set<() => void>()

export const infoStore = {
  get: () => current,
  set(next: Info) {
    if (next.phase === current.phase && next.glyphs === current.glyphs) return
    current = next
    listeners.forEach((l) => l())
  },
  subscribe(l: () => void) {
    listeners.add(l)
    return () => { listeners.delete(l) }
  },
}

// Imperative hooks the stage registers so the UI can ask it for things without re-rendering it
export const stageApi = {
  snapshot: (_cols?: number): string => '',
  png: (): string => '',
  burst: () => {},
}

// handy from the console while developing: stageApi.snapshot() prints the current view as text
if (import.meta.env.DEV) (globalThis as { stageApi?: typeof stageApi }).stageApi = stageApi
