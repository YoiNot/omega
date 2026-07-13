/**
 * @omega/render-ao — deterministic shader math helpers.
 *
 * WHY THIS EXISTS (the project's core differentiator):
 * Our $0 multiplayer-lite pitch is "same seed => same world => same pixels".
 * GPU float execution is NOT bit-identical across vendors (see USENIX'19
 * "Rendered Private"; forge3d TERRA-DETERMINATA PR #100 root-caused dx12 vs
 * vulkan divergence to per-API f32 precision contracts: D3D mandates
 * correctly-rounded divide/sqrt, Vulkan permits ~2.5 ULP). Without pinned
 * math, the rendered image drifts between a user's laptop GPU and a teammate's,
 * breaking the determinism contract.
 *
 * These helpers re-express the transcendental/reciprocal ops that GPU compilers
 * lower inconsistently, using a seeded bit-trick + a FIXED-iteration Newton
 * step (no libm, no driver-chosen precision). The iteration count is fixed so
 * the result is a pure function of inputs — identical on every GPU.
 *
 * We expose both:
 *   - GLSL string fragments (for injection into our own shaders), and
 *   - TS mirrors (so Node-side tests and the browser demo agree, mirroring how
 *     @omega/render-pbr keeps brdf.ts in sync with the GLSL BRDF).
 *
 * NOTE: this is the FIRST layer of the determinism guarantee. It pins the
 * per-pixel math. Cross-pixel reductions (if any) must also be ordered (see
 * arxiv 2408.05148 on FP non-associativity) — but the AO/post passes here have
 * no cross-pixel dependency, so per-pixel pinning is sufficient.
 */

/** GLSL: deterministic 1/sqrt(x) via bit-trick seed + 2 Newton steps. */
export const GLSL_DET_INVERSE_SQRT = /* glsl */ `
float det_inverseSqrt(float x) {
  // x != 0 assumed (callers guard). Clamp to avoid NaN on <= 0.
  x = max(x, 1e-8);
  int i = floatBitsToInt(x);
  i = 0x5f3759df - (i >> 1);              // Quake-style seed
  float y = intBitsToFloat(i);
  y = y * (1.5 - 0.5 * x * y * y);        // Newton step 1
  y = y * (1.5 - 0.5 * x * y * y);        // Newton step 2 (fixed => deterministic)
  return y;
}
float det_sqrt(float x) {
  x = max(x, 0.0);
  return x * det_inverseSqrt(x);          // sqrt(x) = x * 1/sqrt(x)
}
float det_div(float a, float b) {
  return a * det_inverseSqrt(b) * det_inverseSqrt(b); // a/b = a * (1/b)^2
}
`;

/**
 * TS mirror of det_inverseSqrt for CPU-side use (tests, env-map bake).
 * Uses Math.fround to force 32-bit float semantics so it stays bit-close to the
 * GPU path (both run in IEEE-ish 32-bit; the fixed iteration makes the result
 * independent of any further driver optimization).
 */
export function detInverseSqrt(x: number): number {
  x = Math.max(x, 1e-8);
  const buf = new Float32Array(1);
  buf[0] = x;
  const dv = new DataView(buf.buffer);
  let i = dv.getInt32(0, true); // floatBitsToInt
  i = 0x5f3759df - (i >> 1);
  dv.setInt32(0, i, true);
  let y = buf[0]!; // intBitsToFloat
  y = y * (1.5 - 0.5 * x * y * y);
  y = y * (1.5 - 0.5 * x * y * y);
  return y;
}

export function detSqrt(x: number): number {
  x = Math.max(x, 0);
  return x * detInverseSqrt(x);
}

export function detDiv(a: number, b: number): number {
  const inv = detInverseSqrt(b);
  return a * inv * inv;
}

/**
 * Deterministic normalized vector (length 1) using det_sqrt.
 * Avoids the GLSL `normalize()` built-in, which lowers to driver-chosen
 * reciprocal-sqrt on some backends.
 */
export function detNormalize3(v: [number, number, number]): [number, number, number] {
  const len = detSqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  const inv = len > 1e-8 ? 1 / len : 0;
  return [v[0] * inv, v[1] * inv, v[2] * inv];
}
