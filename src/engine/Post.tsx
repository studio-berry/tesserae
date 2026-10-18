import { useFrame, useThree } from '@react-three/fiber'
import { BloomEffect, Effect, EffectAttribute, EffectComposer, EffectPass, RenderPass } from 'postprocessing'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Mode, THEMES, Theme } from './core'
import { Atlas, TILE, TILE_FONT } from './glyphs'

// Grid mode: the stage draws opaque splats (ink in alpha), and this pass reads them back one
// character cell at a time, the way a terminal would: each cell takes the glyph its ink calls for.
const asciiFrag = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uCount;
uniform float uJitter;
uniform vec2 uCell;   // cell size in device pixels
uniform vec2 uGlyph;  // how much of an atlas tile one cell spans
uniform vec3 uBg;
uniform float uLight;
uniform float uTime;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 px = uv * resolution;
  vec2 cell = floor(px / uCell);
  vec2 c0 = (cell + 0.5) * uCell / resolution, d = uCell / resolution * 0.25;
  vec4 s = texture2D(inputBuffer, c0) * 0.4
    + (texture2D(inputBuffer, c0 + d) + texture2D(inputBuffer, c0 - d)
    + texture2D(inputBuffer, c0 + vec2(d.x, -d.y)) + texture2D(inputBuffer, c0 + vec2(-d.x, d.y))) * 0.15;
  float ink = clamp(s.a, 0.0, 1.0);
  vec3 col = s.rgb / max(s.a, 1e-4);
  float h = hash(cell);
  float r = hash(vec2(floor(uTime * 0.1 + h * 50.0), h));
  float idx = clamp(floor(pow(ink, 0.8) * (uCount - 1.0) + (r - 0.5) * uJitter + 0.5), 0.0, uCount - 1.0);
  vec2 t = 0.5 + (fract(px / uCell) - 0.5) * uGlyph;
  float m = all(greaterThanEqual(t, vec2(0.0))) && all(lessThanEqual(t, vec2(1.0))) ? texture2D(uAtlas, vec2((idx + t.x) / uCount, t.y)).a : 0.0;
  m *= smoothstep(0.03, 0.09, ink);
  vec3 c = uLight > 0.5 ? col : col / max(max(col.r, col.g), max(col.b, 1e-3)) * (0.45 + 0.55 * ink);
  outputColor = vec4(mix(uBg, c, m * clamp(0.3 + ink * 1.1, 0.0, 1.0)), 1.0);
}`

class AsciiEffect extends Effect {
  constructor() {
    super('AsciiEffect', asciiFrag, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['uAtlas', new THREE.Uniform(null)], ['uCount', new THREE.Uniform(1)], ['uJitter', new THREE.Uniform(0)],
        ['uCell', new THREE.Uniform(new THREE.Vector2(8, 16))], ['uGlyph', new THREE.Uniform(new THREE.Vector2(0.5, 1))],
        ['uBg', new THREE.Uniform(new THREE.Color())], ['uLight', new THREE.Uniform(0)], ['uTime', new THREE.Uniform(0)],
      ]),
    })
  }
}

// cell font size in CSS px: smaller screens get smaller type so the object keeps enough cells
export const gridFont = (w: number, h: number) => Math.max(8, Math.min(14, Math.round(Math.min(w, h) / 58)))

export function Post({ mode, theme, atlas }: { mode: Mode; theme: Theme; atlas: Atlas }) {
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
  }, [ascii, atlas])

  useEffect(() => {
    const u = ascii.uniforms
    u.get('uBg')!.value.set(THEMES[theme].bg)
    u.get('uLight')!.value = theme === 'light' ? 1 : 0
    bloom.intensity = mode === 'grid' ? 0.35 : mode === 'letters' ? 0.45 : 0.55
    bloom.luminanceMaterial.threshold = mode === 'dots' ? 0.25 : 0.45
  }, [ascii, bloom, theme, mode])

  useFrame((state, dt) => {
    if (!active) { gl.render(scene, camera); return }
    if (mode === 'grid') {
      // Plex Mono advances 0.6 em; cells are a little taller than the type for line spacing
      const f = gridFont(size.width, size.height) * viewport.dpr, cw = f * 0.6, ch = f * 1.2
      ascii.uniforms.get('uCell')!.value.set(cw, ch)
      ascii.uniforms.get('uGlyph')!.value.set((cw * TILE_FONT) / (f * TILE), (ch * TILE_FONT) / (f * TILE))
      ascii.uniforms.get('uTime')!.value = state.clock.elapsedTime
    }
    composer.render(dt)
  }, 1)

  return null
}
