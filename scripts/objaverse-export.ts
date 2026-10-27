// Exports the Objaverse models as training data: each model sampled into points with normals and
// colours, through the same flattening and sampler the app draws with, in shards that numpy opens
// directly.
//
//   npm run export:objaverse -- --limit 200
//
// The rows come from an index file that has been through every content step, the image
// classifier included. The shipped index is the default, because the classifier has looked at
// every model in it. A larger index (`npm run index:objaverse -- --limit 0 --out <file>`) holds
// models the classifier never saw, so it is refused unless a list of the uids that were screened
// comes with it, and only those rows are exported.
//
// The export is a stream: a model is fetched, parsed, sampled and dropped, so nothing but the
// shard being written is held. A shard is written whole and renamed into place, so a run that is
// stopped resumes at the first shard that is missing.
//
// docs/training-export.md has the format, the numbers and how to read it from python.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

import { mulberry32 } from '../src/engine/core.ts'
import { passesContent } from '../src/objects/credit.ts'
import { glbUrls, sketchfabUrl, type Index, type IndexRow } from '../src/objects/objaverse-index.ts'
import { normalize, sampleSoup } from '../src/objects/sample.ts'
import { soupFrom } from '../src/objects/soup.ts'
import { countTriangles, fetchModel, MAX_BYTES, MAX_TRIS } from '../src/objects/url-loader.ts'
import { npy, srgbByte, stripTextures, toHalf } from './objaverse-export-format.ts'

const SHIPPED = 'public/objaverse/index.json.gz'

// Bumped when the meaning of a shard changes, so a resumed run never mixes two formats.
const FORMAT = 1

type Args = {
  index: string
  screened?: string
  out: string
  points: number
  shard: number
  limit: number
  workers: number
}

const parseArgs = (argv: string[]): Args => {
  const a: Args = { index: SHIPPED, out: '.cache/training/objaverse', points: 4096, shard: 1000, limit: 0, workers: 6 }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    const value = () => {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) throw new Error(`${k} needs a value`)
      return v
    }
    // a whole number, at least `min`: a typo stops the run rather than turning into "no limit"
    const count = (min: number) => {
      const v = value()
      const n = Number(v)
      // a run of digits too long for a double is Infinity, which the digit test alone lets through
      if (!/^\d+$/.test(v) || !Number.isSafeInteger(n) || n < min) throw new Error(`${k} must be a whole number of at least ${min}, not ${v}`)
      return n
    }
    if (k === '--index') a.index = value()
    else if (k === '--screened') a.screened = value()
    else if (k === '--out') a.out = value()
    else if (k === '--points') a.points = count(1)
    else if (k === '--shard') a.shard = count(1)
    else if (k === '--limit') a.limit = count(0)
    else if (k === '--workers') a.workers = count(1)
    else throw new Error(`unknown option ${k}`)
  }
  return a
}

type Sampled = {
  pos: Float32Array
  nrm: Float32Array
  col: Float32Array | null
  tris: number
  textured: boolean
}

type Outcome = { ok: true; sampled: Sampled } | { ok: false; why: string }

const fail = (why: string): Outcome => ({ ok: false, why })

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)

// The seed a model is sampled with, taken from its uid, so a rerun gives the same points.
const seedOf = (uid: string) => parseInt(uid.slice(0, 8), 16) || 1

// The download. The hub resets a first request often enough that a retry is the normal path, so
// each address gets three attempts before the next one is tried.
const download = async (row: IndexRow, revision: string): Promise<ArrayBuffer | null> => {
  for (const url of glbUrls(row, revision)) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await fetchModel(url, 30_000, MAX_BYTES)
      } catch {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
      }
    }
  }
  return null
}

// One model, from the hub to its points. Every way it can fail is named, so the failure file
// says what the export lost and why.
const exportRow = async (row: IndexRow, revision: string, points: number): Promise<{ outcome: Outcome; bytes: number }> => {
  if (!passesContent(row.title, row.caption)) return { outcome: fail('content rules'), bytes: 0 }
  const buf = await download(row, revision)
  if (!buf) return { outcome: fail('download'), bytes: 0 }
  const bytes = buf.byteLength
  let stripped
  try {
    stripped = stripTextures(buf)
  } catch (err) {
    return { outcome: fail(`glb: ${(err as Error).message}`), bytes }
  }
  // the draco decoder runs in a web worker, which node does not have
  if (stripped.draco) return { outcome: fail('draco compressed'), bytes }
  let scene
  try {
    scene = (await loader.parseAsync(stripped.glb, '')).scene
  } catch (err) {
    return { outcome: fail(`parse: ${(err as Error).message}`), bytes }
  }
  const tris = countTriangles(scene)
  if (tris > MAX_TRIS) return { outcome: fail(`too many triangles (${tris})`), bytes }
  // The model keeps the orientation its file gives it, and the app's standUpright is not run.
  // glTF is Y up by its spec, and standUpright reads "standing" as taller than wide, so it turns
  // a bus or a rifle onto its end: on the first 24 rows it stood both buses and the rifle up.
  // A generator learns the pose of whatever it is shown, so the data keeps the file's own.
  // the sampler is seeded by uid, so a throw here would repeat on every rerun: it is caught and
  // named, rather than losing the shard and stopping the run at the same row each time
  try {
    const { soup } = soupFrom(scene)
    if (!soup || soup.tris === 0) return { outcome: fail('no surface'), bytes }
    // the unit sphere rather than the stage's radius: a model trains on unit coordinates, and the
    // stage scales whatever it is given to its own radius anyway
    normalize(soup.pos, 1)
    const s = sampleSoup(soup, points, mulberry32(seedOf(row.uid)))
    if (s.count !== points) return { outcome: fail(`sampled ${s.count} of ${points} points`), bytes }
    for (const v of s.pos) if (!Number.isFinite(v)) return { outcome: fail('a point is not finite'), bytes }
    for (const v of s.nrm) if (!Number.isFinite(v)) return { outcome: fail('a normal is not finite'), bytes }
    return { outcome: { ok: true, sampled: { pos: s.pos, nrm: s.nrm, col: s.col, tris, textured: stripped.textured } }, bytes }
  } catch (err) {
    return { outcome: fail(`sample: ${(err as Error).message}`), bytes }
  }
}

// The rows a shard holds: the index order, cut into fixed runs, so shard k always means the same
// rows and a resumed run picks up exactly where the last one stopped.
const shardName = (k: number) => `shard-${String(k).padStart(5, '0')}`

const writeShard = async (out: string, k: number, rows: IndexRow[], results: Outcome[], points: number) => {
  const kept: { row: IndexRow; s: Sampled }[] = []
  const failed: { uid: string; why: string }[] = []
  results.forEach((r, i) => (r.ok ? kept.push({ row: rows[i], s: r.sampled }) : failed.push({ uid: rows[i].uid, why: r.why })))

  const n = kept.length
  const geo = new Uint16Array(n * points * 6)
  const rgb = new Uint8Array(n * points * 3).fill(255)
  kept.forEach(({ s }, i) => {
    for (let p = 0; p < points; p++) {
      const g = (i * points + p) * 6
      for (let d = 0; d < 3; d++) {
        geo[g + d] = toHalf(s.pos[p * 3 + d])
        geo[g + 3 + d] = toHalf(s.nrm[p * 3 + d])
      }
      if (s.col) for (let d = 0; d < 3; d++) rgb[(i * points + p) * 3 + d] = srgbByte(s.col[p * 3 + d])
    }
  })

  const name = shardName(k)
  const files: [string, Uint8Array | string][] = [
    [`${name}.points.npy`, npy('<f2', [n, points, 6], new Uint8Array(geo.buffer))],
    [`${name}.rgb.npy`, npy('|u1', [n, points, 3], rgb)],
    [`${name}.failed.jsonl`, failed.map((f) => JSON.stringify(f)).join('\n') + (failed.length ? '\n' : '')],
    [
      `${name}.jsonl`,
      kept
        .map(({ row, s }) =>
          JSON.stringify({
            uid: row.uid,
            title: row.title,
            caption: row.caption,
            author: row.author,
            licence: row.licence,
            url: sketchfabUrl(row.uid),
            triangles: s.tris,
            colored: !!s.col,
            textured: s.textured,
          }),
        )
        .join('\n') + (n ? '\n' : ''),
    ],
  ]
  // the manifest goes last: a shard counts as written when its manifest is there, so every file
  // before it is renamed into place first
  for (const [file, body] of files) {
    await writeFile(join(out, `${file}.part`), body)
    await rename(join(out, `${file}.part`), join(out, file))
  }
  return { kept: n, failed }
}

// Runs the jobs with at most `workers` in flight, keeping each result at its own position.
const pool = async <T, R>(items: T[], workers: number, job: (item: T) => Promise<R>): Promise<R[]> => {
  const results = new Array<R>(items.length)
  let next = 0
  const run = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await job(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, run))
  return results
}

const readIndex = async (path: string): Promise<Index> => {
  const raw = await readFile(path)
  const text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString('utf8') : raw.toString('utf8')
  const index = JSON.parse(text) as Index
  if (!Array.isArray(index.data) || index.rows !== index.data.length) throw new Error(`${path} is not a whole index`)
  return index
}

// The rows that may be exported. Every row of the shipped index has been through the image
// classifier; any other index must say which of its rows have.
const exportable = async (args: Args, index: Index): Promise<IndexRow[]> => {
  if (resolve(args.index) === resolve(SHIPPED)) return index.data
  if (!args.screened) {
    throw new Error(
      `${args.index} is not the shipped index, so the image classifier has not looked at all of it. ` +
        'Pass --screened <file>, a json array of the uids it checked.',
    )
  }
  const screened = new Set(JSON.parse(await readFile(args.screened, 'utf8')) as string[])
  const rows = index.data.filter((r) => screened.has(r.uid))
  console.log(`  ${rows.length.toLocaleString()} of ${index.data.length.toLocaleString()} rows were screened`)
  return rows
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const index = await readIndex(args.index)
  let rows = await exportable(args, index)
  if (args.limit > 0) rows = rows.slice(0, args.limit)
  const revision = index.revisions?.['allenai/objaverse'] ?? 'main'

  const out = resolve(args.out)
  await mkdir(out, { recursive: true })
  const meta = {
    format: FORMAT,
    index: index.version,
    revisions: index.revisions,
    points: args.points,
    shard: args.shard,
    screened: args.screened ? resolve(args.screened) : null,
    // the rows themselves, so a resumed run with another --limit or screening list is refused
    // rather than skipping a shard that holds a different set of rows
    rows: rows.length,
    uids: createHash('sha256').update(rows.map((r) => r.uid).join('\n')).digest('hex'),
    channels: { points: ['x', 'y', 'z', 'nx', 'ny', 'nz'], rgb: ['r', 'g', 'b'] },
    space: "unit sphere, centred on the bounding box, in the file's own glTF axes (Y up by the spec)",
    sampler: 'src/objects/sample.ts sampleSoup: blue noise, Morton ordered, seeded by uid',
  }
  // a resumed run has to be the same export, or its shards would hold two different things
  const metaPath = join(out, 'meta.json')
  if (existsSync(metaPath)) {
    const was = JSON.parse(await readFile(metaPath, 'utf8')) as typeof meta
    for (const key of ['format', 'index', 'points', 'shard', 'screened', 'rows', 'uids'] as const) {
      if (JSON.stringify(was[key]) !== JSON.stringify(meta[key])) {
        const what = key === 'rows' || key === 'uids' ? 'set of rows (another --limit or screening list)' : key
        throw new Error(`${out} holds an export with a different ${what}; use another --out`)
      }
    }
  } else {
    await writeFile(metaPath, JSON.stringify(meta, null, 2) + '\n')
  }

  const shards = Math.ceil(rows.length / args.shard)
  console.log(`# ${rows.length.toLocaleString()} rows, ${shards} shards of ${args.shard}, ${args.points} points, into ${out}`)
  const started = Date.now()
  let kept = 0
  let lost = 0
  let bytes = 0
  const reasons = new Map<string, number>()
  for (let k = 0; k < shards; k++) {
    if (existsSync(join(out, `${shardName(k)}.jsonl`))) {
      console.log(`  ${shardName(k)} already written`)
      continue
    }
    const part = rows.slice(k * args.shard, (k + 1) * args.shard)
    const results = await pool(part, args.workers, async (row) => {
      const r = await exportRow(row, revision, args.points)
      bytes += r.bytes
      return r.outcome
    })
    const done = await writeShard(out, k, part, results, args.points)
    kept += done.kept
    lost += done.failed.length
    for (const f of done.failed) {
      const why = f.why.replace(/\(.*\)|: .*/, '').trim()
      reasons.set(why, (reasons.get(why) ?? 0) + 1)
    }
    const secs = (Date.now() - started) / 1000
    console.log(
      `  ${shardName(k)}: ${done.kept} kept, ${done.failed.length} failed · ` +
        `${(bytes / 1e6).toFixed(0)} MB fetched in ${secs.toFixed(0)} s`,
    )
  }
  console.log(`# ${kept.toLocaleString()} kept, ${lost.toLocaleString()} failed this run`)
  for (const [why, count] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${why.padEnd(28)} ${count}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
