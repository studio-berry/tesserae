import { describe, expect, it } from 'vitest'
import { CALLS, judgeRequest, majority, parseVerdict, readEnv, TEMPERATURE } from './judge.ts'

describe('parseVerdict', () => {
  it('reads READ as a yes and keeps the reason', () => {
    expect(parseVerdict('READ Clear silhouette with spout and handle.')).toEqual({ reads: true, reason: 'Clear silhouette with spout and handle.' })
  })

  it('reads NOT as a no, however it is punctuated', () => {
    expect(parseVerdict('NOT — it is a blob with no spout').reads).toBe(false)
    expect(parseVerdict('**NOT**: does not read as a teapot').reads).toBe(false)
    expect(parseVerdict('not really, the shape is a cube').reads).toBe(false)
  })

  it('treats a hedged or unclear answer as a no', () => {
    expect(parseVerdict('It is hard to say, maybe a teapot').reads).toBe(false)
    expect(parseVerdict('').reads).toBe(false)
    expect(parseVerdict('The answer is READ').reads).toBe(false)
  })

  it('does not read a word that merely starts with read as a yes', () => {
    expect(parseVerdict('Reading the image, it is a lamp').reads).toBe(false)
  })
})

describe('majority', () => {
  it('needs more than half', () => {
    expect(majority([true, true, false])).toBe(true)
    expect(majority([true, false, false])).toBe(false)
    expect(majority([true])).toBe(true)
    expect(majority([])).toBe(false)
  })
})

describe('judgeRequest', () => {
  const body = judgeRequest(Buffer.from([1, 2, 3]), 'a teapot', 'a-model')

  it('asks the pinned question about the prompt with one image part', () => {
    const content = (body.messages[0] as { content: { type: string; text?: string; image_url?: { url: string } }[] }).content
    expect(content).toHaveLength(2)
    expect(content[0].text).toContain('Would an ordinary person recognise this as "a teapot"')
    expect(content[1].image_url?.url.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('pins the model, the temperature and the call count', () => {
    expect(body.model).toBe('a-model')
    expect(body.temperature).toBe(TEMPERATURE)
    expect(CALLS).toBe(3)
  })
})

describe('readEnv', () => {
  it('reads keys, skips comments, and keeps everything after the first equals', () => {
    const env = readEnv('# a comment\r\nOPENCODE_ZEN_API_KEY=abc=def\r\n\r\nEMPTY=\r\n')
    expect(env.OPENCODE_ZEN_API_KEY).toBe('abc=def')
    expect(env.EMPTY).toBe('')
    expect(Object.keys(env)).toHaveLength(2)
  })
})
