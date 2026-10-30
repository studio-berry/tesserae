// Film a trajectory replay: the object assembling itself out of the dust, one screenshot a frame.
//
//   node bench/trajectory-shots.ts --traj bench/samples/p001.traj --out docs/shots/trajectory --frames 40
//
// The stage is the app's, so the clip is the product rather than a mock of it. Frames are taken on a
// fixed cadence from the moment the walk starts; the app's own phase tells us when that is.

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { Tab, alive, launchChrome } from './lib/cdp.ts'

const arg = (name: string, fallback: string) => {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 ? process.argv[at + 1] : fallback
}

const TRAJ = arg('traj', 'bench/samples/p001.traj')
const OUT = arg('out', 'docs/shots/trajectory')
const FRAMES = Number(arg('frames', '40')) || 40
const STEP_MS = Number(arg('ms', '110')) || 110
const PORT = Number(arg('port', '5181')) || 5181
const CDP = Number(arg('cdp', '9336')) || 9336
const PROFILE = `${process.env.TEMPDIR ?? process.env.LOCALAPPDATA ?? '.'}/Temp/gen-ascii-shots-profile`
const PLAY_MS = Number(arg('play', '110')) || 110 // how long each model step holds, the app's ?ms=

async function main() {
  mkdirSync(OUT, { recursive: true })
  const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore', shell: process.platform === 'win32',
  })
  const chrome = launchChrome(CDP, PROFILE)
  const clean = () => { chrome.close(); try { server.kill() } catch { /* gone */ } }
  process.on('exit', clean)

  try {
    if (!(await alive(`http://127.0.0.1:${PORT}/`))) throw new Error('the dev server never came up')
    if (!(await alive(`http://127.0.0.1:${CDP}/json/version`, 60))) throw new Error('Chrome never came up')
    const tab = await Tab.open(CDP)
    await tab.installClock()
    // warm-up: the atlas and the font are built once, and they are not part of the animation
    await tab.navigate(`http://127.0.0.1:${PORT}/?theme=dark&n=12000`)
    await tab.settled(60_000)
    await tab.navigate(`http://127.0.0.1:${PORT}/?traj=${encodeURIComponent(`/${TRAJ.replace(/^\/+/, '')}`)}&ms=${PLAY_MS}&theme=dark&n=12000`)

    // The page paints the library object first (that is the URL's default source), assembles it,
    // and only then swaps in the trajectory. Waiting for 'assembling' alone filmed the library; the
    // eyebrow's first word is the source's kind, so 'sampling' is the signal that the walk started.
    const until = Date.now() + 60_000
    let started = false
    while (Date.now() < until) {
      const eyebrow = await tab.evaluate<string>(`document.querySelector('.hud .eyebrow')?.textContent ?? ''`)
      if (/sampling/i.test(eyebrow) && /assembling/i.test(eyebrow)) { started = true; break }
      await sleep(50)
    }
    if (!started) throw new Error('the trajectory never started')

    for (let i = 0; i < FRAMES; i++) {
      const at = Date.now()
      const png = await tab.screenshot()
      writeFileSync(`${OUT}/frame-${String(i).padStart(3, '0')}.png`, png)
      const wait = Math.max(0, STEP_MS - (Date.now() - at))
      if (wait) await sleep(wait)
    }
    console.log(`${FRAMES} frames into ${OUT}`)
    await tab.close()
  } finally {
    clean()
  }
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
