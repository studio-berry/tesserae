import { checkCode } from '../src/objects/scene.ts'
import { SYSTEM, parseReply, userTurn, type Written } from './scene-prompt.ts'

// The one place a scene is asked for. The dev server's endpoint, the spike and the test all come
// through here, so the model, the brief and the reading of the reply are decided once.
//
// The key never leaves this module's caller on the server side: it is read from the environment,
// put on one request, and the browser sees the parsed scene and nothing else.

export const ZEN_URL = 'https://opencode.ai/zen/go/v1/chat/completions'

// Chosen by docs/chat-scenes.md's spike: the model with the best scene pass rate at the latency a
// chat box can wait for. SCENE_MODEL overrides it for an experiment.
export const DEFAULT_MODEL = 'glm-5.3-flash'

// A scene is about 900 tokens of code, but a reasoning model spends most of its completion
// thinking before it writes one, and the cap counts both. 20k leaves room for the trace and the
// scene; a reply that still hits the cap is reported rather than parsed.
const MAX_TOKENS = 20_000

export type Writer = { key: string; url?: string; model?: string; session?: string }

// The writer, or null when this machine has no credential. A null writer is a backend that answers
// nothing rather than a broken app: the prompt path falls through to the search backends.
export function writerFrom(env: Record<string, string | undefined>): Writer | null {
  const key = env.OPENCODE_ZEN_API_KEY?.trim()
  if (!key) return null
  return { key, url: env.SCENE_URL?.trim() || ZEN_URL, model: env.SCENE_MODEL?.trim() || DEFAULT_MODEL }
}

export type WrittenScene = Written & { model: string; ms: number; tries: number }
export type WriteResult = { ok: true; scene: WrittenScene } | { ok: false; why: string; raw?: string }

type Reply = {
  choices?: { finish_reason?: string; message?: { content?: string } }[]
  error?: { message?: string }
}

export async function once(
  writer: Writer,
  prompt: string,
  options: { seed?: number; timeoutMs?: number; note?: string } = {},
): Promise<WriteResult> {
  const model = writer.model ?? DEFAULT_MODEL
  const started = Date.now()
  let res: Response
  try {
    res = await fetch(writer.url ?? ZEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${writer.key}`,
        // the gateway routes on a session id and refuses a request without one
        'x-opencode-session': writer.session ?? 'gen-ascii-scene',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: [userTurn(prompt, options.seed ?? 0), options.note].filter(Boolean).join('\n\n') },
        ],
        max_tokens: MAX_TOKENS,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
    })
  } catch (err) {
    return { ok: false, why: `the model did not answer: ${(err as Error).message}` }
  }
  if (!res.ok) return { ok: false, why: `the model answered ${res.status}` }

  let body: Reply
  try {
    body = (await res.json()) as Reply
  } catch {
    return { ok: false, why: 'the answer was not readable' }
  }
  const choice = body.choices?.[0]
  const content = choice?.message?.content ?? ''
  // A cut-off reply is reported as such rather than parsed: it looks like a scene, runs as a
  // syntax error three layers down, and the reason is lost on the way.
  if (choice?.finish_reason === 'length') return { ok: false, why: 'the reply was cut short', raw: content }
  const written = parseReply(content)
  if (!written) return { ok: false, why: 'the reply did not parse', raw: content }
  return { ok: true, scene: { ...written, model, ms: Date.now() - started, tries: 1 } }
}

// The scene for a prompt, with one corrective turn when the model slips past the sandbox.
//
// Measured on ten prompts, a refusal was a slip rather than a broken answer: one scene read
// `window.innerWidth` to size itself, which the brief forbids and the runner will not allow. One
// more turn, naming the slip, turned that into a scene. Two turns is the ceiling, because every
// extra turn is another ten to twenty seconds of a chat box waiting.
export async function writeScene(
  writer: Writer,
  prompt: string,
  options: { seed?: number; timeoutMs?: number } = {},
): Promise<WriteResult> {
  let note = ''
  for (let tries = 1; tries <= 2; tries++) {
    const attempt = await once(writer, prompt, { ...options, note })
    if (!attempt.ok) return attempt
    const verdict = checkCode(attempt.scene.code)
    if (verdict.ok) return { ok: true, scene: { ...attempt.scene, tries } }
    if (tries === 2) return { ok: false, why: verdict.reason, raw: attempt.scene.code }
    note = `Your last answer was refused: ${verdict.reason}. Nothing outside the body exists where this runs. Answer again, in the same two labelled lines.`
  }
  return { ok: false, why: 'the scene writer did not answer' }
}
