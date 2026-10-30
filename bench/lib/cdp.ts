// A headless Chrome driven over CDP, in as little code as the benchmark needs.
//
// The app is only observable through its own DOM, so every measurement is taken in the page: the
// stage publishes its phase into `.hud .eyebrow`, and the first moment that says `assembling` or
// `rendering` is the first glyph frame. Nothing here waits on a fixed sleep for the render; a
// screenshot is only taken after the phase has held `rendering` for three seconds.

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

export type Chrome = { close: () => void }

const WINDOWS_CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

const findChrome = (): string => {
  const fromEnv = process.env.CHROME_PATH?.trim()
  if (fromEnv) return fromEnv
  return WINDOWS_CHROME[0]
}

export const alive = async (url: string, tries = 240): Promise<boolean> => {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch { /* not up yet */ }
    await sleep(500)
  }
  return false
}

export function launchChrome(port: number, profile: string): Chrome {
  // The profile must live outside the repo: vite watches the tree and a live Chrome profile in it
  // locks a sqlite file hard enough to kill the watcher with EBUSY.
  mkdirSync(profile, { recursive: true })
  const child: ChildProcess = spawn(findChrome(), [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,800',
    '--hide-scrollbars',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    // a background tab stops asking for frames, and this app only advances while it renders: without
    // these three, a second tab measures a frozen stage forever
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    'about:blank',
  ], { stdio: 'ignore' })
  return {
    close: () => {
      try { child.kill() } catch { /* already gone */ }
      // Chrome holds its own profile open for a moment after the kill, and Windows will not delete a
      // live directory; the profile is disposable, so a failed cleanup is not an error
      try { rmSync(profile, { recursive: true, force: true }) } catch { /* still locked */ }
    },
  }
}

type Pending = { ok: (v: unknown) => void; bad: (e: Error) => void }

// One page, one websocket. A tab is the unit of measurement, so two tabs cannot slow each other's
// timings the way two prompts in one tab would.
export class Tab {
  private ws: WebSocket
  private id = 0
  private pending = new Map<number, Pending>()
  private errors: string[] = []

  private constructor(ws: WebSocket) {
    this.ws = ws
    this.ws.onmessage = ({ data }: MessageEvent) => {
      const msg = JSON.parse(String(data))
      if (msg.id && this.pending.has(msg.id)) {
        const job = this.pending.get(msg.id)!
        this.pending.delete(msg.id)
        if (msg.error) job.bad(new Error(msg.error.message))
        else job.ok(msg.result)
        return
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.errors.push(msg.params.args.map((a: { value?: string; description?: string }) => a.value ?? a.description).join(' '))
      }
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') this.errors.push(msg.params.entry.text)
    }
  }

  static async open(port: number, url = 'about:blank'): Promise<Tab> {
    const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
    if (!res.ok) throw new Error(`could not open a tab: ${res.status}`)
    const target = (await res.json()) as { id: string; webSocketDebuggerUrl: string }
    const tab = new Tab(new WebSocket(target.webSocketDebuggerUrl))
    await new Promise<void>((ok, bad) => { tab.ws.onopen = () => ok(); tab.ws.onerror = () => bad(new Error('the browser closed')) })
    await tab.send('Page.enable')
    await tab.send('Runtime.enable')
    await tab.send('Log.enable')
    // a fixed 1280x800 viewport, so every screenshot is the same size whatever the display
    await tab.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
    return tab
  }

  send(method: string, params: Record<string, unknown> = {}, timeoutMs = 45_000): Promise<unknown> {
    return new Promise((ok, bad) => {
      const n = ++this.id
      const timer = setTimeout(() => { this.pending.delete(n); bad(new Error(`${method} did not answer`)) }, timeoutMs)
      this.pending.set(n, { ok: (r) => { clearTimeout(timer); ok(r) }, bad: (e) => { clearTimeout(timer); bad(e) } })
      this.ws.send(JSON.stringify({ id: n, method, params }))
    })
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const res = (await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })) as {
      result?: { value?: T }; exceptionDetails?: { exception?: { description?: string } }
    }
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? 'evaluate failed')
    return res.result?.value as T
  }

  // The measurement script has to exist before the app's own code runs, so it is installed on the
  // document and not after a navigation.
  async installClock(): Promise<void> {
    await this.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const at = performance.now()
        window.__bench = { firstGlyphMs: null, readyMs: null }
        const read = () => {
          const eyebrow = document.querySelector('.hud .eyebrow')?.textContent ?? ''
          const ready = /\\u00b7\\s*rendering/i.test(eyebrow)
          if (window.__bench.firstGlyphMs === null && /(assembling|rendering|scanning)/i.test(eyebrow)) {
            window.__bench.firstGlyphMs = Math.round(performance.now() - at)
          }
          if (window.__bench.readyMs === null && ready) window.__bench.readyMs = Math.round(performance.now() - at)
        }
        // observed on the document rather than documentElement: at document-start the root element
        // does not exist yet, and an observer that failed to install would leave every timing null
        new MutationObserver(read).observe(document, { subtree: true, childList: true, characterData: true })
        read()
      })()`,
    })
  }

  async navigate(url: string): Promise<void> {
    const want = new URL(url).search
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.send('Page.navigate', { url }, 90_000)
      // Page.navigate answers when the navigation starts, not when it lands: DOM queries still reach
      // the previous document until the new one commits, and every measurement taken in that window is
      // a measurement of the page the browser is leaving.
      const until = Date.now() + 30_000
      while (Date.now() < until) {
        const here = await this.evaluate<string>('location.search').catch(() => null)
        if (here === want) return
        await sleep(40)
      }
    }
    throw new Error(`navigation to ${url} did not commit`)
  }

  async clock(): Promise<{ firstGlyphMs: number | null; readyMs: number | null }> {
    return (await this.evaluate(`window.__bench ?? { firstGlyphMs: null, readyMs: null }`)) as {
      firstGlyphMs: number | null; readyMs: number | null
    }
  }

  async state(): Promise<{ eyebrow: string; title: string; status: string; error: string }> {
    return this.evaluate(`(() => ({
      eyebrow: document.querySelector('.hud .eyebrow')?.textContent ?? '',
      title: document.querySelector('.hud h1')?.textContent ?? '',
      status: document.querySelector('.hud .status')?.textContent ?? '',
      error: document.querySelector('.hud .error p')?.textContent ?? '',
    }))()`)
  }

  // `rendering` is the stage's own word for settled. Assembling and scanning are mid-flight frames,
  // and a picture taken on one of those judges a half-built object.
  async settled(ms = 120_000, notTitle = ''): Promise<{ done: boolean; title: string; status: string; error: string }> {
    const until = Date.now() + ms
    let held = 0
    while (Date.now() < until) {
      const s = await this.state()
      if (s.error) return { done: true, ...s }
      const ready = /·\s*rendering/i.test(s.eyebrow) && !!s.title && s.title !== '…' && s.title !== notTitle
      held = ready ? held + 200 : 0
      if (held >= 3000) return { done: true, ...s }
      await sleep(200)
    }
    return { done: false, ...(await this.state()) }
  }

  async screenshot(): Promise<Buffer> {
    const shot = (await this.send('Page.captureScreenshot', { format: 'png' })) as { data: string }
    return Buffer.from(shot.data, 'base64')
  }

  // The thumbnail is the same frame at a fifth of the size, drawn by the same browser: a smaller
  // picture of the object, not a different render of it.
  async downscale(png: Buffer, width: number, height: number): Promise<Buffer> {
    const data = png.toString('base64')
    const out = await this.evaluate<string>(`(async () => {
      const img = new Image()
      img.src = 'data:image/png;base64,${data}'
      await img.decode()
      const c = document.createElement('canvas')
      c.width = ${width}; c.height = ${height}
      const x = c.getContext('2d')
      x.imageSmoothingEnabled = true
      x.imageSmoothingQuality = 'high'
      x.drawImage(img, 0, 0, ${width}, ${height})
      return c.toDataURL('image/png').split(',')[1]
    })()`)
    return Buffer.from(out, 'base64')
  }

  consoleErrors(): string[] {
    return this.errors.filter((l) => !/favicon|status of 404/i.test(l))
  }

  async close(): Promise<void> {
    try { this.ws.close() } catch { /* already closed */ }
  }
}
