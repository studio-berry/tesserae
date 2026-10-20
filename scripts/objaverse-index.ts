// Builds the static Objaverse index: caption -> GLB on the hub, with its credit.
//
// Joins three keyless hugging face datasets:
//   allenai/objaverse          object-paths.json.gz and metadata/*.json.gz (licence, author, page)
//   tiange/Cap3D               Cap3D_automated_Objaverse_full.csv (uid -> caption, ODC-By v1.0)
//   cindyxl/ObjaversePlusPlus  default/train parquet (uid -> quality score and traits, ODC-By v1.0)
//
// Every source is read at a pinned commit, so the same inputs give the same index. The pinned
// revisions travel inside the index file and in docs/objaverse-index.md.
//
// The inputs are downloaded separately, because they are 840 MB and must stay out of git:
//
//   node scripts/objaverse-index.ts --fetch --data .cache/objaverse
//   node scripts/objaverse-index.ts --data .cache/objaverse --out public/objaverse/index.json.gz
//
// The filters live in scripts/objaverse-filters.ts and are the same ones the app uses, so a row
// the build drops is a row the app would refuse to show.
//
// The build is a stream, not a join. The cap3d csv holds 1.6 million captions, which does not
// fit in memory as a map, so the metadata is filtered first and the csv is then walked once,
// keeping only the captions of the rows that are still alive.

import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { mkdir, readFile, writeFile, stat, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parquetReadObjects } from 'hyparquet'

import type { Index, IndexRow } from '../src/objects/objaverse-index.ts'
import {
  applyStep,
  captionStep,
  funnelSteps,
  rowTitle,
  type Candidate,
} from './objaverse-filters.ts'

// The commit each source is read at. A rebuild that reads main can quietly produce a different
// index, and a reviewed denylist would then point at a different set of rows.
export const REVISIONS = {
  'allenai/objaverse': '556637099bf4fa79ea7b239d0d9c328b8a2e9ac8',
  'tiange/Cap3D': '0f05a726ff7eb3db93444a4efc65f0552bce84a4',
  'cindyxl/ObjaversePlusPlus': 'ac892800fd29db09c2b560bdfdd3c57253045836',
} as const

// objaverse++ publishes its annotations as a json file on the commit above and as a parquet on
// a conversion ref, which has its own commit. The build reads the parquet, so that commit is
// pinned too.
export const PARQUET_REVISION = 'd564ab4d65106127ef4fc6e960be82d7e202564f'

const HUB = 'https://huggingface.co/datasets'
const OBJAVERSE = `${HUB}/allenai/objaverse/resolve/${REVISIONS['allenai/objaverse']}`
const CAP3D = `${HUB}/tiange/Cap3D/resolve/${REVISIONS['tiange/Cap3D']}`
const PLUSPLUS = `${HUB}/cindyxl/ObjaversePlusPlus/resolve/${PARQUET_REVISION}`

// The files the build reads, and where each comes from.
export const SOURCES = {
  'object-paths.json.gz': `${OBJAVERSE}/object-paths.json.gz`,
  'cap3d.csv': `${CAP3D}/Cap3D_automated_Objaverse_full.csv`,
  'plusplus.parquet': `${PLUSPLUS}/default/train/0000.parquet`,
} as const

// The sha256 of each downloaded file, checked against what the hub serves, so a truncated
// download cannot quietly change the index.
export const DIGESTS: Record<string, string> = {
  'object-paths.json.gz': 'db88ff78942613f10566ec4723fb8b8f558c37ffe8e78a8fc5428a20b93886a0',
  'cap3d.csv': '2a02dbf636bf4c9a60a8b39f7ac25dc546f02caa654cd402bef69f130d8f1638',
  'plusplus.parquet': 'd7b2965728414eb6c4c8d06403483761fc0ea82f30e3bdc3880f0277d2db3f0c',
}

const CHUNKS = Array.from({ length: 160 }, (_, i) => `000-${String(i).padStart(3, '0')}`)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// The hub resets the first request to a given url often enough that a retry is the normal
// path, not the exception.
const fetchWithRetry = async (url: string, attempts = 6): Promise<Response> => {
  let last = ''
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`status ${res.status}`)
      return res
    } catch (err) {
      last = String(err)
      await sleep(1200 * (i + 1))
    }
  }
  throw new Error(`could not fetch ${url}: ${last}`)
}

const download = async (url: string, dest: string) => {
  if (existsSync(dest)) {
    const info = await stat(dest)
    if (info.size > 0) return false
  }
  const part = `${dest}.part`
  const res = await fetchWithRetry(url)
  await writeFile(part, Buffer.from(await res.arrayBuffer()))
  await rename(part, dest)
  return true
}

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex')

// The downloads, with the digest check.
export const fetchAll = async (data: string, onLog: (s: string) => void = console.log) => {
  await mkdir(join(data, 'metadata'), { recursive: true })
  for (const [name, url] of Object.entries(SOURCES)) {
    const dest = join(data, name)
    const fresh = await download(url, dest)
    const buf = await readFile(dest)
    const want = DIGESTS[name]
    if (want && sha256(buf) !== want) throw new Error(`${name} does not match the pinned digest`)
    onLog(`  ${name} ${buf.length.toLocaleString()} bytes${fresh ? '' : ' (kept)'}`)
  }
  for (const chunk of CHUNKS) {
    const fresh = await download(
      `${OBJAVERSE}/metadata/${chunk}.json.gz`,
      join(data, 'metadata', `${chunk}.json.gz`),
    )
    if (fresh) onLog(`  metadata/${chunk}.json.gz`)
  }
}

// The object-paths file: uid -> the hub folder its glb sits in. Only the folder is kept,
// because that is all the index needs, and a full path per uid costs 800k strings.
const loadChunks = async (data: string) => {
  const raw = gunzipSync(await readFile(join(data, 'object-paths.json.gz')))
  const paths = JSON.parse(raw.toString('utf8')) as Record<string, string>
  const chunks = new Map<string, string>()
  for (const [uid, p] of Object.entries(paths)) {
    const m = /^glbs\/(\d{3}-\d{3})\//.exec(p)
    if (m) chunks.set(uid, m[1])
  }
  return chunks
}

// The cap3d csv, read one row at a time. The file is walked as bytes rather than as text, so a
// 255 MB file does not become a string tree in memory.
//
// The captions are quoted, and a few of them hold a newline, so a quoted field is read whole
// and the line ends at the newline that follows the closing quote.
export const streamCaptions = async (
  data: string,
  onRow: (uid: string, caption: string) => void,
) => {
  const buf = await readFile(join(data, 'cap3d.csv'))
  const n = buf.length
  let i = 0
  while (i < n) {
    // the uid runs to the first comma, and holds no comma of its own
    const comma = buf.indexOf(0x2c, i)
    if (comma < 0) break
    const uid = buf.toString('utf8', i, comma).trim()
    i = comma + 1
    let caption = ''
    if (buf[i] === 0x22) {
      // a quoted field, which may hold commas and newlines
      i++
      const start = i
      let end = -1
      while (i < n) {
        if (buf[i] === 0x22) {
          // a doubled quote is one quote, and the field goes on
          if (buf[i + 1] === 0x22) {
            i += 2
            continue
          }
          end = i
          i++
          break
        }
        i++
      }
      if (end < 0) end = n
      caption = buf.toString('utf8', start, end).replace(/""/g, '"')
      // the line ends at the newline that follows the closing quote
      while (i < n && buf[i] !== 0x0a) i++
      i++
    } else {
      const nl = buf.indexOf(0x0a, i)
      const end = nl < 0 ? n : nl
      caption = buf.toString('utf8', i, end)
      i = end + 1
    }
    onRow(uid, caption.trim())
  }
}

type Meta = {
  name?: string
  tags?: { name?: string }[]
  categories?: { name?: string }[]
  license?: string
  isAgeRestricted?: boolean
  faceCount?: number
  user?: { displayName?: string; username?: string }
  archives?: { glb?: { size?: number } }
}

// The objaverse++ annotations: uid -> score and traits, packed into one number.
const loadTraits = async (data: string) => {
  const buf = await readFile(join(data, 'plusplus.parquet'))
  const rows = (await parquetReadObjects({
    file: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    columns: ['UID', 'score', 'is_multi_object', 'is_scene', 'is_figure', 'is_transparent'],
  })) as Record<string, unknown>[]
  const traits = new Map<string, number>()
  const flag = (v: unknown) => String(v) === 'true'
  for (const r of rows) {
    const uid = String(r.UID ?? '')
    if (!uid) continue
    let f = 0
    if (flag(r.is_multi_object)) f |= 1
    if (flag(r.is_scene)) f |= 2
    if (flag(r.is_figure)) f |= 4
    if (flag(r.is_transparent)) f |= 8
    traits.set(uid, (Number(r.score ?? 0) << 4) | f)
  }
  return traits
}

// The metadata chunks, read one at a time so only the wanted rows are held.
const streamMeta = async (
  data: string,
  wanted: Set<string>,
  onRow: (uid: string, m: Meta) => void,
) => {
  for (const chunk of CHUNKS) {
    const raw = gunzipSync(await readFile(join(data, 'metadata', `${chunk}.json.gz`)))
    const parsed = JSON.parse(raw.toString('utf8')) as Record<string, Meta>
    for (const [uid, m] of Object.entries(parsed)) {
      if (wanted.has(uid)) onRow(uid, m)
    }
  }
}

// A row of the build. The caption is the biggest field, so it is only filled in for the rows
// that are still alive when the build reaches the caption steps.
type Record_ = Candidate

// The build. The funnel runs in order, and the count after each step is the report.
//
// The metadata steps run over the sketchfab records, which are read chunk by chunk. The caption
// steps need the cap3d text, so the csv is walked once when the build reaches the first of
// them, and only the captions of the rows still alive are kept.
export const build = async (
  data: string,
  minScore: number,
  onStep: (label: string, count: number) => void,
) => {
  const steps = funnelSteps(minScore)
  const split = captionStep(minScore)
  const chunks = await loadChunks(data)
  const traits = await loadTraits(data)

  // the first two steps are about the two uid lists, not about the records
  const alive = new Set<string>()
  for (const uid of traits.keys()) if (chunks.has(uid)) alive.add(uid)
  onStep(steps[0].label, traits.size)
  onStep(steps[1].label, alive.size)

  // the records, read chunk by chunk
  const records = new Map<string, Record_>()
  await streamMeta(data, alive, (uid, m) => {
    const t = traits.get(uid)!
    const score = t >> 4
    const f = t & 15
    const user = m.user ?? {}
    const glb = m.archives?.glb ?? {}
    records.set(uid, {
      uid,
      chunk: chunks.get(uid) ?? '',
      title: m.name ?? '',
      caption: '',
      tags: (m.tags ?? []).map((x) => x.name ?? '').join(' '),
      categories: (m.categories ?? []).map((c) => c.name ?? '').join(' '),
      author: (user.displayName ?? user.username ?? '').trim(),
      licence: m.license ?? '',
      adult: !!m.isAgeRestricted,
      faces: m.faceCount ?? 0,
      bytes: glb.size ?? 0,
      score,
      multiObject: !!(f & 1),
      scene: !!(f & 2),
      figure: !!(f & 4),
      transparent: !!(f & 8),
      inPaths: true,
      hasMeta: true,
      hasCaption: false,
    })
  })

  // the metadata steps, from the third to the one before the caption steps
  for (const step of steps.slice(2, split)) {
    const kept = applyStep(records, step)
    onStep(step.label, kept)
  }

  // the caption steps. The csv is walked once, and only the captions of the rows still alive
  // are kept.
  const captioned = new Map<string, string>()
  await streamCaptions(data, (uid, caption) => {
    if (records.has(uid)) captioned.set(uid, caption)
  })

  for (const step of steps.slice(split)) {
    // a row is captioned when the csv held a row for it, even if the caption was empty
    for (const [uid, row] of records) {
      const caption = captioned.get(uid) ?? ''
      row.caption = caption
      row.hasCaption = captioned.has(uid)
    }
    const kept = applyStep(records, step)
    onStep(step.label, kept)
  }

  const rows: Candidate[] = []
  for (const [uid, row] of records) {
    rows.push({ ...row, caption: captioned.get(uid) ?? '', hasCaption: captioned.has(uid) })
  }
  return { rows, captioned }
}

// The index rows.
export const toIndexRows = (rows: Candidate[]): IndexRow[] =>
  rows.map((r) => ({
    uid: r.uid,
    title: rowTitle(r.title, r.caption),
    caption: r.caption,
    chunk: r.chunk,
    author: r.author,
    licence: 'CC BY 4.0',
  }))

// The rows in the order the index holds them: the score, then the shortest caption, then the
// uid. A rebuild that reads the same inputs gives the same file.
export const sortRows = (rows: Candidate[]) =>
  rows
    .slice()
    .sort((a, b) => b.score - a.score || a.caption.length - b.caption.length || (a.uid < b.uid ? -1 : 1))

// The index file, with the revisions it was read at.
export const buildIndex = (rows: Candidate[], limit: number): Index => {
  const kept = limit > 0 ? sortRows(rows).slice(0, limit) : sortRows(rows)
  return {
    version: `objaverse-${REVISIONS['allenai/objaverse'].slice(0, 8)}-${kept.length}`,
    rows: kept.length,
    revisions: { ...REVISIONS, 'cindyxl/ObjaversePlusPlus (parquet)': PARQUET_REVISION },
    data: toIndexRows(kept),
  }
}

const encode = (index: Index) => Buffer.from(JSON.stringify(index), 'utf8')

const parseArgs = (argv: string[]) => {
  const out: {
    data: string
    out?: string
    minScore: number
    limit: number
    fetch: boolean
    report: boolean
  } = { data: '.cache/objaverse', minScore: 3, limit: 20_000, fetch: false, report: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--data') out.data = argv[++i]
    else if (a === '--out') out.out = argv[++i]
    else if (a === '--min-score') out.minScore = Number(argv[++i])
    else if (a === '--limit') out.limit = Number(argv[++i])
    else if (a === '--fetch') out.fetch = true
    else if (a === '--report') out.report = true
  }
  return out
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const data = resolve(args.data)
  if (args.fetch) {
    console.log('downloading the pinned sources')
    await fetchAll(data)
  }
  if (!existsSync(join(data, 'object-paths.json.gz'))) {
    console.error(`no data in ${data}; run with --fetch first`)
    process.exit(1)
  }

  console.log(`# funnel, score >= ${args.minScore}`)
  const { rows } = await build(data, args.minScore, (label, count) =>
    console.log(`  ${label.padEnd(34)} ${count.toLocaleString().padStart(9)}`),
  )
  const sorted = sortRows(rows)

  if (args.report) {
    console.log('\n# size (rows sorted by score, then caption length; first N kept)')
    for (const n of [20_000, 50_000]) {
      if (sorted.length < n) {
        console.log(`  ${n.toLocaleString().padStart(6)} rows: only ${sorted.length.toLocaleString()} available`)
        continue
      }
      const plain = encode({
        version: 'x',
        rows: n,
        revisions: {},
        data: toIndexRows(sorted.slice(0, n)),
      })
      const gz = gzipSync(plain, { level: 9 })
      console.log(
        `  ${n.toLocaleString().padStart(6)} rows: ${(plain.length / 1e6).toFixed(1)} MB raw, ` +
          `${(gz.length / 1e6).toFixed(2)} MB gzip`,
      )
    }
  }

  if (!args.out) return
  const index = buildIndex(rows, args.limit)
  const out = resolve(args.out)
  await mkdir(dirname(out), { recursive: true })
  const plain = encode(index)
  const gz = gzipSync(plain, { level: 9 })
  const gzOut = out.endsWith('.gz') ? out : `${out}.gz`
  await writeFile(gzOut, gz)
  console.log(`wrote ${index.rows.toLocaleString()} rows to ${gzOut}`)
  console.log(`  ${(plain.length / 1e6).toFixed(1)} MB raw, ${(gz.length / 1e6).toFixed(2)} MB gzip`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
