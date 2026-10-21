import { resultPasses } from '../safety/result'
import { scanWords } from '../safety'
import type { Provenance, PromptResult } from './prompt'

// The credit a source has to carry. CC BY and CC BY-SA both ask for the author, the licence, a
// link to the source and a note that the work was changed, so the app shows all four wherever a
// searched model or drawing came from.
//
// The note says the work was changed because it was: every model is resampled into glyphs, so
// the ASCII is a rendering of the original rather than the original.
export const CREDIT_NOTE = 'rendered as ASCII'

export type Credit = {
  author: string
  licence: string
  url: string
}

// The credit as one line of text, for a caption or an export header. The link comes last so the
// sentence reads before the URL.
export const creditLine = (c: Credit) => `${c.author} · ${c.licence} · ${CREDIT_NOTE} · ${c.url}`

// The same credit, split so a caption can render the link as a link.
export const creditParts = (c: Credit) => ({
  author: c.author,
  licence: c.licence,
  note: CREDIT_NOTE,
  url: c.url,
})

// The credit with its words scanned.
//
// The author, the licence and the note all come from a third party, and a name can hold a word
// the prompt box would refuse, so they are scanned. The link is not: a scan replaces a letter
// in place, so a scanned link would point at nothing, and the licence asks for a link to the
// source.
export const scanCredit = (credit: Credit | null, ramp: string) => {
  if (!credit) return { words: '', url: '' }
  const { author, licence, note } = creditParts(credit)
  return { words: scanWords(`${author} · ${licence} · ${note}`, ramp), url: credit.url }
}

// The credit as one line, for a caption or a caption strip.
export const creditText = (credit: Credit | null, ramp: string) => {
  const c = scanCredit(credit, ramp)
  return c.words ? `${c.words} · ${c.url}` : ''
}

// A result whose title or description fails the content rules is skipped, and the search moves
// on to the next one. The reason is never shown, because naming the word would defeat the rule.
export const passesContent = (...parts: (string | undefined)[]) =>
  !parts.some((p) => p && !resultPasses(p))

export type { Provenance, PromptResult }
