import { INDEX_URL, type Index } from './objaverse-index'

// The index is fetched the first time a prompt runs, then held in memory.
//
// An ordinary page load never pays for it: the file is a megabyte, and a visitor who never
// types a prompt never needs it. The fetch is also the app's first contact with the Hub, so it
// is held to a timeout and the failure is quiet: a missing index means the backend is skipped
// and the chain moves on to the next one.
//
// The file is gzipped, and a server may or may not say so. The dev server sets
// content-encoding: gzip and the browser decompresses the body, but a plain static host serves
// the bytes as they are, so the body arrives still compressed. Both are read here, because an
// index that never loads is a backend that never answers.

let held: Promise<Index | null> | null = null

// The two bytes that start a gzip stream, which tell a compressed body from a plain one.
const GZIP_0 = 0x1f
const GZIP_1 = 0x8b

// The body as text, whether the server decompressed it or not.
export const asText = async (res: Response) => {
  const buffer = await res.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  // the browser has already decompressed it when the server said so, so the body starts with a
  // brace rather than with the gzip magic number
  if (bytes.length < 2 || bytes[0] !== GZIP_0 || bytes[1] !== GZIP_1) {
    return new TextDecoder().decode(bytes)
  }
  // the body is still compressed, so it is decompressed here
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

// The index, fetched once and held. A failed fetch is not retried within a session, because a
// second attempt would cost the same wait and fail the same way.
export const objaverseIndex = (): Promise<Index | null> => {
  if (held) return held
  held = fetch(INDEX_URL, { signal: AbortSignal.timeout(20000) })
    .then(async (res) => {
      if (!res.ok) return null
      const text = await asText(res)
      const parsed = JSON.parse(text) as Index
      // The version is read here rather than only carried about: an index that does not name the
      // build that wrote it, or whose row count does not match what it holds, is not a build the
      // app can trust to be whole, so it is dropped and the backend is skipped. A partial body
      // from a cache is the failure this catches.
      if (typeof parsed.version !== 'string' || !parsed.version) return null
      if (!Array.isArray(parsed.data)) return null
      return parsed.rows === parsed.data.length ? parsed : null
    })
    .catch(() => null)
  return held
}

// Forgets the held index, so a test can fetch it again.
export const resetObjaverseIndex = () => {
  held = null
}
