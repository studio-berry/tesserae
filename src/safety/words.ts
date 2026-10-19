// Words refused on sight. Short on purpose: every entry has no innocent use as a one-word
// prompt, and the token guard matches whole words, so nothing here eats 'class' or 'scunthorpe'.
export type Kind = 'slur' | 'profane'

export type Entry = { word: string; kind: Kind }

// slurs come first so they win when a line holds several kinds of hit
const SLURS = [
  'beaner', 'chink', 'coon', 'darkie', 'dyke', 'fag', 'faggot', 'faggots', 'fags', 'gook',
  'gypo', 'jigaboo', 'kike', 'nigga', 'niggas', 'nigger', 'paki', 'raghead', 'redskin',
  'retard', 'retards', 'shemale', 'spic', 'towelhead', 'trannie', 'tranny', 'wetback',
]

const PROFANE = [
  'arsehole', 'ass', 'asshole', 'bastard', 'bitch', 'bitches', 'bollocks', 'bullshit', 'cock',
  'cunt', 'dick', 'dickhead', 'fuck', 'fucked', 'fucker', 'fucking', 'hentai', 'motherfucker',
  'piss', 'porn', 'porno', 'prick', 'pussy', 'shit', 'shitty', 'slut', 'tosser', 'twat',
  'wanker', 'whore',
]

export const BLOCKED: Entry[] = [
  ...SLURS.map((word) => ({ word, kind: 'slur' as const })),
  ...PROFANE.map((word) => ({ word, kind: 'profane' as const })),
]
