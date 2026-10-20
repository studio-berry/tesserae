// The reviewed denylist: models that the word filters cannot catch.
//
// The filters read words, and words cannot reach zero. A model called "Nuka Cola" says
// nothing a word list would refuse, and a model whose title is "Halo 3: ODST Prop" is
// still a piece of somebody else's world. So the top matches of a list of 847 everyday
// nouns were looked at by eye, and every model that belongs to a named work, a brand or
// a game was written down here.
//
// A uid is a model. The build drops these rows, so they never reach the app.
//
// The title is kept beside the uid so a reviewer can read what was dropped and why.
// The titles are the ones the review found; they are not filtered at runtime.

export type Denied = { uid: string; title: string }

export const DENYLIST: Denied[] = [
  { uid: '8ae5e601c95a42bd8a1baa45ecd923f8', title: 'Dead frontier Rifle caliber AK 47 machine gun' },
  { uid: '3db96d10a1a44347a38b962e6e82157a', title: 'Halo Magnum курсовая' },
  { uid: '8f3c0241ceea47a49334e78c3a379f75', title: 'Dead frontier Reindeer zombie dog' },
  { uid: '99e43ce64093406f864b74dd7e441c96', title: 'Halo 1999 Magnum' },
  { uid: 'f7966044396a4925ac8f673908011251', title: 'International Colobot Community 3D Logo' },
  { uid: '7b45769ec16e4575b3fdf3f324f1c471', title: 'Stylized MK5 Halo Helmet' },
  { uid: '8dc189a10b77494684ebaec1f2cab7f8', title: 'Dead frontier VEHICLE silver Hatchback' },
  { uid: 'f9141b9823794d61810ccfb05aed9a89', title: 'Dead frontier VEHICLE black Hatchback' },
  { uid: '425817e6b5a54c889d9edfb9283c3271', title: 'Nintendo Logo' },
  { uid: '9b8e8990186349dbb35a2d20d0981c67', title: 'Dead frontier Rifle caliber Dawn MAG machine gun' },
  { uid: 'fa017d30c379455885810fb022ed5c5c', title: 'Dead frontier Deathrow Hazmat Oxygen Tank' },
  { uid: 'e73739cd67ae405e9c7cb0874456a32c', title: 'Halo Battle Rifle' },
  { uid: 'ffb6079fd9e34d2db2972304daed7527', title: 'Dead frontier VEHICLE Red Hatchback' },
  { uid: '0dcfdb39d1f24569be49f32d898fb267', title: 'NINTENDO SWITCH' },
  { uid: 'afbd704313ee4f4e8f6013e06cbb48f7', title: 'Dead frontier Rifle caliber A10 Bull Shark MG' },
  { uid: '9e046bf9912841f8bb7f77c8fe878a63', title: 'Halo from Poly by Google' },
  { uid: '6f03c57182e449009b49d0de03083122', title: 'CrossFire\'s AK47 Buster Gold' },
  { uid: '820b077cf19f4570923159306b079dc5', title: 'M6G Halo Voxel' },
  { uid: '01397b0b1ba748e391279dcfa2e6b06e', title: 'Dead frontier dog zombie2' },
  { uid: '220bba47149448c9aae79043cb5f7b8e', title: 'Halo 3: ODST Prop [Remastered] - Sawhorse' },
  { uid: '1764a8470d4c477a957e96b8c79b7099', title: 'Warhammer' },
  { uid: '47949231f5d349209055218ab984deb0', title: 'Nintendo Switch Lite' },
  { uid: '99eec05dc860495998fd09e21cdc0ea8', title: 'Halo MA5B Assault Rifle' },
  { uid: 'a0b8b13853e34979a51f777d44eea49c', title: 'Halo 2 Anniversary Phantom' },
  { uid: 'db89ad2be1de47a0a31e63c9b7a2b4bc', title: 'Lowpoly Warhammer (Practise)' },
  { uid: '349d7290ef5847c28c791379864d6c83', title: 'CoLoBoT - Titanium' },
  { uid: '19d52d793b8a47ef949c44e7879827e2', title: 'Nintendo Switch' },
  { uid: '6d005f49faa64b15b7d37f98994b9230', title: 'PC Computer - Halo Combat Evolved - Banshee' },
  { uid: '8a4a164fc73243b6872607e3a572a778', title: 'Dead frontier Dog blood hound' },
  { uid: '83c167b23e5b4278bffb02d557a48305', title: 'Warhammer pipe' },
  { uid: '961d6215e3624c6eb861970acc953592', title: 'Super Nintendo Controller' },
  { uid: 'f1440a39fdab4f5282ad4a37fdcaa8c5', title: 'Nintendo Switch' },
  { uid: 'f2fe9ac89d384543a32fb53304e80706', title: 'Nintendo Switch Red and Blue' },
  { uid: 'fdeffafacb124fbc92db95f7beedfdfd', title: 'Nintendo Switch' },
  { uid: '0ca4a970186d4b7ca36d49d6e66115e7', title: 'nintendo-switch' },
  { uid: 'ae314dc3de994d2a8d7ea9dc052b28e0', title: 'Nintendo Switch' },
  { uid: 'ec675d81522940938db9c9d17422edbe', title: 'WEAPON-GUN-DOOM' },
  { uid: '5f117bb77ffa4f5dadeeabf29f18e581', title: 'Dead frontier BOSS Devil Hound' },
  { uid: 'b94e6a6a8c564fee81c2d794da6c5712', title: 'Nintendo Switch' },
  { uid: '6fd720a6ed5c4f6f8532fae44f688b6e', title: 'Halo M90S-HDB Shotgun Hardlight Bayonet' },
  { uid: 'a530c8c7eef04235bc865b85dcfc0ac8', title: 'Nintendo Switch Joycon' },
  { uid: '4bb27bd779d441d089a641c549845660', title: 'Halo ODST Helm v2' },
  { uid: '431e3c56ac324082b148325f82962ce9', title: 'Halo Combat Evolved - Sniper Rifle Ammo' },
  { uid: '0533f4a6d3ac4c628152d704494fcb6c', title: 'Nintendo Switch Model' },
]

// Whether a uid is on the list.
export const denied = (uid: string) => DENYLIST.some((d) => d.uid === uid)
