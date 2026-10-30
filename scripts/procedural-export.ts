// Exports the library's own procedural forms as training data: each item built at a seed, sampled
// into points with normals and colours by the same code the app draws with, and written in the
// shard format `scripts/objaverse-export.ts` writes, so one loader reads both.
//
//   npm run export:procedural -- --out .cache/procedural-smoke --count 200
//   npm run export:procedural -- --out .cache/procedural/part-0 --count 125001 --seed 0 --no-rgb
//
// --no-rgb leaves the colour arrays out: most forms carry no colour of their own and the loader
// does not read them. meta.json records the commit and the build that ran, and the export refuses
// to start from uncommitted source unless --allow-dirty says the shards will never be rebuilt.
//
// A cloud is one library item at one seed, so the rows are (item, seed) pairs taken item by item
// for seed 0, then seed 1, and so on: raising --count only appends rows, and the same --seed and
// --count always produce the same clouds.
//
// There is no third-party source and nothing to screen for: these clouds are generated here.
// docs/procedural-data.md has the caption scheme, the licence position and the numbers.

import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { mulberry32 } from '../src/engine/core.ts'
import { normalize, sampleSoup, type Samples } from '../src/core/sample.ts'
import { LIBRARY, type LibItem } from '../src/objects/library.ts'
import { surfaceFrom } from '../src/objects/soup.ts'
import { npy, srgbByte, toHalf } from './objaverse-export-format.ts'
import { captionFor } from './procedural-captions.ts'
import {
  checkClean,
  metaFor,
  parseArgs,
  plan,
  provenanceOf,
  resumeConflict,
  shardName,
  uidOf,
  type Meta,
  type Planned as Row,
} from './procedural-export-lib.ts'

type Planned = Row<LibItem>

type Cloud = { s: Samples; tris: number; caption: string }

// One cloud, from the item's build to its samples. The item is built once and described from that
// same build, so the caption cannot drift from the shape it names.
const cloudOf = (row: Planned, points: number): Cloud => {
  const built = row.item.build(mulberry32(row.seed), row.seed)
  const { soup } = surfaceFrom(built.object)
  if (!soup || soup.tris === 0) throw new Error('no surface')
  // surfaceFrom leaves the form at the stage's radius, 1.9; the training space is the unit
  // sphere, which is what the Objaverse export writes, so a model sees one scale
  normalize(soup.pos, 1)
  const s = sampleSoup(soup, points, mulberry32(row.seed))
  if (s.count !== points) throw new Error(`sampled ${s.count} of ${points} points`)
  for (const v of s.pos) if (!Number.isFinite(v)) throw new Error('a point is not finite')
  for (const v of s.nrm) if (!Number.isFinite(v)) throw new Error('a normal is not finite')
  return { s, tris: soup.tris, caption: captionFor(row.item.id, built, row.seed) }
}

const writeShard = async (out: string, k: number, rows: Planned[], points: number, withRgb: boolean) => {
  const kept: { row: Planned; cloud: Cloud }[] = []
  const failed: { uid: string; why: string }[] = []
  for (const row of rows) {
    try {
      kept.push({ row, cloud: cloudOf(row, points) })
    } catch (err) {
      failed.push({ uid: uidOf(row), why: (err as Error).message })
    }
  }

  const n = kept.length
  const geo = new Uint16Array(n * points * 6)
  const rgb = withRgb ? new Uint8Array(n * points * 3).fill(255) : null
  kept.forEach(({ cloud }, i) => {
    const { s } = cloud
    for (let p = 0; p < points; p++) {
      const g = (i * points + p) * 6
      for (let d = 0; d < 3; d++) {
        geo[g + d] = toHalf(s.pos[p * 3 + d])
        geo[g + 3 + d] = toHalf(s.nrm[p * 3 + d])
      }
      if (rgb && s.col) for (let d = 0; d < 3; d++) rgb[(i * points + p) * 3 + d] = srgbByte(s.col[p * 3 + d])
    }
  })

  const name = shardName(k)
  const files: [string, Uint8Array | string][] = [
    [`${name}.points.npy`, npy('<f2', [n, points, 6], new Uint8Array(geo.buffer))],
    ...(rgb ? [[`${name}.rgb.npy`, npy('|u1', [n, points, 3], rgb)] as [string, Uint8Array]] : []),
    [`${name}.failed.jsonl`, failed.map((f) => JSON.stringify(f)).join('\n') + (failed.length ? '\n' : '')],
    [
      `${name}.jsonl`,
      kept
        .map(({ row, cloud }) =>
          JSON.stringify({
            uid: uidOf(row),
            title: row.item.name,
            caption: cloud.caption,
            author: row.item.id,
            licence: 'CC0-1.0',
            url: `procedural://${row.item.id}/${row.seed}`,
            triangles: cloud.tris,
            colored: !!cloud.s.col,
            textured: false,
          }),
        )
        .join('\n') + (n ? '\n' : ''),
    ],
  ]
  // the manifest of the shard goes last, so a shard counts as written only once every file is in
  // place and a stopped run resumes at the first one missing
  for (const [file, body] of files) {
    await writeFile(join(out, `${file}.part`), body)
    await rename(join(out, `${file}.part`), join(out, file))
  }
  return { kept: n, failed }
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const items = LIBRARY.slice(0, args.limitItems || LIBRARY.length)
  const rows = plan(items, args.count, args.seed)
  const out = resolve(args.out)

  // the code that runs is recorded before anything is written, and a run from uncommitted source
  // stops here unless it was asked for
  const provenance = provenanceOf(process.cwd(), process.argv[1])
  checkClean(provenance, args.allowDirty)
  const meta = metaFor(args, rows, items, provenance)
  await mkdir(out, { recursive: true })
  const metaPath = join(out, 'meta.json')
  if (existsSync(metaPath)) {
    const conflict = resumeConflict(JSON.parse(await readFile(metaPath, 'utf8')) as Partial<Meta>, meta)
    if (conflict) throw new Error(`${out} holds an export with a different ${conflict}; use another --out`)
  } else {
    await writeFile(metaPath, JSON.stringify(meta, null, 2) + '\n')
  }
  const at = provenance.commit.slice(0, 12) + (provenance.dirty.length ? ` with ${provenance.dirty.length} uncommitted changes` : '')

  const shards = Math.ceil(rows.length / args.shard)
  console.log(`# ${rows.length.toLocaleString()} clouds from ${items.length} items, ${shards} shards of ${args.shard}, ${args.points} points, into ${out}, at ${at}${args.rgb ? '' : ', no colour'}`)
  const started = Date.now()
  let kept = 0
  let lost = 0
  for (let k = 0; k < shards; k++) {
    if (existsSync(join(out, `${shardName(k)}.jsonl`))) {
      console.log(`  ${shardName(k)} already written`)
      continue
    }
    const done = await writeShard(out, k, rows.slice(k * args.shard, (k + 1) * args.shard), args.points, args.rgb)
    kept += done.kept
    lost += done.failed.length
    for (const f of done.failed) console.log(`  ${f.uid}: ${f.why}`)
    console.log(`  ${shardName(k)}: ${done.kept} clouds, ${done.failed.length} failed`)
  }
  const secs = ((Date.now() - started) / 1000).toFixed(0)
  console.log(`# ${kept.toLocaleString()} written, ${lost.toLocaleString()} failed in ${secs} s`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
