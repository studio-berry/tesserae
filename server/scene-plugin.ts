import type { Connect } from 'vite'
import { writerFrom, writeScene } from './zen.ts'

// The endpoint the browser calls instead of the model.
//
// A key cannot ship in a bundle: anything the browser holds is public, so the key stays on the
// machine that serves the page and the browser only ever sees a scene. That also makes the backend
// optional. `npm run build` writes static files, there is no server behind them, the call fails,
// and the app says the writer is unavailable rather than drawing something else.
//
// Both servers the repo ships get it: the dev server and the preview server, so a production build
// can be tried locally before it is put anywhere.

const MOUNT = '/api/scene'
const MAX_BODY = 4_096

const json = (res: Parameters<Connect.NextHandleFunction>[1], status: number, value: unknown) => {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

const body = (req: Parameters<Connect.NextHandleFunction>[0]) =>
  new Promise<string>((ok, bad) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        bad(new Error('the request was too long'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')))
    req.on('error', bad)
  })

export function sceneBackend(env: Record<string, string | undefined>) {
  const writer = writerFrom(env)

  const handle: Connect.NextHandleFunction = (req, res) => {
    if (req.method === 'GET') {
      // the composer asks this once, so it can say the writer is unavailable before a prompt is typed
      json(res, 200, { writing: !!writer, model: writer?.model ?? null })
      return
    }
    if (req.method !== 'POST') {
      json(res, 405, { error: 'POST only' })
      return
    }
    if (!writer) {
      json(res, 503, { error: 'no credential on this server' })
      return
    }
    void body(req)
      .then(async (text) => {
        let asked: { prompt?: unknown; seed?: unknown }
        try {
          asked = JSON.parse(text) as { prompt?: unknown; seed?: unknown }
        } catch {
          json(res, 400, { error: 'the request was not readable' })
          return
        }
        const prompt = typeof asked.prompt === 'string' ? asked.prompt.trim().slice(0, 80) : ''
        if (!prompt) {
          json(res, 400, { error: 'a prompt is required' })
          return
        }
        const seed = Number.isFinite(asked.seed) ? Math.max(0, Math.floor(asked.seed as number)) : 0
        const made = await writeScene(writer, prompt, { seed })
        if (!made.ok) {
          json(res, 502, { error: made.why })
          return
        }
        json(res, 200, made.scene)
      })
      .catch(() => json(res, 400, { error: 'the request was not readable' }))
  }

  return {
    name: 'gen-ascii-scene',
    configureServer(server: { middlewares: Connect.Server }) {
      server.middlewares.use(MOUNT, handle)
    },
    configurePreviewServer(server: { middlewares: Connect.Server }) {
      server.middlewares.use(MOUNT, handle)
    },
  }
}
