// The development-only sources: a cloud served by URL (`?ply=`) and a saved sampling walk
// (`?traj=`, with `&ms=` for how long each step holds).
//
// They live here rather than in the app shell so the shell keeps one effect and no knowledge of how
// a development link is loaded. Neither is a share link: the app writes its own URL back and these
// parameters are deliberately not part of that, which is why they are read once at module load.

import { loadPlyUrl } from './load'
import { fetchTraj, normalizeSteps } from './trajectory'
import type { Source } from './index'

export const DEFAULT_STEP_MS = 70

export type Play = { steps: Float32Array[]; ms: number }

// What to draw, and, for a walk, the frames the stage should spring through
export type Dev = { source: Source; play: Play | null }

const nameOf = (url: string, fallback: string) => decodeURIComponent(url.split('/').pop() || fallback)

export async function devSource(params: URLSearchParams): Promise<Dev | null> {
  const traj = params.get('traj')
  if (traj) {
    const walk = await fetchTraj(traj)
    normalizeSteps(walk.steps)
    const ms = Math.max(16, Number(params.get('ms')) || DEFAULT_STEP_MS)
    return {
      source: { kind: 'trajectory', steps: walk.steps, name: nameOf(traj, 'trajectory') },
      play: { steps: walk.steps, ms },
    }
  }
  const ply = params.get('ply')
  if (ply) return { source: { kind: 'file', ...(await loadPlyUrl(ply)) }, play: null }
  return null
}
