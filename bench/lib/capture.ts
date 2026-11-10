// One URL to one judged-able picture: navigate, wait for the stage to settle, take the shot and its
// thumbnail. The benchmark runner and the training-time scorer both go through here, so a score
// taken during training is taken the way the release check takes it.

import { setTimeout as sleep } from 'node:timers/promises'
import { Tab } from './cdp.ts'

export const THUMB = { w: 256, h: 160 }

export type Capture = {
  done: boolean // the stage settled on a drawn object
  error: string // what the app said, when it said anything
  title: string
  firstGlyphMs: number | null // the page's own clock, from document start
  navMs: number // the runner's clock, which a replaced document cannot fool
  png: Buffer | null
  thumb: Buffer | null
}

export type CaptureOptions = {
  settleMs?: number
  thumb?: { w: number; h: number }
}

export async function capture(tab: Tab, url: string, options: CaptureOptions = {}): Promise<Capture> {
  const navAt = Date.now()
  await tab.navigate(url)
  const settled = await tab.settled(options.settleMs ?? 60_000)
  const navMs = Date.now() - navAt
  const clock = await tab.clock()
  const out: Capture = {
    done: settled.done,
    error: settled.error ?? '',
    title: settled.title ?? '',
    firstGlyphMs: clock.firstGlyphMs,
    navMs,
    png: null,
    thumb: null,
  }
  if (!settled.done) return out
  const size = options.thumb ?? THUMB
  out.png = await tab.screenshot()
  out.thumb = await tab.downscale(out.png, size.w, size.h)
  return out
}

// A tab that has loaded the app once, so the atlas and the font are built: the first paint of the
// first prompt would otherwise pay for both, and that cost belongs to a visitor's first load rather
// than to prompt one.
export async function warm(tab: Tab, url: string): Promise<void> {
  await tab.installClock()
  await tab.navigate(url)
  await tab.settled(60_000)
  await sleep(100)
}
