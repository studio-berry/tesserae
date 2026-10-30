// The held-out set: 200 prompts nobody tunes against, kept in the repository encrypted so a training
// run can be scored on them without the prompts being readable, and so a leaked repository does not
// leak the test set.
//
//   node scripts/held-out.ts --encrypt --in bench/held-out.jsonl --out bench/held-out.jsonl.enc --key "$BENCH_HELDOUT_KEY"
//   node scripts/held-out.ts --decrypt --in bench/held-out.jsonl.enc --out .cache/held-out.jsonl --key "$BENCH_HELDOUT_KEY"
//   node scripts/held-out.ts --check   --in bench/held-out.jsonl.enc --key "$BENCH_HELDOUT_KEY"
//
// AES-256-GCM with the key derived from the passphrase, and the tag checked on open: a wrong key fails
// loudly instead of yielding plausible garbage that scores as a bad model.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { arg, flag } from '../bench/lib/args.ts'

const MAGIC = 'GATHOLDOUT1'
const IV_BYTES = 12
const TAG_BYTES = 16

const keyFrom = (passphrase: string) => createHash('sha256').update(passphrase, 'utf8').digest()

export function seal(plain: string, passphrase: string): Buffer {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(passphrase), iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([Buffer.from(MAGIC, 'utf8'), iv, cipher.getAuthTag(), body])
}

export function unseal(sealed: Buffer, passphrase: string): string {
  const head = Buffer.from(MAGIC, 'utf8')
  if (!sealed.subarray(0, head.length).equals(head)) throw new Error('not a held-out file: the marker is missing')
  const ivAt = head.length
  const tagAt = ivAt + IV_BYTES
  const bodyAt = tagAt + TAG_BYTES
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(passphrase), sealed.subarray(ivAt, tagAt))
  decipher.setAuthTag(sealed.subarray(tagAt, bodyAt))
  try {
    return Buffer.concat([decipher.update(sealed.subarray(bodyAt)), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('the key does not open this file')
  }
}

type Row = { id: string; prompt: string; category: string; seed: number }

const rows = (jsonl: string): Row[] => jsonl.trim().split('\n').map((line) => JSON.parse(line))
const fold = (s: string) => s.toLowerCase().replace(/^(a|an|the)\s+/, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

// The one property that makes the set worth having: no prompt in it is also in the file the tuning
// reads. Compared with articles and punctuation folded, because "a teapot" and "Teapot" are the same
// object and would be the same leak.
export function overlap(heldOut: Row[], publicRows: Row[]): string[] {
  const seen = new Set(publicRows.map((r) => fold(r.prompt)))
  return heldOut.filter((r) => seen.has(fold(r.prompt))).map((r) => r.prompt)
}

function main() {
  const passphrase = arg('key', process.env.BENCH_HELDOUT_KEY ?? '')
  if (!passphrase) throw new Error('no key: pass --key or set BENCH_HELDOUT_KEY (it lives in the ignored .env)')
  const input = arg('in', flag('check') ? 'bench/held-out.jsonl.enc' : 'bench/held-out.jsonl')
  if (!existsSync(input)) throw new Error(`no such file: ${input}`)
  const out = arg('out')

  if (flag('check')) {
    const held = rows(unseal(readFileSync(input), passphrase))
    const publicRows = rows(readFileSync(arg('public', 'bench/prompts.jsonl'), 'utf8'))
    const dupe = overlap(held, publicRows)
    const ids = new Set(held.map((r) => r.id))
    console.log(`${held.length} held-out prompts, ${ids.size} distinct ids, ${dupe.length} also in the public set`)
    if (dupe.length) { console.error(`overlapping: ${dupe.slice(0, 5).join(', ')}`); process.exitCode = 1 }
    return
  }

  if (!out) throw new Error('--out is required, or pass --check')
  if (flag('encrypt')) {
    writeFileSync(out, seal(readFileSync(input, 'utf8'), passphrase))
    console.log(`sealed ${input} into ${out}`)
    return
  }
  writeFileSync(out, unseal(readFileSync(input), passphrase))
  console.log(`opened ${input} into ${out}`)
}

if (import.meta.main) {
  try { main() } catch (err) { console.error(err instanceof Error ? err.message : err); process.exit(1) }
}
