import { resultPasses } from '../safety/result'
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

// A result whose title or description fails the content rules is skipped, and the search moves
// on to the next one. The reason is never shown, because naming the word would defeat the rule.
export const passesContent = (...parts: (string | undefined)[]) =>
  !parts.some((p) => p && !resultPasses(p))

export type { Provenance, PromptResult }
