import { useFrame, useThree } from '@react-three/fiber'
import { BloomEffect, Effect, EffectAttribute, EffectComposer, EffectPass, RenderPass } from 'postprocessing'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Mode, THEMES, Theme } from './core'
import { Atlas, TILE, TILE_FONT } from './glyphs'

// Grid mode: the stage draws opaque splats (ink in alpha), and this pass reads them back one
// character cell at a time, the way a terminal would: each cell takes the glyph its ink calls for.
// The gradient across the cell picks a direction glyph where the edge runs across the screen, so
// the object keeps its shape instead of turning into a field of letters.
const asciiFrag = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uCount;
uniform float uJitter;
uniform vec2 uCell;    // cell size in device pixels
uniform vec2 uGlyph;   // how much of an atlas tile one cell spans
uniform vec3 uBg;
uniform float uLight;
uniform float uTime;
uniform float uCols;
uniform float uRows;
uniform float uOrient;
uniform float uOrientBase;
uniform float uOrientCount;
uniform float uEdge;
uniform float uScan;   // 1 = faint scanlines and a vignette, the way a terminal reads
uniform float uVig;
uniform float uLod;    // atlas mip level for one cell; cell seams would otherwise ask for the smallest

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec2 tileUV(float i, vec2 local) {
  return vec2((mod(i, uCols) + local.x) / uCols, (floor(i / uCols) + local.y) / uRows);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 px = uv * resolution;
  vec2 cell = floor(px / uCell);
  vec2 c0 = (cell + 0.5) * uCell / resolution, d = uCell / resolution * 0.25;
  vec4 s = texture2D(inputBuffer, c0) * 0.4
    + (texture2D(inputBuffer, c0 + vec2(d.x, 0.0)) + texture2D(inputBuffer, c0 - vec2(d.x, 0.0))
    + texture2D(inputBuffer, c0 + vec2(0.0, d.y)) + texture2D(inputBuffer, c0 - vec2(0.0, d.y))) * 0.15;
  float ink = clamp(s.a, 0.0, 1.0);
  vec3 col = s.rgb / max(s.a, 1e-4);
  float h = hash(cell);
  float r = hash(vec2(floor(uTime * 0.1 + h * 50.0), h));
  // a pick past either end of the ramp folds back in, so the brightest cells keep their variety
  float top = uCount - 1.0;
  float want = pow(ink, 0.8) * top + (r - 0.5) * uJitter;
  want = top - abs(top - abs(want));
  float idx = clamp(floor(want + 0.5), 0.0, top);
  // the ink gradient runs across the edge, so the line itself is perpendicular to it
  vec2 line = vec2(-(texture2D(inputBuffer, c0 + vec2(0.0, d.y)).a - texture2D(inputBuffer, c0 - vec2(0.0, d.y)).a),
                    texture2D(inputBuffer, c0 + vec2(d.x, 0.0)).a - texture2D(inputBuffer, c0 - vec2(d.x, 0.0)).a);
  float slope = length(line);
  float phi = atan(line.x, -line.y);
  phi = phi < 0.0 ? phi + 3.14159265 : phi;
  float onEdge = uOrient * step(uEdge, slope);
  idx = mix(idx, uOrientBase + clamp(floor(phi * uOrientCount / 3.14159265), 0.0, uOrientCount - 1.0), onEdge);
  // screen y runs up and a tile's own y runs down from its top, so the cell flips it
  vec2 t = 0.5 + (fract(px / uCell) - 0.5) * vec2(1.0, -1.0) * uGlyph;
  float m = all(greaterThanEqual(t, vec2(0.0))) && all(lessThanEqual(t, vec2(1.0))) ? textureLod(uAtlas, tileUV(idx, t), uLod).a : 0.0;
  m *= smoothstep(0.03, 0.09, ink);
  vec3 c = uLight > 0.5 ? col : col / max(max(col.r, col.g), max(col.b, 1e-3)) * (0.45 + 0.55 * ink);
  float vig = mix(1.0, 1.0 - 0.35 * pow(distance(uv, vec2(0.5)) * 1.35, 2.4), uVig);
  float scan = mix(1.0, 0.92 + 0.08 * step(0.5, fract(px.y / max(1.0, uCell.y))), uScan);
  outputColor = vec4(mix(uBg, c * scan, m * clamp(0.3 + ink * 1.1, 0.0, 1.0)) * vig, 1.0);
}`

class AsciiEffect extends Effect {
  constructor() {
    super('AsciiEffect', asciiFrag, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['uAtlas', new THREE.Uniform(null)], ['uCount', new THREE.Uniform(1)], ['uJitter', new THREE.Uniform(0)],
        ['uCell', new THREE.Uniform(new THREE.Vector2(8, 16))], ['uGlyph', new THREE.Uniform(new THREE.Vector2(0.5, 1))],
        ['uBg', new THREE.Uniform(new THREE.Color())], ['uLight', new THREE.Uniform(0)], ['uTime', new THREE.Uniform(0)],
        ['uCols', new THREE.Uniform(1)], ['uRows', new THREE.Uniform(1)], ['uOrient', new THREE.Uniform(0)],
        ['uOrientBase', new THREE.Uniform(0)], ['uOrientCount', new THREE.Uniform(8)],
        ['uEdge', new THREE.Uniform(0.12)], ['uScan', new THREE.Uniform(0)], ['uVig', new THREE.Uniform(0)],
        ['uLod', new THREE.Uniform(0)],
      ]),
    })
  }
}

// cell font size in CSS px: smaller screens get smaller type so the object keeps enough cells
export const gridFont = (w: number, h: number) => Math.max(8, Math.min(14, Math.round(Math.min(w, h) / 58)))

export function Post({ mode, theme, atlas, orient }: { mode: Mode; theme: Theme; atlas: Atlas; orient: boolean }) {
  const { gl, scene, camera, size, viewport } = useThree()
  const composer = useMemo(() => new EffectComposer(gl, { frameBufferType: THREE.HalfFloatType }), [gl])
  const ascii = useMemo(() => new AsciiEffect(), [])
  const bloom = useMemo(() => new BloomEffect({ mipmapBlur: true, intensity: 0.45, luminanceThreshold: 0.45, luminanceSmoothing: 0.3, radius: 0.6 }), [])
  const active = mode === 'grid' || theme === 'dark'

  useEffect(() => {
    composer.removeAllPasses()
    composer.addPass(new RenderPass(scene, camera))
    if (mode === 'grid') composer.addPass(new EffectPass(camera, ascii))
    if (theme === 'dark') composer.addPass(new EffectPass(camera, bloom))
  }, [composer, scene, camera, mode, theme, ascii, bloom])

  useEffect(() => { composer.setSize(size.width, size.height) }, [composer, size, viewport.dpr])

  useEffect(() => {
    const u = ascii.uniforms
    u.get('uAtlas')!.value = atlas.tex
    u.get('uCount')!.value = atlas.count
    u.get('uJitter')!.value = atlas.jitter
    u.get('uCols')!.value = atlas.cols
    u.get('uRows')!.value = atlas.rows
    u.get('uOrientBase')!.value = atlas.orient.base
    u.get('uOrientCount')!.value = atlas.orient.count
  }, [ascii, atlas])

  useEffect(() => {
    const u = ascii.uniforms
    u.get('uBg')!.value.set(THEMES[theme].bg)
    u.get('uLight')!.value = theme === 'light' ? 1 : 0
    // scanlines and a vignette finish the terminal look, but they fight paper, so light theme keeps them off
    u.get('uScan')!.value = mode === 'grid' && theme === 'dark' ? 1 : 0
    u.get('uVig')!.value = mode === 'grid' && theme === 'dark' ? 1 : 0
    bloom.intensity = mode === 'grid' ? 0.35 : mode === 'letters' ? 0.45 : 0.55
    bloom.luminanceMaterial.threshold = mode === 'dots' ? 0.25 : 0.45
  }, [ascii, bloom, theme, mode])

  useEffect(() => { ascii.uniforms.get('uOrient')!.value = mode === 'grid' && orient ? 1 : 0 }, [ascii, orient, mode])

  useFrame((state, dt) => {
    if (!active) { gl.render(scene, camera); return }
    if (mode === 'grid') {
      // Plex Mono advances 0.6 em; cells are a little taller than the type for line spacing
      const f = gridFont(size.width, size.height) * viewport.dpr, cw = f * 0.6, ch = f * 1.2
      ascii.uniforms.get('uCell')!.value.set(cw, ch)
      ascii.uniforms.get('uGlyph')!.value.set((cw * TILE_FONT) / (f * TILE), (ch * TILE_FONT) / (f * TILE))
      // one device pixel spans TILE_FONT / f atlas texels; half a level sharper keeps thin strokes
      ascii.uniforms.get('uLod')!.value = Math.max(0, Math.log2(TILE_FONT / f) - 0.5)
      ascii.uniforms.get('uTime')!.value = state.clock.elapsedTime
      // a cell has to stand out from its neighbours before it counts as an edge
      ascii.uniforms.get('uEdge')!.value = 0.16 + 0.5 * (1 - Math.min(1, Math.min(size.width, size.height) / 1200))
    }
    composer.render(dt)
  }, 1)

  return null
}
