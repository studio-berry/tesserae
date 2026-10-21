import * as THREE from 'three'
import { Rng } from '../engine/core'
import { passesContent } from './credit'
import { objaverseIndex } from './objaverse-fetch'
import { glbUrls, sketchfabUrl, type IndexRow } from './objaverse-index'
import { matchRows, pickRow, type Match } from './objaverse-match'
import type { PromptResult } from './prompt'
import { standUpright } from './orient'
import { hasSurface } from './soup'
import { loadUrl } from './url-loader'

// The Objaverse backend: a prompt is matched against a static index of model descriptions, and
// the winning model is fetched from the hub and drawn.
//
// It sits after the Commons model and before the Commons drawing. Commons is a small catalogue
// of clean STL files with an author and a licence on every one; the hub has far more models, so
// it answers more prompts, but its descriptions come from an automatic captioner and its
// quality varies, so the search that has the provenance on every file comes first.
//
// Nothing here needs a key. The hub is free and needs none, the index is a file the app ships,
// and a failure at any step falls through to the next backend.

export type ObjaverseOptions = {
  // which match to take, so a reroll steps through the matches
  step?: number
  rng?: Rng
  // how long the whole backend may take, rather than one request. Set by a test to make the
  // bound observable without waiting forty five seconds for it.
  budgetMs?: number
}

// Finds a model in the index and draws it.
//
// How long the whole backend may hold a prompt, rather than one request.
//
// A request is bounded at twelve seconds, but a match tries that across two addresses and two
// attempts, and a prompt takes twenty matches, so a hub that accepts a request and then never
// answers holds the chain for sixteen minutes before the drawing backend behind it gets a turn.
// The per-request bound protects one address; this protects the wait. It is checked where a
// match is about to start, so the worst case is the budget plus one model's own retries.
const HUB_BUDGET_MS = 45_000

// Every step can fail, and every failure means the chain moves on: no index, no match, a model
// the content rules refuse, a download that does not arrive, a model that cannot be parsed.
export const findObjaverse = async (query: string, options: ObjaverseOptions = {}): Promise<PromptResult | null> => {
  const index = await objaverseIndex()
  if (!index) return null
  const matches = matchRows(index.data ?? [], query, 20)
  if (!matches.length) return null
  const row = pickRow(matches, options.step ?? 0)
  if (!row) return null
  return drawRow(row, matches, index.revisions ?? {}, options, Date.now() + (options.budgetMs ?? HUB_BUDGET_MS))
}

// The next match, once the one that was tried has been set aside.
//
// The matches are stepped through in order, and each one that fails is dropped, so a refused
// row does not cost the prompt its other nineteen.
const nextMatch = (
  tried: IndexRow,
  matches: Match[],
  revisions: Record<string, string>,
  options: ObjaverseOptions,
  deadline: number
): Promise<PromptResult | null> => {
  const rest = matches.filter((m) => m.row.uid !== tried.uid)
  const next = rest[0]
  return next ? drawRow(next.row, rest, revisions, options, deadline) : Promise.resolve(null)
}

// The model a match points at, drawn.
//
// A match can fail in three ways: the content rules refuse it, the download does not arrive, or
// the model cannot be parsed. Every one of them means the next match gets a turn, rather than
// the whole prompt failing, because a prompt that matched twenty models should not be lost
// because the first one was refused.
const drawRow = async (
  row: IndexRow,
  matches: Match[],
  revisions: Record<string, string>,
  options: ObjaverseOptions,
  deadline: number
): Promise<PromptResult | null> => {
  // checked before a match starts rather than after it fails, so a hub that is merely slow
  // cannot spend the whole walk through the matches, and a backend behind this one still turns
  if (Date.now() >= deadline) return null
  // the same content rules as any other result, read over the title and the caption
  if (!passesContent(row.title, row.caption)) return nextMatch(row, matches, revisions, options, deadline)

  const urls = glbUrls(row, revisions['allenai/objaverse'] ?? 'main')
  let loaded
  for (const url of urls) {
    try {
      loaded = await loadUrl(url, row.title)
      break
    } catch {
      // the next address gets a turn, and then the next match
    }
  }
  if (!loaded) {
    // the model could not be fetched or parsed, so the next match gets a turn
    return nextMatch(row, matches, revisions, options, deadline)
  }
  // A model can fetch and parse and still hold nothing the sampler can read: line geometry, or
  // meshes with their visibility off. That emptiness is noticed in settle, which runs after the
  // backend chain has returned, where a throw ends the prompt instead of trying the next
  // backend. The contract says a backend never throws, so it is asked here, while the next match
  // and the backends after it are both still to come.
  if (!hasSurface(loaded.object)) return nextMatch(row, matches, revisions, options, deadline)
  // the model has to meet the style contract: Y up and its front towards the viewer. A model
  // that cannot be read is left as it is rather than turned wrongly.
  standUpright(loaded.object)

  return {
    object: loaded.object,
    title: row.title,
    detail: `objaverse · ${row.licence}`,
    twoSided: true,
    flat: false,
    source: { author: row.author, licence: row.licence, url: sketchfabUrl(row.uid) },
  }
}


