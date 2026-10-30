import { describe, expect, it } from 'vitest'
import {
  checkClean,
  dirtyFrom,
  metaFor,
  parseArgs,
  plan,
  rebuildArgs,
  resumeConflict,
  uidOf,
  type Provenance,
} from './procedural-export-lib.ts'
import { checkParts, checkRuns, defaultVerify, deletable, partsReadBy, type Part } from './procedural-clean.ts'

const items = ['teapot', 'knot', 'shell'].map((id) => ({ id }))
const prov = (over: Partial<Provenance> = {}): Provenance => ({ commit: 'a'.repeat(40), dirty: [], bundle: 'b'.repeat(64), three: '0.176.0', node: 'v24', ...over })

describe('the export arguments', () => {
  it('keeps colour unless --no-rgb, and refuses dirty source unless --allow-dirty', () => {
    expect(parseArgs(['--out', 'x']).rgb).toBe(true)
    expect(parseArgs(['--out', 'x', '--no-rgb']).rgb).toBe(false)
    expect(parseArgs(['--out', 'x']).allowDirty).toBe(false)
    expect(parseArgs(['--out', 'x', '--allow-dirty']).allowDirty).toBe(true)
    expect(() => parseArgs(['--out', 'x', '--count', '0'])).toThrow(/at least 1/)
  })
})

describe('the row plan', () => {
  it('sweeps the items seed by seed, so a part started at a seed never meets the next part', () => {
    const a = plan(items, 6, 0).map(uidOf)
    const b = plan(items, 6, 2).map(uidOf)
    expect(a).toEqual(['teapot-s0', 'knot-s0', 'shell-s0', 'teapot-s1', 'knot-s1', 'shell-s1'])
    expect(a.filter((u) => b.includes(u))).toEqual([])
  })

  it('gives the same first rows whatever the count, which is what lets one shard be rebuilt alone', () => {
    expect(plan(items, 4, 7).map(uidOf)).toEqual(plan(items, 100, 7).slice(0, 4).map(uidOf))
  })
})

describe('the record of the code', () => {
  it('reads changed paths out of git status, taking the new name of a rename', () => {
    expect(dirtyFrom(' M src/objects/library.ts\nR  scripts/a.ts -> scripts/b.ts\n')).toEqual(['src/objects/library.ts', 'scripts/b.ts'])
    expect(dirtyFrom('')).toEqual([])
  })

  it('refuses uncommitted source unless asked, and names the files', () => {
    expect(() => checkClean(prov({ dirty: ['src/core/sample.ts'] }), false)).toThrow(/src\/core\/sample\.ts/)
    expect(() => checkClean(prov({ dirty: ['src/core/sample.ts'] }), true)).not.toThrow()
    expect(() => checkClean(prov(), false)).not.toThrow()
  })

  it('writes the commit, the build and the colour setting into meta.json', () => {
    const args = parseArgs(['--out', 'x', '--count', '6', '--no-rgb'])
    const meta = metaFor(args, plan(items, 6, 0), items, prov())
    expect(meta.provenance.commit).toBe('a'.repeat(40))
    expect(meta.rgb).toBe(false)
    expect(meta.channels.rgb).toBeUndefined()
  })
})

describe('resuming into a folder', () => {
  const args = parseArgs(['--out', 'x', '--count', '6'])
  const now = metaFor(args, plan(items, 6, 0), items, prov())

  it('resumes the same run', () => {
    expect(resumeConflict(now, now)).toBeNull()
  })

  it('refuses another commit, another build, another colour setting or a folder from before the record', () => {
    expect(resumeConflict({ ...now, provenance: prov({ commit: 'c'.repeat(40) }) }, now)).toMatch(/commit/)
    expect(resumeConflict({ ...now, provenance: prov({ bundle: 'd'.repeat(64) }) }, now)).toMatch(/build/)
    expect(resumeConflict({ ...now, provenance: prov({ three: '0.177.0' }) }, now)).toMatch(/three/)
    expect(resumeConflict({ ...now, rgb: false }, now)).toMatch(/colour/)
    const { provenance: _, ...old } = now
    expect(resumeConflict(old, now)).toMatch(/before/)
  })
})

describe('the rebuild command', () => {
  it('asks for the first shard, or for the whole part, with the settings that wrote it', () => {
    const args = parseArgs(['--out', 'x', '--count', '2500', '--seed', '13889', '--shard', '1000', '--no-rgb'])
    const meta = metaFor(args, plan(items, 2500, 13889), items, prov())
    expect(rebuildArgs(meta, 'v', true)).toEqual(['--out', 'v', '--count', '1000', '--seed', '13889', '--shard', '1000', '--points', '4096', '--limit-items', '3', '--no-rgb'])
    expect(rebuildArgs(meta, 'v', false)[3]).toBe('2500')
  })
})

describe('the clean checks', () => {
  const part = (name: string, p: Partial<Provenance> = {}): Part => {
    const meta = metaFor(parseArgs(['--out', name]), plan(items, 3, 0), items, prov(p))
    return { name, folder: `/data/${name}`, meta }
  }

  it('takes the one commit and build every part shares', () => {
    expect(checkParts([part('part-0'), part('part-1')]).commit).toBe('a'.repeat(40))
  })

  it('refuses parts from uncommitted code, from two commits, from two builds, or without a record', () => {
    expect(() => checkParts([part('part-0', { dirty: ['src/x.ts'] })])).toThrow(/uncommitted/)
    expect(() => checkParts([part('part-0'), part('part-1', { commit: 'c'.repeat(40) })])).toThrow(/one commit/)
    expect(() => checkParts([part('part-0'), part('part-1', { bundle: 'e'.repeat(64) })])).toThrow(/different builds/)
    expect(() => checkParts([part('part-0'), part('part-1', { three: '0.177.0' })])).toThrow(/versions of three/)
    const bare = part('part-0')
    delete (bare.meta as { provenance?: unknown }).provenance
    expect(() => checkParts([bare])).toThrow(/no record/)
    expect(() => checkParts([])).toThrow(/no procedural/)
  })

  it('refuses while a run has not finished', () => {
    expect(() => checkRuns([{ dir: 'r', train: { finished: '2026-11-01T00:00:00Z' } }])).not.toThrow()
    expect(() => checkRuns([{ dir: 'r', train: {} }])).toThrow(/not finished/)
  })

  it('matches the folders a run read to the parts', () => {
    const parts = [part('part-0'), part('part-1')]
    const run = { dir: 'r', train: { finished: 'x', data: [{ manifests: [{ folder: '/data/part-1' }, { folder: '/data/objaverse' }] }] } }
    expect(partsReadBy(run, parts)).toEqual(['part-1'])
  })

  it('deletes only the point and colour arrays, and checks the first and last part by default', () => {
    expect(deletable(['meta.json', 'shard-00001.points.npy', 'shard-00000.jsonl', 'shard-00000.rgb.npy', 'shard-00000.failed.jsonl', 'shard-00000.points.npy.part'])).toEqual([
      'shard-00000.rgb.npy',
      'shard-00001.points.npy',
    ])
    expect(defaultVerify([part('part-0'), part('part-1'), part('part-7')])).toEqual(['part-0', 'part-7'])
    expect(defaultVerify([part('part-0')])).toEqual(['part-0'])
  })
})
