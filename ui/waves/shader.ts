/**
 * "Dark silk" background for the sign-in screens: a height field of slow, meandering waves
 * lit like satin, so faint blue-violet sheens ripple through pitch black.
 *
 * - A low-frequency domain warp bends straight sine waves into fabric-like folds.
 * - Four directional waves give the height field; its gradient is analytic (cheap enough for
 *   full-resolution rendering on phones) and becomes the surface normal.
 * - Lighting = soft satin sheen on slopes + a tight specular streak along crests.
 * - A slow luminance mask keeps most of the screen black; a vignette inks the edges.
 * - Touch/pointer adds a decaying ripple. Film-grain dithering removes banding in the
 *   near-black gradients (the main giveaway of "fake" dark gradients).
 *
 * The body is shared by WebGL (GLSL ES 1.0, via #defines) and Skia (SkSL).
 */
const BODY = /* glsl */ `
float hash12(float2 p) {
  float3 p3 = fract(float3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + float2(1.0, 0.0));
  float c = hash12(i + float2(0.0, 1.0));
  float d = hash12(i + float2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm2(float2 p) {
  return 0.6667 * vnoise(p) + 0.3333 * vnoise(p * 2.03 + 17.1);
}

float3 halcyxWaves(float2 fc, float2 res, float t, float2 ptr, float pAmt, float grain) {
  float s = min(res.x, res.y);
  float2 p = (fc - 0.5 * res) / s;

  // Slow warp: bends the waves into drifting folds.
  float2 w = float2(fbm2(p * 1.1 + float2(0.0, t * 0.05)), fbm2(p * 1.1 + float2(5.2, -t * 0.04))) - 0.5;
  float2 q = p + w * 0.6;

  // Height field = sum of directional waves; g = analytic gradient.
  float h = 0.0;
  float2 g = float2(0.0);
  float2 d;
  float k;
  float ph;
  d = normalize(float2(1.0, 0.35));  k = 3.1;  ph = dot(d, q) * k + t * 0.22;       h += 0.50 * sin(ph); g += 0.50 * k * cos(ph) * d;
  d = normalize(float2(-0.45, 1.0)); k = 4.7;  ph = dot(d, q) * k - t * 0.17 + 1.3; h += 0.30 * sin(ph); g += 0.30 * k * cos(ph) * d;
  d = normalize(float2(0.8, -0.6));  k = 7.3;  ph = dot(d, q) * k + t * 0.29 + 4.1; h += 0.14 * sin(ph); g += 0.14 * k * cos(ph) * d;
  d = normalize(float2(0.2, 1.0));   k = 11.0; ph = dot(d, q) * k + t * 0.37 + 2.2; h += 0.06 * sin(ph); g += 0.06 * k * cos(ph) * d;

  // Pointer ripple: rings expanding from the touch point, fading with distance and time.
  if (pAmt > 0.001) {
    float2 pp = (ptr - 0.5 * res) / s;
    float2 dv = p - pp;
    float r = length(dv) + 0.0001;
    float env = exp(-r * 4.5) * pAmt;
    float rp = r * 26.0 - t * 4.0;
    g += 0.10 * env * (26.0 * cos(rp) - 4.5 * sin(rp)) * (dv / r);
  }

  float3 n = normalize(float3(-g * 0.42, 1.0));
  float3 L = normalize(float3(-0.55, 0.65, 0.52));
  float3 H = normalize(L + float3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, H), 0.0), 26.0);
  float diff = max(dot(n, L), 0.0);
  float sheen = pow(clamp(length(g) * 0.20, 0.0, 1.0), 1.3);

  // Broad, slow mask: only some folds catch the light; the rest stays pitch black.
  float mask = smoothstep(0.30, 0.85, fbm2(p * 0.9 + float2(t * 0.03, -t * 0.02) + w * 0.8));
  mask = 0.34 + 0.66 * mask;

  // Accent blue drifting to violet across the screen.
  float hue = clamp(0.5 + 0.5 * sin(p.x * 1.7 + p.y * 0.9 + t * 0.05 + w.x * 2.0), 0.0, 1.0);
  float3 hi = mix(float3(0.32, 0.62, 1.00), float3(0.52, 0.36, 1.00), hue);
  float3 body = float3(0.030, 0.060, 0.160);

  float3 col = body * sheen * (0.6 + 1.4 * diff) + hi * (spec * 0.80 + sheen * 0.20);
  col *= mask;
  col *= smoothstep(1.15, 0.20, length(p * float2(0.9, 1.1)));

  // Film grain / dither (about ±1.5 LSB).
  float gn = hash12(floor(fc * grain) + fract(t * 7.0) * float2(113.0, 241.0)) - 0.5;
  col += gn * (1.5 / 255.0);
  return max(col, float3(0.0));
}
`;

/** WebGL 1 / GLSL ES 1.0 fragment shader. */
export const WAVES_GLSL = `precision highp float;
#define float2 vec2
#define float3 vec3
#define float4 vec4
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uPointer;
uniform float uPointerAmt;
uniform float uGrain;
${BODY}
void main() {
  gl_FragColor = vec4(halcyxWaves(gl_FragCoord.xy, uRes, uTime, uPointer, uPointerAmt, uGrain), 1.0);
}
`;

export const WAVES_VERTEX_GLSL = `attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/** Skia runtime effect (SkSL). fragCoord is in points; `uGrain` scales grain to device pixels. */
export const WAVES_SKSL = `uniform float2 uRes;
uniform float uTime;
uniform float2 uPointer;
uniform float uPointerAmt;
uniform float uGrain;
${BODY}
half4 main(float2 fc) {
  // Skia's origin is top-left; flip so the light comes from the same side as on the web.
  float2 f = float2(fc.x, uRes.y - fc.y);
  float2 ptr = float2(uPointer.x, uRes.y - uPointer.y);
  return half4(half3(halcyxWaves(f, uRes, uTime, ptr, uPointerAmt, uGrain)), 1.0);
}
`;

/** A still frame for reduced-motion users: a pleasant, settled composition. */
export const STILL_TIME = 42.0;
/** How fast a touch ripple fades (per second, exponential). */
export const RIPPLE_DECAY = 1.4;
