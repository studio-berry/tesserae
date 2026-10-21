import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isExplicit, isFanArt } from '../safety/content.ts'
import { resultPasses } from '../safety/result.ts'
import {
  INDEX_DIR,
  INDEX_FILE,
  INDEX_URL,
  glbPath,
  glbUrl,
  sketchfabUrl,
  type Index,
} from './objaverse-index.ts'

// The index the build wrote. It is committed, so this test reads the real file rather than a
// fixture, and a build that changed shape would fail here.
const here = dirname(fileURLToPath(import.meta.url))
const indexPath = resolve(here, '..', '..', 'public', INDEX_DIR, INDEX_FILE)

// The index is read once. It is a 20,000 row file, and reading it again for every test is
// most of the time this file spends.
let cached: Index | null = null
const readIndex = (): Index => {
  if (!cached) {
    cached = JSON.parse(gunzipSync(readFileSync(indexPath)).toString('utf8')) as Index
  }
  return cached
}

describe('the objaverse index file', () => {
  it('sits at the path the app fetches', () => {
    expect(INDEX_DIR).toBe('objaverse')
    expect(INDEX_FILE).toBe('index.json.gz')
    expect(INDEX_URL).toBe('objaverse/index.json.gz')
  })

  it('carries the revisions it was read at', () => {
    const index = readIndex()
    expect(index.revisions['allenai/objaverse']).toBe('556637099bf4fa79ea7b239d0d9c328b8a2e9ac8')
    expect(index.revisions['tiange/Cap3D']).toBe('0f05a726ff7eb3db93444a4efc65f0552bce84a4')
    expect(index.revisions['cindyxl/ObjaversePlusPlus']).toBe('ac892800fd29db09c2b560bdfdd3c57253045836')
    // every revision is a commit, not a branch
    for (const sha of Object.values(index.revisions)) expect(sha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('holds the rows it says it holds', () => {
    const index = readIndex()
    expect(index.rows).toBe(index.data.length)
    expect(index.rows).toBeGreaterThan(0)
    expect(index.version).toContain('objaverse-')
  })

  it('gives every row the fields the app reads', () => {
    const index = readIndex()
    // Every row rather than a slice. The name of this test promised every row while the loop
    // reached 500 of them, and the first uid that is not 32 characters sits at 1380, so the
    // wrong length below was never seen.
    //
    // The uid is checked for what a url needs, not for one length. Objaverse uids are usually
    // 32 characters but the source really does hold 26 and 27 character ones, and a 27
    // character one answers on the hub while a fake one of the same length does not, so the
    // length is a real range rather than a single expected value.
    for (const row of index.data) {
      expect(row.uid).toMatch(/^[0-9a-zA-Z]+$/)
      expect(row.uid.length).toBeGreaterThanOrEqual(16)
      expect(row.uid.length).toBeLessThanOrEqual(32)
      expect(row.title.length).toBeGreaterThan(0)
      expect(row.title.length).toBeLessThanOrEqual(80)
      expect(row.caption.length).toBeGreaterThan(0)
      expect(row.chunk).toMatch(/^\d{3}-\d{3}$/)
      expect(row.author.length).toBeGreaterThan(0)
      expect(row.licence).toBe('CC BY 4.0')
    }
  })

  // The rule is read over every row, and the rows are 20,000 of them, so this takes longer
  // than the suite's default. A machine under load takes a minute, and the test is worth the
  // wait: it is the one that says the build and the app agree.
  it('keeps only the rows the app may show', { timeout: 180_000 }, () => {
    const index = readIndex()
    // the app's own rule, over every row rather than a slice, because a slice cannot see a
    // row further down the index. The build and the app have to agree about every row they
    // both hold, so the rule is the one the app applies.
    const refused = index.data.filter((row) => !resultPasses(`${row.title} ${row.caption}`))
    expect(refused.map((r) => r.uid)).toEqual([])
    // and the fan art and explicit guards, which are part of the same rule
    for (const row of index.data) {
      const text = `${row.title} ${row.caption}`
      expect(isFanArt(text), row.uid).toBe(false)
      expect(isExplicit(text), row.uid).toBe(false)
    }
  })

  it('points at a glb on the hub', () => {
    const index = readIndex()
    const row = index.data[0]
    const path = glbPath(row)
    expect(path).toBe(`glbs/${row.chunk}/${row.uid}.glb`)
    const url = glbUrl(row, index.revisions['allenai/objaverse'])
    expect(url).toBe(
      `https://huggingface.co/datasets/allenai/objaverse/resolve/${index.revisions['allenai/objaverse']}/glbs/${row.chunk}/${row.uid}.glb`,
    )
    expect(sketchfabUrl(row.uid)).toBe(`https://sketchfab.com/3d-models/${row.uid}`)
  })


  // A note that publishes a hash can drift away from the file it names. The doc said one hash
  // while the tree held another after the index was rebuilt, and nothing failed, so a reader who
  // compared them would find a mismatch and no explanation. The two are compared here so the
  // note cannot disagree with the file it describes.
  it('matches the hash the doc publishes for it', () => {
    const shipped = createHash('sha256').update(readFileSync(indexPath)).digest('hex')
    const doc = readFileSync(resolve(here, '..', '..', 'docs', 'objaverse-index.md'), 'utf8')
    const published = doc.match(/index in the tree is sha256\s+`([0-9a-f]{64})`/)
    expect(published, 'the doc publishes a sha256 for the index').not.toBeNull()
    expect(shipped).toBe(published![1])
  })

  it('has no title that a reader would have to squint at', () => {
    const index = readIndex()
    // all 20,000 rather than the first 2,000, because a title further down the index is read
    // by the same caption and the check costs nothing
    for (const row of index.data) {
      // no underscores, no doubled spaces, no leading or trailing space
      expect(row.title).not.toMatch(/_/)
      expect(row.title).not.toMatch(/ {2}/)
      expect(row.title).toBe(row.title.trim())
    }
  })
})
