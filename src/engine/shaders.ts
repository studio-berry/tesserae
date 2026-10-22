// Point shaders. Every dot carries its surface normal, so light falls on the object the way it
// would on the real surface: the lit side takes heavier characters, the shadow side lighter
// ones, and a specular glint reaches for # % @.
//
// The dots move on the GPU. Each one holds the state it left (aFrom and the aPrev* attributes)
// and the state it is going to (position and the plain attributes); aRel says when it started.
// The spring, the normals, the ripples and the scan band are then a function of the clock alone,
// which is what lets an idle frame upload nothing and do no work at all.

// omega = sqrt(K) = 3.31662, zeta = DAMP / (2 omega) = 0.93467, omega_d = omega sqrt(1 - zeta^2)
// = 1.17914, so displacement from the target decays as exp(-zeta omega t) (cos + (zeta omega /
// omega_d) sin). Stage.tsx evaluates the same curve on the CPU, but only when a target changes.
const SPRING = /* glsl */ `
float springDecay(float t) {
  return exp(-3.1 * t) * (cos(1.17914 * t) + 2.62924 * sin(1.17914 * t));
}`

// Tile i of the atlas sits at column i mod uCols, row floor(i / uCols); a tile's own coords run
// down from its top-left, matching gl_PointCoord.
export const TILE_UV = /* glsl */ `
uniform float uCols;
uniform float uRows;
vec2 tileUV(float i, vec2 local) {
  return vec2((mod(i, uCols) + local.x) / uCols, (floor(i / uCols) + local.y) / uRows);
}`

export const pointVert = /* glsl */ `
attribute vec3 aColor;
attribute vec3 aNormal;
attribute vec3 aFrom;
attribute vec3 aPrevNormal;
attribute vec3 aPrevColor;
attribute float aPrevSize;
attribute float aPrevAlpha;
attribute float aRel;
attribute float aOrder;
attribute float aSize;
attribute float aAlpha;
attribute float aSeed;
uniform float uTime;
uniform float uEnter;
uniform float uPhase;        // 0 idle, 1 assembling, 2 scattering
uniform float uScale;
uniform vec3 uLightDir;      // view space
uniform float uShade;        // 0 = flat, 1 = fully lit by the light
uniform float uBackFade;     // fade dots whose surface faces away (used when there is no occluder)
uniform float uTwoSided;     // light the back face too, for open surfaces
uniform float uSizeMul;
uniform float uModelScale;   // the model's own scale, so object glyphs grow while dust keeps its size
uniform float uMode;
uniform vec4 uScan;          // xyz direction, w start time, negative when nothing is scanning
uniform vec4 uRipples[4];    // xyz centre, w birth time
uniform float uRipple;       // how many of the four are live
uniform vec4 uGrab;          // xyz point, w 0 idle 1 held
uniform float uGrabMode;     // 1 brighten and lift, 2 pull toward the point
uniform vec4 uPop;           // xyz point, w birth time of a double tap, negative when none
uniform float uOrient;       // 1 while direction glyphs replace the ramp along edges
uniform float uOrientCount;
uniform float uEdge;         // how wide a band around the silhouette reads as an edge
varying vec3 vColor;
varying float vInk;
varying float vSpec;
varying float vSeed;
varying float vAngle;        // screen angle of the surface at this dot
varying float vEdgeW;        // 1 on the silhouette, 0 on a face turned to the camera
${SPRING}

void main() {
  float tau = max(0.0, uTime - aRel);
  vec3 p = position + (aFrom - position) * springDecay(tau);
  vec3 an = mix(aNormal, aPrevNormal, exp(-7.0 * tau));
  vec3 ac = mix(aColor, aPrevColor, exp(-5.0 * tau));
  float asz = mix(aSize, aPrevSize, exp(-5.0 * tau));
  float aal = mix(aAlpha, aPrevAlpha, exp(-5.0 * tau));
  float has = step(0.04, dot(an, an));

  // the sweep, the scan band, the ripples and the scatter are lighting events; none of them
  // moves the target, so none of them needs the CPU
  float b = 1.0, glow = 0.0;
  if (has > 0.5) {
    if (uPhase > 0.5 && uPhase < 1.5 && uTime > aRel) {
      float age = (uTime - aRel) / 0.9;
      if (age < 1.0) { glow = 1.0 - age; b += glow * 1.2; }
    }
    if (uScan.w >= 0.0) {
      float s = (uTime - uScan.w) / 2.6;
      float w = 1.0 - abs(dot(p, uScan.xyz) / 1.9 - (-1.25 + s * 2.5)) / 0.14;
      if (s >= 0.0 && s <= 1.0 && w > 0.0) { glow = max(glow, w); b += w * 1.3; }
    }
    for (int i = 0; i < 4; i++) {
      if (float(i) >= uRipple) break;
      vec4 r = uRipples[i];
      float age = uTime - r.w;
      float k = exp(-pow((distance(p, r.xyz) - age * 1.6) / 0.16, 2.0)) * exp(-age * 1.1);
      if (k > 0.01) { p += an * (k * 0.17); b += k * 1.6; glow = max(glow, k); }
    }
    if (uPhase > 1.5) {
      // scatter: blow outward along the surface normal and come back together
      float u = clamp((uTime - uEnter - aOrder * 0.5) / 2.2, 0.0, 1.0);
      float amt = (u < 0.22 ? 1.0 - pow(1.0 - u / 0.22, 3.0) : 1.0 - smoothstep(0.22, 1.0, u)) * (0.35 + aSeed * 0.25);
      p += (an * 0.8 + p * 0.3) * amt;
      glow = max(glow, amt * 0.6);
    }
    if (uGrab.w > 0.5) {
      float g = exp(-pow(distance(p, uGrab.xyz) * 2.4, 2.0));
      if (uGrabMode > 1.5) p += normalize(uGrab.xyz - p + vec3(1e-5)) * g * 0.18;
      else if (uGrabMode > 0.5) p += an * g * 0.12;
      b += g * 0.9;
      glow = max(glow, g);
    }
    // double tap: the glyphs around the point blow out and spring back
    if (uPop.w >= 0.0) {
      float age = uTime - uPop.w;
      if (age < 0.9) {
        float k = exp(-pow(distance(p, uPop.xyz) * 3.5, 2.0)) * (1.0 - age / 0.9);
        p += an * k * 0.35;
        b += k * 2.0;
        glow = max(glow, k);
      }
    }
  }
  // dust drifts on its own; it never needs a CPU update
  p += vec3(sin(uTime * 0.7 + aSeed * 6.283), cos(uTime * 0.6 + aSeed * 9.424), sin(uTime * 0.5 + aSeed * 3.141)) * mix(0.06, 0.003, has);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = asz * (1.0 + glow * 0.25) * uSizeMul * mix(1.0, uModelScale, has) * uScale / -mv.z;

  vec3 n = normalize(normalMatrix * an + vec3(0.0, 0.0, 1e-5));
  vec3 v = normalize(-mv.xyz);
  float facing = dot(n, v);
  if (uTwoSided > 0.5 && facing < 0.0) { n = -n; facing = -facing; }
  float lam = max(dot(n, uLightDir), 0.0);
  float spec = pow(max(dot(n, normalize(uLightDir + v)), 0.0), 24.0);
  float rim = pow(1.0 - clamp(facing, 0.0, 1.0), 3.0);
  float lit = 0.16 + 0.84 * lam + 0.55 * spec + 0.06 * rim;
  float back = mix(1.0, smoothstep(-0.1, 0.3, facing), uBackFade * has);
  // glyphs pile up where the surface turns away; thin them so the silhouette stays a line, not a glow
  float graze = mix(1.0, mix(0.5, 1.0, smoothstep(0.0, 0.45, facing)), has);
  vInk = aal * mix(1.0, lit, uShade * has) * back * graze * b * smoothstep(0.4, 2.0, -mv.z);
  // near the silhouette the surface runs across the screen; hand the fragment shader the angle of
  // that line, measured from the vertical in screen coords, so it can pick a glyph shaped like the
  // edge the way a person drawing ascii art would
  vec3 tan3 = n - v * facing;
  vec2 tan2 = length(tan3) > 1e-4 ? normalize(tan3.xy) : vec2(1.0, 0.0);
  float a = atan(-tan2.y, -tan2.x);
  vAngle = a < 0.0 ? a + 3.14159265 : a;
  vEdgeW = has * (1.0 - smoothstep(0.0, uEdge, abs(facing)));
  // Samples are even on the surface, but a face turned away squeezes them together on screen by
  // 1 / facing. Keeping only that share of them holds the screen spacing even, with a floor so the
  // silhouette still reads as a line. The grid averages ink per cell, so it keeps every dot.
  float keep = mix(1.0, clamp(abs(facing) / 0.6, 0.3, 1.0), has * step(uMode, 1.5));
  if (fract(aSeed * 7919.37) > keep) { gl_PointSize = 0.0; vInk = 0.0; }
  // dots mode is a halftone: lit dots swell, shadowed ones shrink
  if (uMode > 0.5 && uMode < 1.5) gl_PointSize *= mix(1.0, mix(0.35, 1.3, clamp(vInk * 0.72, 0.0, 1.0)), has);
  // in the grid every dust mote would claim a whole cell; keep most of them below the threshold
  if (uMode > 1.5) vInk *= mix(0.55, 1.0, has);
  vSpec = spec * has * back;
  vColor = ac;
  vSeed = aSeed;
}`

export const pointFrag = /* glsl */ `
uniform float uLight;   // light theme
uniform float uMode;    // 0 letters, 1 dots, 2 splat (feeds the grid effect)
uniform float uTime;
uniform float uCount;
uniform float uJitter;
uniform float uOrient;
uniform float uOrientCount;
uniform float uOrientBase;
uniform vec3 uGlint;
uniform sampler2D uAtlas;
varying vec3 vColor;
varying float vInk;
varying float vSpec;
varying float vSeed;
varying float vAngle;
varying float vEdgeW;
${TILE_UV}
void main() {
  vec3 col = mix(vColor, uGlint, clamp(vSpec * 0.7, 0.0, 0.6));
  if (uMode < 0.5) {
    // brighter dots land on inkier glyphs; each dot re-rolls its glyph only every ~10 s
    float ink = clamp(vInk * 0.72, 0.0, 1.0);
    float roll = floor(uTime * 0.1 + vSeed * 50.0);
    float r = fract(sin(roll * 12.9898 + vSeed * 78.233) * 43758.5453);
    // a soft knee rather than a clamp, so a highlight still spreads over the heavy end of the ramp
    // instead of piling onto its last glyph
    float tone = 1.0 - exp(-1.25 * vInk);
    float top = uCount - 1.0;
    float want = tone * top + (r - 0.5) * uJitter;
    // a pick past either end folds back in, so the faintest and brightest patches keep their variety
    want = top - abs(top - abs(want));
    float idx = clamp(floor(want + 0.5), 0.0, top);
    // along an edge the glyph follows the surface instead of the light
    float onEdge = step(0.5, vEdgeW) * uOrient;
    idx = mix(idx, uOrientBase + clamp(floor(vAngle * uOrientCount / 3.14159265), 0.0, uOrientCount - 1.0), onEdge);
    float m = texture2D(uAtlas, tileUV(idx, gl_PointCoord)).a;
    if (m < 0.03) discard;
    vec3 c = uLight > 0.5 ? col : col / max(max(col.r, col.g), max(col.b, 1e-3)) * (0.45 + 0.55 * ink);
    gl_FragColor = vec4(c, m * clamp(0.25 + ink * 1.2, 0.0, 1.0) * smoothstep(0.0, 0.07, ink) * mix(1.0, 1.3, onEdge));
  } else if (uMode < 1.5) {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float a = clamp(vInk, 0.0, 1.6);
    if (uLight > 0.5) {
      gl_FragColor = vec4(col, (smoothstep(0.62, 0.42, d) + exp(-d * d * 6.0) * 0.12) * min(1.0, a));
    } else {
      float core = smoothstep(0.34, 0.0, d), body = smoothstep(0.5, 0.18, d), halo = exp(-d * d * 5.0) * 0.35;
      gl_FragColor = vec4(mix(col, vec3(1.0), core * 0.25), (body * 0.85 + halo) * a * 0.8);
    }
  } else {
    // opaque splat: ink rides in alpha, colour is premultiplied so the grid can average cells
    if (length(gl_PointCoord - 0.5) > 0.5) discard;
    float ink = clamp(vInk * 0.72, 0.0, 1.0);
    gl_FragColor = vec4(col * ink, ink);
    return;
  }
  #include <colorspace_fragment>
}`

// The ground: a soft ellipse of the faintest glyphs under the object, so it sits somewhere
// instead of floating in the dust.
export const shadowVert = /* glsl */ `
attribute float aInk;
attribute float aSeed;
uniform float uTime;
uniform float uScale;
uniform float uModelScale;
varying float vInk;
varying float vSeed;
void main() {
  vec3 p = position;
  // a slow drift, so the pool of glyphs breathes instead of sitting there as a decal
  p.x += sin(uTime * 0.35 + aSeed * 6.283) * 0.012;
  p.z += cos(uTime * 0.31 + aSeed * 4.712) * 0.012;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.018 + aSeed * 0.006) * uModelScale * uScale / -mv.z;
  vInk = aInk;
  vSeed = aSeed;
}`

export const shadowFrag = /* glsl */ `
uniform float uCount;
uniform sampler2D uAtlas;
uniform vec3 uColor;
varying float vInk;
varying float vSeed;
${TILE_UV}
void main() {
  // the ground only ever uses the faintest few glyphs, so it reads as light rather than as text
  float idx = clamp(floor(vSeed * 2.99) + floor(vInk * 2.0), 0.0, min(3.0, uCount - 1.0));
  float m = texture2D(uAtlas, tileUV(idx, gl_PointCoord)).a;
  if (m < 0.05) discard;
  gl_FragColor = vec4(uColor, m * clamp(vInk, 0.0, 1.0) * 0.55);
  #include <colorspace_fragment>
}`

// The occluder: the object's own surface, drawn into the depth buffer only and nudged a hair
// away from the camera, so dots on the near side pass and dots behind the object do not.
export const occluderVert = /* glsl */ `
uniform float uPush;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  mv.xyz += normalize(mv.xyz) * uPush;
  gl_Position = projectionMatrix * mv;
}`
export const occluderFrag = /* glsl */ `void main() { gl_FragColor = vec4(0.0); }`
