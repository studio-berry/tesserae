
import { tidyName } from './src/objects/objaverse-index.ts'
// the names the tests use
for (const n of ['Anchor.stl', 'Anchor.svg', 'Anchor rose.svg', 'Geodesic dome.stl', 'Sonic the Hedgehog.svg']) {
  console.log(JSON.stringify(n), '->', JSON.stringify(tidyName(n)))
}
