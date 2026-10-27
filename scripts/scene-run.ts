// One written scene, run in a worker thread for scripts/scene-spike.ts: locked down the way the
// app's scene worker is, so a scene that hangs or reaches out costs this thread and not the spike.

import { parentPort, workerData } from 'node:worker_threads'
import { lockdown, runScene } from '../src/objects/scene.ts'

lockdown()
const { code, seed } = workerData as { code: string; seed: number }
try {
  const scene = runScene(code, seed)
  parentPort!.postMessage({ ok: true, parts: scene.parts, tris: scene.tris })
} catch (err) {
  parentPort!.postMessage({ ok: false, why: (err as Error).message })
}
