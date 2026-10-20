import { blockedToken } from './index.ts'
import { checkContent } from './content.ts'

// The content rule for a result that came back from a search rather than from the prompt box.
//
// A title, a tag list or a caption can carry a word the prompt box would refuse, and it can name
// a piece of somebody else's world. Both are refused here, so a searched result is held to the
// same rule as a typed one.
//
// The rule is the whole-token one, with no run scan. The run scan is for typed input, where a
// word written with its letters held apart is typed on purpose, and for exported ASCII, where
// the letters of a word sit side by side in a grid. A title is neither: it is words, and
// "book shelf" is a bookshelf rather than a word held apart. So the rule matches a whole token
// and nothing else, and it does not refuse a fish called "Seabass", a "Low Poly AK47 Assault
// Rifle" or a "Tropical" palm for the letters inside them.
//
// The matched word is never returned. The caller learns only that the row was refused, so the
// word cannot leak into a caption or an export.
export const checkResult = (text: string): { ok: true } | { ok: false; reason: string } => {
  if (blockedToken(text)) return { ok: false, reason: RESULT_REFUSAL }
  const verdict = checkContent(text)
  if (!verdict.ok) return verdict
  return { ok: true }
}

// Whether a row of text passes. True means it may be shown.
export const resultPasses = (text: string) => checkResult(text).ok

// The only sentence a refusal shows for a searched result.
export const RESULT_REFUSAL = 'That result is not allowed here.'
