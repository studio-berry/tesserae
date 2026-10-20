import { INDEX_URL, type Index } from './objaverse-index'

// The index is fetched the first time a prompt runs, then held in memory.
//
// An ordinary page load never pays for it: the file is a megabyte, and a visitor who never
// types a prompt never needs it. The fetch is also the app's first contact with the Hub, so it
// is held to a timeout and the failure is quiet: a missing index means the backend is skipped
// and the chain moves on to the next one.

let held: Promise<Index | null> | null = null

// The index, fetched once and held. A failed fetch is not retried within a session, because a
// second attempt would cost the same wait and fail the same way.
export const objaverseIndex = (): Promise<Index | null> => {
  if (held) return held
  held = fetch(INDEX_URL, { signal: AbortSignal.timeout(20000) })
    .then(async (res) => {
      if (!res.ok) return null
      // the file is gzipped, and the browser decompresses it when the server says so
      const text = await res.text()
      const parsed = JSON.parse(text) as Index
      return Array.isArray(parsed.data) ? parsed : null
    })
    .catch(() => null)
  return held
}

// Forgets the held index, so a test can fetch it again.
export const resetObjaverseIndex = () => {
  held = null
}
