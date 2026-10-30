// The lighting model, on the CPU.
//
// The vertex shader shades every glyph, and every headless renderer (the text snapshot, the ANSI
// stream, the CLI) has to agree with it or the same object looks like two different objects. This is
// the one place the model is written down; `SHADER_TWIN` is the GLSL it mirrors, kept beside it so a
// change to one is a change to the other rather than a divergence nobody notices.
//
// The model: a key light from the upper left, a tight specular lobe, a graze term so a silhouette
// keeps an edge instead of fading, and a small rim. The numbers are the shader's numbers.

export type Vec3 = { x: number; y: number; z: number }

export const KEY = 0.84
export const AMBIENT = 0.16
export const SPEC = 0.55
export const SHINE = 24
export const RIM = 0.06
export const GRAZE = 0.5
export const GRAZE_SOFT = 0.45
export const GAIN = 0.72
// a face turned more than this away from the viewer is not lit at all on a one-sided object
export const BACK_CUT = -0.05

export const SHADER_TWIN = `
float lam = max(0.0, dot(n, uLightDir));
vec3 hv = normalize(uLightDir + view);
float spec = pow(max(0.0, dot(n, hv)), 24.0);
float graze = 0.5 + 0.5 * smoothstep(0.0, 1.0, facing / 0.45);
float ink = uAlpha * (0.16 + 0.84 * lam + 0.55 * spec + 0.06 * pow(1.0 - clamp(facing, 0.0, 1.0), 3.0)) * graze * 0.72;
`

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const smooth = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t) }

export type Shaded = { facing: number; ink: number }

// `normal` is expected in the same space as `light` and `view` (view space), already turned for a
// two-sided surface by the caller when it asks for that.
export function shade(normal: Vec3, light: Vec3, view: Vec3, alpha: number, twoSided: boolean): Shaded | null {
  const facingRaw = normal.x * view.x + normal.y * view.y + normal.z * view.z
  const flip = twoSided && facingRaw < 0 ? -1 : 1
  const nx = normal.x * flip, ny = normal.y * flip, nz = normal.z * flip
  const facing = facingRaw * flip
  if (!twoSided && facing < BACK_CUT) return null
  const lam = Math.max(0, nx * light.x + ny * light.y + nz * light.z)
  let hx = light.x + view.x, hy = light.y + view.y, hz = light.z + view.z
  const hl = Math.hypot(hx, hy, hz) || 1
  hx /= hl; hy /= hl; hz /= hl
  const spec = Math.max(0, nx * hx + ny * hy + nz * hz) ** SHINE
  const graze = GRAZE + GRAZE * smooth(facing / GRAZE_SOFT)
  const ink = clamp01(alpha * (AMBIENT + KEY * lam + SPEC * spec + RIM * (1 - clamp01(facing)) ** 3) * graze * GAIN)
  return { facing, ink }
}
