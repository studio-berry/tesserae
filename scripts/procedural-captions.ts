// The captions the procedural export writes: one sentence per cloud, built from the form the
// generator actually produced. The numbers in a caption are read back out of the item's own
// `detail` string, so the words never describe a shape other than the one that was sampled.

export type Described = { title: string; detail: string }

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

// A count as words, so a caption holds no digits a text encoder would have to guess at reading.
// Past 99 the digits are the only honest answer and none of the forms reaches it.
export const words = (n: number): string => {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n)
  if (n < 10) return ONES[n]
  if (n < 20) return TEENS[n - 10]
  const ones = n % 10
  return TENS[Math.floor(n / 10)] + (ones ? `-${ONES[ones]}` : '')
}

const an = (word: string) => (/^[aeiou]/.test(word) ? `an ${word}` : `a ${word}`)

// One of a short list, chosen by the seed, so a run of one item reads as a run of sentences rather
// than the same sentence with a new number.
const one = (list: readonly string[], seed: number) => list[seed % list.length]

const num = (detail: string, re: RegExp, fallback: number) => {
  const m = re.exec(detail)
  return m ? Number(m[1]) : fallback
}

const SIDES: Record<string, number> = { Tetrahedron: 4, Cube: 6, Octahedron: 8, Dodecahedron: 12, Icosahedron: 20 }

export const captionFor = (id: string, built: Described, seed: number): string => {
  switch (id) {
    case 'teapot':
      return an(`${one(['smooth', 'glazed', 'plump', 'classic', 'stout'], seed)} teapot with its lid ${built.detail.includes('lid off') ? 'off' : 'on'}`)
    case 'supershape': {
      const lobes = num(built.detail, /\bm (\d+)/, 6)
      return an(`${one(['smooth', 'ribbed', 'pinched', 'swollen', 'flowing'], seed)} supershape with ${an(`${words(lobes)}-lobed rim`)}`)
    }
    case 'donut': {
      const tube = num(built.detail, /· r ([\d.]+)/, 0.45)
      return an(`${one(['even', 'glossy', 'tidy', 'smooth', 'stout'], seed)} torus with a ${tube >= 0.4 ? 'thick' : 'thin'} tube`)
    }
    case 'knot': {
      const [p, q] = [num(built.detail, /\((\d+),/, 2), num(built.detail, /, (\d+)\)/, 3)]
      const adj = one(['tight', 'even', 'loose', 'graceful', 'dense'], seed)
      if (p === 2 && q === 3) return an(`${adj} trefoil knot`)
      return an(`${adj} torus knot wound ${words(p)} times around the ring and ${words(q)} times through its hole`)
    }
    case 'crystal':
      return an(`${one(['faceted', 'sharp-edged', 'glassy', 'cut', 'pale'], seed)} ${words(SIDES[built.title] ?? 20)}-sided crystal`)
    case 'shell':
      return an(`${one(['pale', 'ridged', 'delicate', 'smooth', 'banded'], seed)} seashell spiralling ${words(Math.round(num(built.detail, /([\d.]+) turns/, 3)))} turns`)
    case 'klein':
      return an(`${one(['glassy', 'smooth', 'twisted', 'single-sided'], seed)} Klein bottle passing through its own wall`)
    case 'helix':
      return an(`${one(['narrow', 'long', 'tidy', 'laddered', 'slender'], seed)} double helix with ${words(num(built.detail, /(\d+) base pairs/, 20))} base pairs`)
    case 'asteroid':
      return an(`${one(['weathered', 'stony', 'craggy', 'fresh', 'dark'], seed)} asteroid with ${words(num(built.detail, /(\d+) craters/, 8))} craters`)
    default:
      return an(built.title.toLowerCase())
  }
}
