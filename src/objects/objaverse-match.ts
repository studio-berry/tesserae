import { indexTokens, rowTokens, type IndexRow } from './objaverse-index'

// The matcher: it decides which row of the index answers a prompt.
//
// The score is the share of the prompt's words the row holds. A row that holds every word is a
// full match; a row that holds one of three words is a weak one, and a weak match is not shown,
// because a prompt for "red sports car" should not answer with the first model that happens to
// mention "car".
//
// A row whose title agrees with its description outranks one that only matches the
// description. The prototype found the difference: a water tower captioned as "a lighthouse"
// matched the description but not the title, and the title is the name the author gave the
// model.

export type Match = {
  row: IndexRow
  score: number // the share of the prompt's words the row holds, from 0 to 1
  agree: boolean // the title holds the prompt's words too
  rank: number // where the row sits in the whole index, from 0, so the best rows are first
}

// A match below this share is weak. The prototype's ten prompts all scored at or above it.
export const CUTOFF = 0.6

// The rows of a prompt, best first.
//
// A prompt of one word needs a row that holds it. A prompt of several words needs a row that
// holds most of them, and the share rises with the number of words, so a three-word prompt
// needs more of itself answered than a one-word prompt does.
export const matchRows = (rows: IndexRow[], prompt: string, limit = 10): Match[] => {
  const want = new Set(indexTokens(prompt))
  if (!want.size) return []
  const out: Match[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const t = rowTokens(row)
    let found = 0
    for (const w of want) if (t.caption.has(w) || t.title.has(w)) found++
    if (!found) continue
    const score = found / want.size
    if (score < CUTOFF) continue
    const agree = [...want].every((w) => t.title.has(w) || !t.caption.has(w))
    out.push({ row, score, agree, rank: i })
  }
  // the rows that agree come first, then the score, then the order the index was built in,
  // which is the quality score and then the shortest caption, so the best model wins
  out.sort((a, b) => (b.agree ? 1 : 0) - (a.agree ? 1 : 0) || b.score - a.score || a.rank - b.rank)
  return out.slice(0, limit)
}

// The matches of a prompt, strongest first.
//
// The reroll steps through the matches rather than asking for the same one again, so pressing
// reroll gives a different model for the same prompt. The step wraps round, so every match
// comes round again.
export const pickRow = (matches: Match[], step: number): IndexRow | null => {
  if (!matches.length) return null
  return matches[((step % matches.length) + matches.length) % matches.length].row
}
