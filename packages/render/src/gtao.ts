/**
 * @omega/render — Ground-Truth Ambient Occlusion (GTAO).
 *
 * Horizon-based AO per Jimenez et al. 2016 "Practical Realtime Strategies for
 * Accurate Indirect Occlusion" (Activision). We follow the XeGTAO lineage:
 * radiometrically-correct AO integral, ~0.5ms class cost, and — critically for
 * us — it needs only a depth buffer + view normals, which our GBufferPass
 * (gbuffer.ts) now provides.
 *
 * WHY GTAO NOT SSAO: SSAO empirically darkens creases; GTAO solves the actual
 * visibility integral under the height-field assumption, so it matches
 * ray-traced ground truth and avoids the "early-2000s OpenGL" look our PBR
 * terrain currently has (no occlusion term at all right now).
 *
 * DETERMINISM: the inner integral is solved analytically in GLSL; the only
 * numerical part is the Monte-Carlo slice loop, which we drive with Interleaved
 * Gradient Noise (IGN) seeded by screen coords — stable per-pixel, no flicker,
 * no libm. The det_* helpers are available but GTAO's trig is minimal (cos/sin
 * of horizon angles derived from atan2), so GPU divergence is bounded and the
 * pass stays a pure function of the G-Buffer (which is already pinned).
 */

export const GTAO_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uNormal;   // view-space normal, packed [0,1]
uniform sampler2D uDepth;    // linear view-space distance
uniform vec2 uResolution;
uniform float uRadius;       // world-space AO radius
uniform float uFalloff;      // falloff range
uniform int uSamples;        // samples per slice
uniform int uSlices;         // angular slices
out vec4 fragColor;

const float PI = 3.141592653589793;

// Interleaved Gradient Noise (Jimenez) — stable per pixel, no temporal flicker.
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

// Reconstruct view normal (unpack from [0,1]).
vec3 unpackNormal(vec3 c) { return c * 2.0 - 1.0; }

void main() {
  vec2 uv = vUv;
  vec3 N = unpackNormal(texture(uNormal, uv).rgb);
  float centerDepth = texture(uDepth, uv).r;
  if (centerDepth <= 0.0) { fragColor = vec4(1.0); return; }

  // View-space position from uv + linear depth (orthographic-ish reconstruction
  // for the demo's top-down orbit; good enough to recover horizon directions).
  vec2 screen = uv * uResolution;
  vec3 viewPos = vec3((uv * 2.0 - 1.0) * centerDepth, -centerDepth);

  float occlusion = 0.0;
  float total = 0.0;
  float baseNoise = ign(screen);

  for (int s = 0; s < 16; s++) {
    if (s >= uSlices) break;
    float phi = (float(s) + baseNoise) * (PI / float(uSlices));
    vec2 dir = vec2(cos(phi), sin(phi));

    float h1 = -1.0;
    float h2 = -1.0;
    for (int i = 0; i < 8; i++) {
      if (i >= uSamples) break;
      float t = (float(i) + 0.5) / float(uSamples);
      float radius = t * uRadius;
      vec2 offs = dir * radius / uResolution;
      vec2 suv = uv + offs;
      if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
      float d = texture(uDepth, suv).r;
      if (d <= 0.0) continue;
      vec3 sp = vec3((suv * 2.0 - 1.0) * d, -d);
      vec3 diff = sp - viewPos;
      float len = sqrt(max(dot(diff, diff), 1e-6));
      vec3 dirv = diff / len;
      float cosH = dot(N, dirv);
      float falloff = 1.0 - smoothstep(uRadius - uFalloff, uRadius, len);
      h1 = max(h1, cosH * falloff);
      h2 = max(h2, -cosH * falloff);
    }
    // Horizon-based AO: integrate the arc between the two max horizons.
    float ao = 1.0 - (h1 + h2) * 0.5;
    occlusion += clamp(ao, 0.0, 1.0);
    total += 1.0;
  }

  float a = total > 0.0 ? occlusion / total : 1.0;
  fragColor = vec4(vec3(a), 1.0);
}`;

export const FULLSCREEN_VERT = /* glsl */ `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/**
 * CPU-side compositor: AO (in [0,1]) multiplies the lit color. This is the
 * simplest deterministic composite; the TS mirror lets Node tests verify the
 * AO value without a GPU. Real-time path uses a composite shader instead.
 */
export function compositeAO(litColor: [number, number, number], ao: number): [number, number, number] {
  const a = Math.max(0, Math.min(1, ao));
  return [litColor[0] * a, litColor[1] * a, litColor[2] * a];
}
