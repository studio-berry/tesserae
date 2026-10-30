// One copy of argv parsing for the benchmark's scripts. They all take the same `--name value` shape,
// and four private copies of it had already drifted.
export const arg = (name: string, fallback = '') => {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 ? (process.argv[at + 1] ?? 'true') : fallback
}

export const flag = (name: string) => process.argv.includes(`--${name}`)

export const num = (name: string, fallback: number) => {
  const value = Number(arg(name, String(fallback)))
  return Number.isFinite(value) && value > 0 ? value : fallback
}
