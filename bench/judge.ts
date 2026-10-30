// The vision judge: one yes-or-no question per image, three times, majority wins.
//
// The judge is the instrument every number in the plan is measured with, so it is a contract rather
// than a helper: the model is pinned, the question is fixed, the temperature is 0.7 so the three
// calls are independent, and the reply is parsed strictly enough that an answer which hedges is a
// NOT. Its agreement with a human eye is measured before anything trusts it (bench/agree.ts).

export const JUDGE_URL = process.env.BENCH_JUDGE_URL?.trim() || 'https://opencode.ai/zen/go/v1/chat/completions'

// Pinned by a probe over the gateway (docs/bench.md): the fastest model that answered a plain
// yes-or-no question about a render correctly. A judge that changes underneath the benchmark breaks
// every comparison, so the default is written here and only BENCH_JUDGE_MODEL moves it.
export const JUDGE_MODEL = process.env.BENCH_JUDGE_MODEL?.trim() || 'claude-haiku-5-5'

export const CALLS = 3
export const TEMPERATURE = 0.7

export type Verdict = { reads: boolean; reason: string }

export const question = (prompt: string) =>
  `The image is a 3D object drawn as small glyphs, dots or lettering. ` +
  `Would an ordinary person recognise this as "${prompt}"? ` +
  `Judge the shape and its distinctive parts, not the detail: a coarse render that still has the body, ` +
  `limbs, spout or other parts that name the thing is a READ. A different object, or a shapeless mass, is a NOT. ` +
  `Begin with exactly one of those two words, then give at most ten words of reason on the same line.`

// Strict on the first token: READ wins only when the first word is READ. A reply that hedges or
// opens with anything else is a refusal, because a judge that is allowed to be vague is not an
// instrument.
export function parseVerdict(text: string): Verdict {
  const flat = text.replace(/\s+/g, ' ').trim()
  const first = flat.match(/^[^A-Za-z]*([A-Za-z]+)/)?.[1]?.toUpperCase() ?? ''
  const reads = first === 'READ'
  const rest = flat.replace(/^[^A-Za-z]*[A-Za-z]+[ .:,-]*/, '')
  return { reads, reason: rest.slice(0, 120) }
}

export const majority = (votes: boolean[]): boolean => votes.filter(Boolean).length * 2 > votes.length

export type JudgeRequest = { model: string; max_tokens: number; temperature: number; messages: unknown[] }

// The body is built here rather than inline at the call site so the test can hold its shape: one
// text part, one image part, the pinned model, and the temperature that makes the calls independent.
export function judgeRequest(png: Buffer, prompt: string, model = JUDGE_MODEL, maxTokens = 400): JudgeRequest {
  return {
    model,
    // a reasoning model spends completion tokens before it answers, and a cap that is too low comes
    // back as an empty string rather than a short answer: 400 leaves room for the trace and the
    // verdict, and the parse still needs one of two words
    max_tokens: maxTokens,
    temperature: TEMPERATURE,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: question(prompt) },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } },
      ],
    }],
  }
}

type Reply = { choices?: { finish_reason?: string; message?: { content?: string } }[]; error?: { message?: string } }

export const readEnv = (text: string): Record<string, string> =>
  Object.fromEntries(
    text.split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  )

export type Judge = { key: string; url: string; model: string }

export const judgeFrom = (env: Record<string, string | undefined>): Judge | null => {
  const key = env.OPENCODE_ZEN_API_KEY?.trim()
  if (!key) return null
  return { key, url: env.BENCH_JUDGE_URL?.trim() || JUDGE_URL, model: env.BENCH_JUDGE_MODEL?.trim() || JUDGE_MODEL }
}

async function ask(judge: Judge, png: Buffer, prompt: string): Promise<Verdict> {
  let last = ''
  for (let attempt = 0; attempt < 4; attempt++) {
    const cap = attempt >= 2 ? 1200 : 400 // a reply that ran out of room gets a bigger room
    let res: Response
    try {
      res = await fetch(judge.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${judge.key}`,
          'x-opencode-session': 'gen-ascii-bench',
        },
        body: JSON.stringify(judgeRequest(png, prompt, judge.model, cap)),
        signal: AbortSignal.timeout(120_000),
      })
    } catch (err) {
      last = (err as Error).message
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
      continue
    }
    if (res.status === 429 || res.status >= 500) {
      last = `the judge answered ${res.status}`
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
      continue
    }
    if (!res.ok) return { reads: false, reason: `the judge answered ${res.status}` }
    const body = (await res.json()) as Reply
    const choice = body.choices?.[0]
    const content = choice?.message?.content ?? ''
    if (!content) { last = body.error?.message ?? `the judge said nothing (${choice?.finish_reason ?? 'no choice'})`; continue }
    return parseVerdict(content)
  }
  return { reads: false, reason: last.slice(0, 120) }
}

export type Judgement = { reads: boolean; readsThumb: boolean; votes: boolean[]; reason: string }

// Three independent calls, each pair of images judged by the same question. The thumbnail's vote is
// kept apart: "reads at full size" and "reads at a fifth of the size" are different claims, and the
// plan measures both.
export async function judge(judge: Judge, shot: Buffer, thumb: Buffer, prompt: string): Promise<Judgement> {
  const calls = await Promise.all([
    ask(judge, shot, prompt), ask(judge, shot, prompt), ask(judge, shot, prompt),
  ])
  const votes = calls.map((c) => c.reads)
  const thumbs = await Promise.all([
    ask(judge, thumb, prompt), ask(judge, thumb, prompt), ask(judge, thumb, prompt),
  ])
  const winner = calls.find((c) => c.reads === majority(votes)) ?? calls[0]
  return {
    reads: majority(votes),
    readsThumb: majority(thumbs.map((t) => t.reads)),
    votes,
    reason: winner?.reason ?? '',
  }
}
