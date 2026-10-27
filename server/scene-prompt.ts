// The words a scene writer is given, and the shape its answer has to arrive in.
//
// Kept apart from the call that makes it, so the same brief is used by the dev server's endpoint,
// by the spike that measured the model, and by the test that pins the parser.

// A scene is written against `sceneThree` in src/objects/scene.ts. Listing the constructors here
// rather than saying "three.js" is what keeps the model inside the namespace: a model told
// "three.js" reaches for FileLoader and ShaderMaterial and loses the whole scene to a refusal.
//
// Two lines in this brief are there because a model got them wrong on a measured run and the scene
// was thrown away: the page-size read (`window.innerWidth`) and a body that stopped before its
// return. Neither is a style note; both are the difference between a scene and nothing.
export const SYSTEM = `You build one 3D object as three.js geometry. Reply in exactly this shape and nothing else:

TITLE: <two to five words naming the object>
CODE:
<the body of a javascript function>

The body runs with two bindings:
- THREE: these constructors and no others: Group, Mesh, Points, BoxGeometry, SphereGeometry,
  CylinderGeometry, ConeGeometry, TorusGeometry, TorusKnotGeometry, CapsuleGeometry,
  IcosahedronGeometry, OctahedronGeometry, DodecahedronGeometry, TetrahedronGeometry,
  CircleGeometry, RingGeometry, PlaneGeometry, LatheGeometry, ExtrudeGeometry, TubeGeometry,
  Shape, CatmullRomCurve3, Vector2, Vector3, Euler, Color, MeshStandardMaterial,
  MeshBasicMaterial, MeshLambertMaterial, FrontSide, BackSide, DoubleSide
- rng: a seeded function returning a number from 0 up to 1

Rules for the code:
- Build a THREE.Group holding ONE object. The very last line of the body is: return group;
  A body that stops before that line is thrown away, so write the return before you run out of room.
- Compose it from primitives with position, rotation, scale and repetition. 1 to 40 meshes.
  Under 4000 triangles per mesh, so a sphere is fine at detail 16 and too heavy at detail 64.
- Roughly within 2 units of the origin, centred there, Y up, its front toward +Z. The app centres
  and scales it, so exact size does not matter, but two cues do: it must read from the front, and
  it must still read as the same object when it turns.
- Give it depth and structure rather than one flat slab: a body, then the parts that name it
  (a roof, a rim, a blade, a leg, a rail), then a few smaller details.
- Never read the page or the window. No window, innerWidth, innerHeight, devicePixelRatio,
  document or canvas: they do not exist where this runs. Size everything with plain numbers.
- Colours are numbers written in hex, as 0x8a5a2b. No strings, no images, no textures.
- No while loops, no do loops, no imports, no fetch, no document, nothing from outside the body.`

// A variant is a reroll: the same brief with the seed moved, so a second press gives a different
// reading of the prompt rather than the same object again.
export const userTurn = (prompt: string, seed: number) =>
  seed
    ? `${prompt}\n\nWrite a different reading of it from the last one, still clearly ${prompt}.`
    : prompt

export type Written = { title: string; code: string }

const TITLE = /^[\s>*`]*title\s*:\s*(.+)$/im
const CODE = /^[\s>*`]*code\s*:\s*$/im
const FENCE = /^[\s>*]*(```[a-z]*)?\s*$/i

// The reply as a title and a body of code.
//
// The format is two labelled lines rather than JSON, because a reply cut short is the failure this
// has to survive: JSON loses every character of a code string when the last brace is missing, while
// a labelled body is still all there.
//
// Measured replies broke the order rather than the shape: one opened straight into CODE: with the
// title left out, another put its TITLE after the code. So the two are found independently, the
// title wherever it is, and the code is what follows its label. A missing title is not a failed
// scene: the caller names it after the prompt. A missing code is, and so is an empty one.
export function parseReply(text: string): Written | null {
  const body = text.replace(/\r\n/g, '\n')
  const titled = body.match(TITLE)?.[1]?.trim().replace(/^[`"']|[`"']$/g, '').slice(0, 60) ?? ''
  const codeAt = body.search(CODE)
  if (codeAt < 0) return null
  const rest = body.slice(body.indexOf('\n', codeAt) + 1)
  // a title that arrived after the code is not part of it
  const cut = rest.search(TITLE)
  const body2 = cut >= 0 ? rest.slice(0, cut) : rest
  const code = body2
    .split('\n')
    .filter((line) => !FENCE.test(line))
    .join('\n')
    .replace(/```\s*$/g, '')
    .trim()
  if (!code) return null
  return { title: titled, code }
}
