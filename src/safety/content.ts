// The content rules that apply to every source, not just to what the user typed.
//
// Two lists. Fan art is a character or a piece of somebody else's world; explicit is material
// that shows a body. Neither is a slur or a swear word, so neither lives in words.ts, which holds
// the blocklist the prompt box refuses on. A place name that merely contains a shorter word
// stays allowed: a word only counts when it stands alone.
//
// The lists are read over a title, its tags and a caption together. Sketchfab runs words
// together ('sexygirl', 'fnafar', 'pokemon3d') or splits them ('fan-art', 'sonic_the_hedgehog'),
// so a stem matches inside a run of up to three words, while a word matches only when it stands
// alone. As a stem it would eat 'panasonic', 'marionette', 'sextant' or 'Essex'.

export type Guard = { ok: true } | { ok: false; reason: string }

export const EXPLICIT_STEMS = [
  'nsfw', 'nude', 'naked', 'porn', 'hentai', 'lewd', 'erotic', 'sexy', 'boob', 'topless',
  'nipple', 'lingerie', 'fetish', 'ahegao', 'genital', 'penis', 'vagina', 'dildo', 'xxx',
]

export const EXPLICIT_WORDS = [
  'sex', 'sexual', 'breast', 'breasts', 'bikini', 'thong', 'stripper', 'futa', 'yiff',
]

export const FANART_STEMS = [
  'fanart', 'fanmade', 'fanmodel', 'fangame', 'fanwork', 'fanfic', 'fandom', 'pokemon', 'pikachu',
  'fnaf', 'fivenights', 'fortnite', 'minecraft', 'roblox', 'naruto', 'zelda', 'starwars',
  'overwatch', 'genshin', 'undertale', 'deltarune', 'vrchat', 'disney', 'pixar', 'spongebob',
  'deadpool', 'spiderman', 'batman', 'superman', 'avengers', 'harrypotter',
  'hogwarts', 'finalfantasy', 'dragonball', 'leagueoflegends', 'valorant',
  'warhammer40k', 'supermario', 'mariokart', 'mariobros', 'sonicthehedgehog', 'marvelcomics',
  'marvelstudios', 'stormtrooper', 'darthvader', 'mandalorian', 'amongus', 'hellokitty',
  'sailormoon', 'jojo', 'evangelion', 'gundam', 'hollowknight', 'cuphead', 'sirenhead',
  'pokeball', 'startrek', 'residentevil', 'mortalkombat', 'dragonquest', 'enderman', 'persona4',
  'persona5', 'magicthegathering', 'masterchief', 'tombraider', 'laracroft', 'metroid',
  'kingdomhearts', 'streetfighter', 'tekken', 'godofwar', 'kratos', 'skyrim',
  'elderscrolls', 'darksouls', 'eldenring', 'bloodborne', 'halflife', 'counterstrike', 'csgo',
  'apexlegends', 'warcraft', 'starcraft', 'animalcrossing', 'splatoon', 'metalgear',
  'assassinscreed', 'silenthill', 'gameofthrones', 'lordoftherings', 'gandalf',
  'jurassicpark', 'ghostbusters', 'doctorwho', 'tardis', 'dalek', 'scoobydoo', 'winniethepooh',
  'peppapig', 'pawpatrol', 'grandtheftauto', 'ironman', 'captainamerica', 'wonderwoman',
  'harleyquinn', 'dccomics', 'robocop', 'godzilla', 'triforce', 'hyrule', 'plantsvszombies',
  'veggietales', 'pokken', 'freefire', 'miraculousladybug', 'saintseiya', 'beetlejuice',
  'friday13th', 'fridaythe13th', 'jasonvoorhees', 'titanfall', 'aloneinthedark', 'fornite',
  'madeinabyss', 'fnati', 'couragethecowardlydog', 'hillclimbracing', 'hoth', 'fallout4',
  'fallout76', 'nukacola', 'hellboy', 'mjolnir', 'mylittlepony', 'twilightsparkle',
  'swordartonline', 'kirito', 'asiimov',
]

export const FANART_WORDS = [
  'fanon', 'anime', 'manga', 'mmd', 'mario', 'luigi', 'bowser', 'yoshi', 'kirby', 'sonic',
  'marvel', 'hulk', 'thanos', 'groot', 'yoda', 'vader', 'spyro', 'shrek', 'minion', 'minions',
  'totoro', 'goku', 'pacman', 'mickey', 'simpsons', 'waifu', 'chibi', 'cosplay', 'jedi', 'sith',
  'lightsaber', 'eevee', 'charmander', 'squirtle', 'bulbasaur', 'gengar', 'freddy', 'fazbear',
  'springtrap', 'foxy', 'lego', 'gta', 'r2d2', 'c3po', 'bb8', 'xmen', 'lotr', 'witcher',
  'transformers', 'thor',
]

// Lowercase ascii, so 'Pokémon' reads as 'pokemon' and not as 'pok' and 'mon'.
export const fold = (text: string) =>
  text.normalize('NFKD').replace(/\p{M}+/gu, '').replace(/[^\x20-\x7e]/g, '').toLowerCase()

const parts = (text: string) => text.match(/[a-z0-9]+/g) ?? []

// One guard for one kind of unwanted row, read over the title, the tags and the caption
// together. A stem is looked for inside runs of up to `reach` words; a word only stands alone.
export const makeGuard = (stems: string[], words: string[], reach = 3) => {
  const stemSet = new Set(stems)
  const wordSet = new Set(words)
  return (text: string): boolean => {
    const p = parts(fold(text))
    if (!p.length) return false
    const held = new Set(p)
    for (const w of wordSet) if (held.has(w)) return true
    if (!stemSet.size) return false
    for (let n = 1; n <= reach; n++) {
      for (let i = 0; i + n <= p.length; i++) {
        const run = p.slice(i, i + n).join('')
        for (const s of stemSet) if (run.includes(s)) return true
      }
    }
    return false
  }
}

// A ceiling fan is not fan art: 'fan' alone never counts.
export const isFanArt = makeGuard(FANART_STEMS, FANART_WORDS, 3)

// Explicit words are read inside a single word, because across words they find 'happen is'.
export const isExplicit = makeGuard(EXPLICIT_STEMS, EXPLICIT_WORDS, 1)

// The reason a row is refused. The matched word is never named, so a caller cannot show it.
export const CONTENT_REFUSAL = 'That result is not allowed here.'

export type ContentVerdict = { ok: true } | { ok: false; reason: string }

// The whole content rule for a row of text: no fan art and nothing explicit. The app's own
// blocklist is folded in by the caller, so a title that says a refused word is refused too.
export const checkContent = (
  text: string,
  extra: { fanArt?: (t: string) => boolean; explicit?: (t: string) => boolean } = {}
): ContentVerdict => {
  const fanArt = extra.fanArt ?? isFanArt
  const explicit = extra.explicit ?? isExplicit
  if (fanArt(text) || explicit(text)) return { ok: false, reason: CONTENT_REFUSAL }
  return { ok: true }
}
