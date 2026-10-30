// Deletes the procedural shards once the runs that read them are finished, and only after proving
// they can be rebuilt.
//
//   node scripts/procedural-clean.ts --root .cache/procedural --runs ml/runs/R0a,ml/runs/R0b --dry-run
//   node scripts/procedural-clean.ts --root .cache/procedural --runs ml/runs/R0a,ml/runs/R0b
//
// Run it from the repository root, at the commit the shards were written from. In order it:
//
// 1. reads every part under --root (a folder with a procedural meta.json) and refuses a part that
//    was written from uncommitted code, or parts written from different commits or builds;
// 2. refuses unless every run in --runs has finished (its train.json carries `finished`);
// 3. refuses unless HEAD is that commit and the source has no uncommitted changes;
// 4. rebuilds the export bundle and refuses unless it hashes to the build recorded in meta.json;
// 5. regenerates the first shard of the first and last part (or the parts in --verify) and refuses
//    unless the points and rows match the shards on disk byte for byte;
// 6. hashes every point and colour array, writes deleted.json with the hashes and the commands
//    that rebuild each part, then deletes those arrays. meta.json and the .jsonl rows stay.
//
// --dry-run does 1 to 5 and prints what 6 would delete.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  dirtyFrom,
  rebuildArgs,
  SOURCE_PATHS,
  sha256File,
  shardName,
  type Meta,
} from './procedural-export-lib.ts'

// The same build the npm script runs, so the bundle hashes to what the export recorded.
export const BUILD = {
  entryPoints: ['scripts/procedural-export.ts'],
  bundle: true,
  platform: 'node' as const,
  format: 'esm' as const,
  packages: 'external' as const,
  logLevel: 'warning' as const,
}
export const BUILD_COMMAND =
  'npx esbuild scripts/procedural-export.ts --bundle --platform=node --format=esm --packages=external --log-level=warning --outfile=.cache/procedural-export.mjs'

export type Part = { name: string; folder: string; meta: Meta }
export type Run = { dir: string; train: { finished?: string; data?: { manifests?: { folder?: string }[] }[] } }

type Args = { root: string; runs: string[]; verify: string[]; dryRun: boolean }

export const parseArgs = (argv: string[]): Args => {
  const a: Args = { root: '', runs: [], verify: [], dryRun: false }
  const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--root') a.root = argv[++i] ?? ''
    else if (k === '--runs') a.runs = list(argv[++i])
    else if (k === '--verify') a.verify = list(argv[++i])
    else if (k === '--dry-run') a.dryRun = true
    else throw new Error(`unknown option ${k}`)
  }
  if (!a.root) throw new Error('--root is required: the folder holding the part-* exports')
  if (!a.runs.length) throw new Error('--runs is required: the training runs that read these shards, comma separated')
  return a
}

// The commit and build every part was written from, or why the parts cannot be rebuilt.
export const checkParts = (parts: Part[]): { commit: string; bundle: string } => {
  if (!parts.length) throw new Error('no procedural exports found under --root')
  for (const p of parts) {
    const prov = p.meta.provenance
    if (!prov?.commit || !prov.bundle) throw new Error(`${p.name} has no record of the code that wrote it, so it cannot be rebuilt`)
    if (prov.dirty?.length) throw new Error(`${p.name} was written from uncommitted changes (${prov.dirty.join(', ')}), so it cannot be rebuilt`)
  }
  const { commit, bundle } = parts[0].meta.provenance
  for (const p of parts) {
    if (p.meta.provenance.commit !== commit) throw new Error(`${p.name} was written at ${p.meta.provenance.commit.slice(0, 12)} and ${parts[0].name} at ${commit.slice(0, 12)}; clean one commit at a time`)
    if (p.meta.provenance.bundle !== bundle) throw new Error(`${p.name} and ${parts[0].name} were written by different builds of the export; clean them separately`)
  }
  return { commit, bundle }
}

// Every run has to be finished: a run still reading the shards would fail, or train on a hole.
export const checkRuns = (runs: Run[]) => {
  for (const r of runs) if (!r.train.finished) throw new Error(`${r.dir} has not finished (its train.json has no "finished"), so it may still read the shards`)
}

// Which of the parts a run read, matched on the absolute folder train.json records.
export const partsReadBy = (run: Run, parts: Part[]): string[] => {
  const read = new Set((run.train.data ?? []).flatMap((g) => (g.manifests ?? []).map((m) => resolve(m.folder ?? ''))))
  return parts.filter((p) => read.has(resolve(p.folder))).map((p) => p.name)
}

// The arrays that go: points and colour. The rows, the failures and the manifest stay as the record.
export const deletable = (names: string[]) => names.filter((n) => /^shard-\d+\.(points|rgb)\.npy$/.test(n)).sort()

// The first and last part, which between them cover both ends of the seed range.
export const defaultVerify = (parts: Part[]) => [...new Set([parts[0].name, parts[parts.length - 1].name])]

const hashStream = (path: string) =>
  new Promise<string>((ok, fail) => {
    const h = createHash('sha256')
    createReadStream(path)
      .on('data', (chunk) => h.update(chunk))
      .on('end', () => ok(h.digest('hex')))
      .on('error', fail)
  })

const git = (args: string[]) => {
  const r = spawnSync('git', args, { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`)
  return r.stdout
}

const readParts = (root: string): Part[] =>
  readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('verify-'))
    .map((d) => ({ name: d.name, folder: join(root, d.name) }))
    .filter((p) => existsSync(join(p.folder, 'meta.json')))
    .map((p) => ({ ...p, meta: JSON.parse(readFileSync(join(p.folder, 'meta.json'), 'utf8')) as Meta }))
    .filter((p) => p.meta.index === 'procedural')
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const root = resolve(args.root)
  if (!existsSync(join(process.cwd(), 'scripts', 'procedural-export.ts'))) throw new Error('run this from the repository root')

  // 1. the parts, and the one commit and build they share
  const parts = readParts(root)
  const { commit, bundle } = checkParts(parts)
  console.log(`# ${parts.length} parts under ${root}, written at ${commit.slice(0, 12)}`)

  // 2. the runs
  const runs: Run[] = args.runs.map((dir) => {
    const path = join(resolve(dir), 'train.json')
    if (!existsSync(path)) throw new Error(`${dir} has no train.json`)
    return { dir, train: JSON.parse(readFileSync(path, 'utf8')) }
  })
  checkRuns(runs)
  const read = new Set<string>()
  for (const r of runs) {
    const names = partsReadBy(r, parts)
    names.forEach((n) => read.add(n))
    console.log(`  ${r.dir}: finished ${r.train.finished}, read ${names.length} of the ${parts.length} parts`)
  }
  const unread = parts.filter((p) => !read.has(p.name)).map((p) => p.name)
  if (unread.length) console.log(`  no listed run read ${unread.join(', ')}; they are deleted too, since they rebuild like the rest`)

  // 3. the checkout has to be the code that wrote them
  const head = git(['rev-parse', 'HEAD']).trim()
  if (head !== commit) throw new Error(`HEAD is ${head.slice(0, 12)} and the shards were written at ${commit.slice(0, 12)}: git checkout ${commit} first`)
  const dirty = dirtyFrom(git(['status', '--porcelain', '--untracked-files=no', '--', ...SOURCE_PATHS]))
  if (dirty.length) throw new Error(`uncommitted changes in ${dirty.join(', ')}; the rebuild has to run the committed code`)

  // 4. the build has to be the one that ran
  const work = join(root, 'verify-bundle')
  rmSync(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  const script = join(work, 'procedural-export.mjs')
  const { build } = await import('esbuild')
  await build({ ...BUILD, outfile: script })
  if (sha256File(script) !== bundle) throw new Error('the export script built from this commit differs from the build that wrote the shards, so a rebuild would not match them')
  console.log('  the export builds to the recorded bundle')

  // 5. regenerate the first shard of the parts being checked and compare
  const verify = args.verify.length ? args.verify : defaultVerify(parts)
  const checked: { part: string; files: Record<string, string> }[] = []
  for (const name of verify) {
    const part = parts.find((p) => p.name === name)
    if (!part) throw new Error(`--verify names ${name}, which is not a part under --root`)
    const out = join(root, `verify-${name}`)
    rmSync(out, { recursive: true, force: true })
    const r = spawnSync(process.execPath, ['--max-old-space-size=4096', script, ...rebuildArgs(part.meta, out, true)], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`rebuilding ${name} failed: ${(r.stderr || r.stdout).trim()}`)
    const first = shardName(0)
    const files: Record<string, string> = {}
    for (const ext of ['points.npy', 'jsonl', ...(part.meta.rgb ? ['rgb.npy'] : [])]) {
      const kept = join(part.folder, `${first}.${ext}`)
      if (!existsSync(kept)) throw new Error(`${name} has no ${first}.${ext} to compare against`)
      const [a, b] = await Promise.all([hashStream(kept), hashStream(join(out, `${first}.${ext}`))])
      if (a !== b) throw new Error(`the rebuilt ${name}/${first}.${ext} differs from the one on disk, so the shards are not reproducible; nothing was deleted`)
      files[`${first}.${ext}`] = a
    }
    checked.push({ part: name, files })
    rmSync(out, { recursive: true, force: true })
    console.log(`  ${name}: ${first} rebuilt byte for byte`)
  }
  rmSync(work, { recursive: true, force: true })

  // 6. record, then delete
  const plan = parts.map((p) => ({ part: p, names: deletable(readdirSync(p.folder)) }))
  const count = plan.reduce((n, p) => n + p.names.length, 0)
  const bytes = plan.reduce((n, p) => n + p.names.reduce((m, f) => m + statSync(join(p.part.folder, f)).size, 0), 0)
  if (!count) {
    console.log('# nothing to delete: the arrays are already gone')
    return
  }
  console.log(`# ${count} arrays, ${(bytes / 1e9).toFixed(2)} GB${args.dryRun ? ' would be deleted (dry run)' : ''}`)
  if (args.dryRun) return

  const record = {
    status: 'deleting' as 'deleting' | 'deleted',
    started: new Date().toISOString(),
    deleted: null as string | null,
    root,
    commit,
    bundle,
    node: process.version,
    bytes,
    rebuild: {
      checkout: `git checkout ${commit}`,
      build: BUILD_COMMAND,
      parts: parts.map((p) => `node --max-old-space-size=4096 .cache/procedural-export.mjs ${rebuildArgs(p.meta, join(args.root, p.name), false).join(' ')}`),
    },
    verified: checked,
    runs: runs.map((r) => ({ dir: r.dir, finished: r.train.finished, read: partsReadBy(r, parts) })),
    parts: [] as { name: string; rows: number; seed: number; shard: number; points: number; rgb: boolean; uids: string; files: { name: string; bytes: number; sha256: string }[] }[],
  }
  for (const { part, names } of plan) {
    const files = []
    for (const name of names) {
      const path = join(part.folder, name)
      files.push({ name, bytes: statSync(path).size, sha256: await hashStream(path) })
    }
    const m = part.meta
    record.parts.push({ name: part.name, rows: m.rows, seed: m.seed, shard: m.shard, points: m.points, rgb: m.rgb, uids: m.uids, files })
    console.log(`  hashed ${part.name}: ${files.length} arrays`)
  }

  // an earlier record is kept beside this one rather than overwritten
  const recordPath = join(root, 'deleted.json')
  if (existsSync(recordPath)) {
    let n = 1
    while (existsSync(join(root, `deleted.${n}.json`))) n++
    await rename(recordPath, join(root, `deleted.${n}.json`))
  }
  await writeFile(recordPath, JSON.stringify(record, null, 2) + '\n')
  for (const { part, names } of plan) for (const name of names) await unlink(join(part.folder, name))
  record.status = 'deleted'
  record.deleted = new Date().toISOString()
  await writeFile(recordPath, JSON.stringify(record, null, 2) + '\n')
  console.log(`# deleted ${count} arrays, ${(bytes / 1e9).toFixed(2)} GB; ${recordPath} holds the hashes and the rebuild commands`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
