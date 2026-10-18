// Point shaders. Every dot carries its surface normal, so light falls on the object the way it
// would on the real surface: the lit side takes heavier characters, the shadow side lighter
// ones, and a specular glint reaches for # % @.

export const pointVert = /* glsl */ `
attribute vec3 aColor;
attribute vec3 aNormal;
attribute float aSize;
attribute float aAlpha;
attribute float aSeed;
uniform float uScale;
uniform vec3 uLightDir;   // view space
uniform float uShade;     // 0 = flat, 1 = fully lit by the light
uniform float uBackFade;  // fade dots whose surface faces away (used when there is no occluder)
uniform float uTwoSided;  // light the back face too, for open surfaces
uniform float uSizeMul;
uniform float uMode;
varying vec3 vColor;
varying float vInk;
varying float vSpec;
varying float vSeed;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uSizeMul * uScale / -mv.z;
  float has = step(0.04, dot(aNormal, aNormal));
  vec3 n = normalize(normalMatrix * aNormal + vec3(0.0, 0.0, 1e-5));
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
  vInk = aAlpha * mix(1.0, lit, uShade * has) * back * graze * smoothstep(0.4, 2.0, -mv.z);
  // dots mode is a halftone: lit dots swell, shadowed ones shrink
  if (uMode > 0.5 && uMode < 1.5) gl_PointSize *= mix(1.0, mix(0.35, 1.3, clamp(vInk * 0.72, 0.0, 1.0)), has);
  // in the grid every dust mote would claim a whole cell; keep most of them below the threshold
  if (uMode > 1.5) vInk *= mix(0.55, 1.0, has);
  vSpec = spec * has * back;
  vColor = aColor;
  vSeed = aSeed;
}`

export const pointFrag = /* glsl */ `
uniform float uLight;   // light theme
uniform float uMode;    // 0 letters, 1 dots, 2 splat (feeds the grid effect)
uniform float uTime;
uniform float uCount;
uniform float uJitter;
uniform vec3 uGlint;
uniform sampler2D uAtlas;
varying vec3 vColor;
varying float vInk;
varying float vSpec;
varying float vSeed;
void main() {
  vec3 col = mix(vColor, uGlint, clamp(vSpec * 0.7, 0.0, 0.6));
  if (uMode < 0.5) {
    // brighter dots land on inkier glyphs; each dot re-rolls its glyph only every ~10 s
    float ink = clamp(vInk * 0.72, 0.0, 1.0);
    float roll = floor(uTime * 0.1 + vSeed * 50.0);
    float r = fract(sin(roll * 12.9898 + vSeed * 78.233) * 43758.5453);
    float idx = clamp(floor(pow(ink, 0.8) * (uCount - 1.0) + (r - 0.5) * uJitter + 0.5), 0.0, uCount - 1.0);
    float m = texture2D(uAtlas, vec2((idx + gl_PointCoord.x) / uCount, 1.0 - gl_PointCoord.y)).a;
    if (m < 0.03) discard;
    vec3 c = uLight > 0.5 ? col : col / max(max(col.r, col.g), max(col.b, 1e-3)) * (0.45 + 0.55 * ink);
    gl_FragColor = vec4(c, m * clamp(0.25 + ink * 1.2, 0.0, 1.0) * smoothstep(0.0, 0.07, ink));
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
