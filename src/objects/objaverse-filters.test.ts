import { describe, expect, it } from 'vitest'
import {
  CHARACTER_CATEGORIES,
  LICENCES,
  MAX_BYTES,
  MAX_FACES,
  fallbackTitle,
  funnelSteps,
  rowText,
  rowTitle,
  runFunnel,
  type Candidate,
} from '../../scripts/objaverse-filters.ts'
import { DENYLIST } from '../../scripts/objaverse-denylist.ts'
import { FLAGGED } from '../../scripts/objaverse-flagged.ts'
import { isExplicit, isFanArt } from '../safety/content.ts'
import { resultPasses } from '../safety/result.ts'
import { indexTokens, tidyName } from './objaverse-index.ts'
// A row that passes every step, so a test can break one thing at a time.
const good = (over: Partial<Candidate> = {}): Candidate => ({
  uid: 'a'.repeat(32),
  chunk: '000-023',
  title: 'stone lighthouse',
  caption: 'A weathered stone lighthouse on a rocky headland.',
  tags: 'stone lighthouse coast',
  categories: 'architecture',
  author: 'ada',
  licence: 'by',
  adult: false,
  faces: 1200,
  bytes: 1_500_000,
  score: 3,
  multiObject: false,
  scene: false,
  figure: false,
  transparent: false,
  inPaths: true,
  hasMeta: true,
  hasCaption: true,
  ...over,
})

// The step that drops a row, by its label.
const stepFor = (label: string) => {
  const step = funnelSteps(3).find((s) => s.label === label)
  if (!step) throw new Error(`no step named ${label}`)
  return step
}

describe('the build funnel', () => {
  it('keeps the order the report quotes', () => {
    expect(funnelSteps(3).map((s) => s.label)).toEqual([
      'objaverse++ rows',
      'in object-paths',
      'has metadata',
      'licence CC BY 4.0',
      'score >= 3',
      'not a scene',
      'single object',
      'not transparent',
      'has a Cap3D caption',
      'has an author',
      'not age-restricted',
      'not a figure',
      'not filed as character or person',
      'no fan art words',
      'no explicit or blocked words',
      'not on the reviewed denylist',
      'not flagged as explicit',
      'glb <= 8 MB, faces <= 200K',
    ])
  })

  it('keeps a clean row all the way through', () => {
    const { alive, counts } = runFunnel([good()], 3)
    expect(alive).toHaveLength(1)
    expect(counts[counts.length - 1].count).toBe(1)
  })

  it('drops a row the object-paths file does not hold', () => {
    expect(stepFor('in object-paths').keep(good({ inPaths: false }))).toBe(false)
  })

  it('drops a row with no metadata', () => {
    expect(stepFor('has metadata').keep(good({ hasMeta: false }))).toBe(false)
  })

  it('keeps only the CC BY 4.0 rows', () => {
    const licence = stepFor('licence CC BY 4.0')
    expect(licence.keep(good({ licence: 'by' }))).toBe(true)
    for (const other of ['by-nc', 'by-nc-sa', 'by-sa', 'cc0', '']) {
      expect(licence.keep(good({ licence: other })), other).toBe(false)
    }
    expect(LICENCES.by).toBe('CC BY 4.0')
  })

  it('drops a row below the score', () => {
    expect(stepFor('score >= 3').keep(good({ score: 2 }))).toBe(false)
    expect(stepFor('score >= 3').keep(good({ score: 3 }))).toBe(true)
  })

  it('drops a scene, a multi object and a transparent one', () => {
    expect(stepFor('not a scene').keep(good({ scene: true }))).toBe(false)
    expect(stepFor('single object').keep(good({ multiObject: true }))).toBe(false)
    expect(stepFor('not transparent').keep(good({ transparent: true }))).toBe(false)
  })

  it('drops a row with no caption and one with no author', () => {
    expect(stepFor('has a Cap3D caption').keep(good({ hasCaption: false }))).toBe(false)
    expect(stepFor('has an author').keep(good({ author: '' }))).toBe(false)
  })

  it('drops an age-restricted row', () => {
    expect(stepFor('not age-restricted').keep(good({ adult: true }))).toBe(false)
    expect(stepFor('not age-restricted').keep(good({ adult: false }))).toBe(true)
  })

  it('drops a figure', () => {
    expect(stepFor('not a figure').keep(good({ figure: true }))).toBe(false)
    expect(stepFor('not a figure').keep(good({ figure: false }))).toBe(true)
  })

  it('drops a row filed as a character or a person', () => {
    const step = stepFor('not filed as character or person')
    for (const category of CHARACTER_CATEGORIES) {
      expect(step.keep(good({ categories: category })), category).toBe(false)
    }
    expect(step.keep(good({ categories: 'architecture nature-plants' }))).toBe(true)
  })

  it('drops a row that is too big or has too many faces', () => {
    const step = stepFor('glb <= 8 MB, faces <= 200K')
    expect(step.keep(good({ bytes: MAX_BYTES }))).toBe(true)
    expect(step.keep(good({ bytes: MAX_BYTES + 1 }))).toBe(false)
    expect(step.keep(good({ bytes: 0 }))).toBe(false)
    expect(step.keep(good({ faces: MAX_FACES }))).toBe(true)
    expect(step.keep(good({ faces: MAX_FACES + 1 }))).toBe(false)
  })
})

describe('the fan art guard in the build', () => {
  it('drops a title that names a franchise', () => {
    const step = stepFor('no fan art words')
    expect(step.keep(good({ title: 'Sonic the Hedgehog model' }))).toBe(false)
    expect(step.keep(good({ title: 'Pikachu figure' }))).toBe(false)
    expect(step.keep(good({ title: 'pokemon3d asset' }))).toBe(false)
    expect(step.keep(good({ title: 'sonic_the_hedgehog' }))).toBe(false)
  })

  it('drops a caption that names a franchise, even when the title is clean', () => {
    const step = stepFor('no fan art words')
    expect(step.keep(good({ title: 'model', caption: 'A cosplay outfit of a stormtrooper.' }))).toBe(false)
  })

  it('drops a tag that names a franchise', () => {
    const step = stepFor('no fan art words')
    expect(step.keep(good({ title: 'model', tags: 'fnaf animatronic' }))).toBe(false)
  })

  it('keeps an ordinary title', () => {
    const step = stepFor('no fan art words')
    expect(step.keep(good({ title: 'wooden chair' }))).toBe(true)
    expect(step.keep(good({ title: 'lighthouse' }))).toBe(true)
    expect(step.keep(good({ title: 'ceiling fan' }))).toBe(true)
  })

  it('reads the title, the tags and the caption together', () => {
    const text = rowText(good({ title: 'x', tags: 'y', caption: 'z' }))
    expect(text).toBe('x y z')
    expect(isFanArt(text)).toBe(false)
  })
})

describe('the explicit guard in the build', () => {
  it('drops a caption with an explicit stem in one word', () => {
    const step = stepFor('no explicit or blocked words')
    expect(step.keep(good({ title: 'model', caption: 'A nsfw render of a figure.' }))).toBe(false)
    expect(step.keep(good({ title: 'model', caption: 'A nude statue.' }))).toBe(false)
    expect(step.keep(good({ title: 'sexygirl' }))).toBe(false)
  })

  it('drops a caption with a blocked word from the app list', () => {
    const step = stepFor('no explicit or blocked words')
    // the app's own rule, so the build and the app cannot disagree
    expect(resultPasses('a horrible thing')).toBe(true)
    expect(resultPasses('a model with a cock')).toBe(false)
    expect(step.keep(good({ title: 'model', caption: 'A model with a cock.' }))).toBe(false)
  })

  it('drops a row whose only refused word is in the author', () => {
    // the author ships as the credit and the app shows it, so it is judged like the title
    const step = stepFor('no explicit or blocked words')
    expect(step.keep(good({ author: 'nsfw_maker' }))).toBe(false)
    expect(step.keep(good({ author: 'big cock studio' }))).toBe(false)
    expect(step.keep(good({ author: 'ada' }))).toBe(true)
  })

  it('keeps a title that merely holds the letters of a blocked word', () => {
    // the build and the app have to agree about the title, not only about the caption, and the
    // rule is the whole-word one: a fish called "Seabass" and a "Low Poly Assault Rifle" are
    // not the word
    const step = stepFor('no explicit or blocked words')
    expect(step.keep(good({ title: 'Assault rifle', caption: 'A rifle.' }))).toBe(true)
    expect(step.keep(good({ title: 'Seabass', caption: 'A fish.' }))).toBe(true)
  })

  it('drops a title the app would refuse, even when the caption is clean', () => {
    const step = stepFor('no explicit or blocked words')
    expect(step.keep(good({ title: 'cock', caption: 'A bird.' }))).toBe(false)
  })

  it('keeps an ordinary caption', () => {
    const step = stepFor('no explicit or blocked words')
    expect(step.keep(good({ title: 'wooden chair', caption: 'A wooden chair with four legs.' }))).toBe(true)
  })

  it('does not fire across word boundaries', () => {
    const step = stepFor('no explicit or blocked words')
    expect(step.keep(good({ title: 'model', caption: 'What is happening here.' }))).toBe(true)
  })
})

describe('the offline classifier', () => {
  it('drops a model the classifier flagged as explicit', () => {
    const step = stepFor('not flagged as explicit')
    expect(step.keep(good({ uid: FLAGGED[0].uid }))).toBe(false)
  })

  it('keeps a model the classifier did not flag', () => {
    const step = stepFor('not flagged as explicit')
    expect(step.keep(good())).toBe(true)
  })

  it('holds no duplicate uids', () => {
    const uids = FLAGGED.map((f) => f.uid)
    expect(new Set(uids).size).toBe(uids.length)
  })
})

describe('the reviewed denylist', () => {
  it('drops a model that is on the list, even when its words are clean', () => {
    // the word filters cannot catch a model that belongs to a named work
    const denied = DENYLIST[0]
    expect(denied.title.length).toBeGreaterThan(0)
    const step = stepFor('not on the reviewed denylist')
    expect(step.keep(good({ uid: denied.uid, title: denied.title }))).toBe(false)
  })

  it('keeps a model that is not on the list', () => {
    const step = stepFor('not on the reviewed denylist')
    expect(step.keep(good())).toBe(true)
  })

  it('holds no duplicate uids', () => {
    const uids = DENYLIST.map((d) => d.uid)
    expect(new Set(uids).size).toBe(uids.length)
  })
})

describe('the title cleaner', () => {
  it('strips a file extension', () => {
    expect(tidyName('knife.glb')).toBe('knife')
    // the extension goes and the underscores become spaces
    expect(tidyName('u_ДП-56.37x18mm_OBJ.obj')).toBe('u ДП-56.37x18mm OBJ')
  })

  it('keeps a number that only looks like an extension', () => {
    expect(tidyName('Scifi revolver 2.0')).toBe('Scifi revolver 2.0')
    expect(tidyName('P.018.03.2021')).toBe('P.018.03.2021')
  })

  it('turns underscores into spaces', () => {
    expect(tidyName('castle_chimney_02')).toBe('castle chimney 02')
  })

  it('collapses whitespace and trims the ends', () => {
    expect(tidyName('  freefire   new  female ')).toBe('freefire new female')
  })

  it('drops emoji and keeps the words around them', () => {
    expect(tidyName('Small house big family ❤️')).toBe('Small house big family')
    expect(tidyName('💻 Computer')).toBe('Computer')
  })

  it('caps the length', () => {
    expect(tidyName('x'.repeat(200))).toHaveLength(80)
  })

  it('falls back to the caption when the title says nothing', () => {
    // a stop word cannot open a title, so the caption starts at its first real word
    expect(rowTitle('', 'A weathered stone lighthouse on a rocky headland.')).toBe(
      'weathered stone lighthouse rocky headland',
    )
    expect(rowTitle('...', 'A weathered stone lighthouse.')).toBe('weathered stone lighthouse')
  })

  it('falls back to model when even the caption is empty', () => {
    expect(rowTitle('', '')).toBe('model')
    expect(rowTitle('   ', '   ')).toBe('model')
  })

  it('drops a stop word from the fallback title', () => {
    // 'a' and 'the' carry no meaning, so they cannot open a title
    expect(fallbackTitle('the a of an old wooden boat')).toBe('old wooden boat')
  })

  it('keeps a title that is only punctuation out of the index', () => {
    expect(indexTokens('...').length).toBe(0)
  })
})
