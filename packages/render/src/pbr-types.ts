/**
 * @omega/render — PBR material, light and environment definitions.
 *
 * These are PURE data types (no GL, no clock). They are consumed by both the
 * backend renderers (`@omega/render` gl/webgpu) and the deterministic PBR math
 * in `@omega/render-pbr`. Keeping them here (rather than in render-pbr) avoids
 * a render -> render-pbr -> render import cycle, so the `Renderer` interface can
 * take them directly while render-pbr stays a leaf that only *reads* them.
 *
 * Everything is linear-space RGB in [0,1] — gamma/encoding is a presentation
 * concern handled by the backends. No ambient state: identical structs always
 * describe identical lighting.
 */

/** Physically-based surface material. Linear RGB, [0,1]. */
export interface PbrMaterial {
  /** Base color (diffuse albedo). Linear RGB in [0,1]. */
  albedo: [number, number, number];
  /** Metalness in [0,1]; 0 = dielectric, 1 = pure metal. */
  metallic: number;
  /** Perceptual roughness in [0,1]; 0 = mirror, 1 = fully diffuse. */
  roughness: number;
  /** Emissive contribution (self-illumination). Linear RGB in [0,1]. */
  emissive: [number, number, number];
  /** Ambient occlusion in [0,1]; 1 = fully lit, 0 = fully occluded. */
  ambientOcclusion: number;
}

/** A deterministic default: rough dielectric grey. */
export function defaultPbrMaterial(): PbrMaterial {
  return {
    albedo: [0.8, 0.8, 0.82],
    metallic: 0,
    roughness: 0.85,
    emissive: [0, 0, 0],
    ambientOcclusion: 1,
  };
}

/**
 * Parallel directional (sun) light. `direction` is the direction the light
 * TRAVELS (i.e. from the sun toward the surface); the backend normalizes it.
 * `color` is the radiance (already includes intensity scale, kept separate only
 * for authoring convenience via {@link DirectionalLight.intensity}).
 */
export interface DirectionalLight {
  direction: [number, number, number];
  /** Light radiance (linear RGB in [0,1]). */
  color: [number, number, number];
  /** Multiplier applied to `color` when integrating. */
  intensity: number;
  /** Cascaded shadow config, or null when the light casts no shadows. */
  shadows: CsmConfig | null;
}

/** Cascaded Shadow Map configuration (stable logarithmic/uniform split). */
export interface CsmConfig {
  /** Number of cascades (>= 1). */
  cascades: number;
  /**
   * Split blend in [0,1]. 0 = pure logarithmic split (good for huge far
   * planes), 1 = pure uniform split. The "practical split scheme" lambda.
   */
  lambda: number;
  /** Shadow-map texel world size — drives ortho half-extent per cascade. */
  texelSize: number;
  /** Constant depth bias to avoid shadow acne (world units). */
  bias: number;
}

/** Hemisphere ambient / image-based-lighting approximation. */
export interface EnvironmentLight {
  /** Sky (up) ambient color, linear RGB [0,1]. */
  ambientTop: [number, number, number];
  /** Ground (down) ambient color, linear RGB [0,1]. */
  ambientBottom: [number, number, number];
  /** Ambient multiplier. */
  ambientIntensity: number;
}

/** Deterministic default environment: cool sky, warm ground, moderate ambient. */
export function defaultEnvironment(): EnvironmentLight {
  return {
    ambientTop: [0.26, 0.31, 0.4],
    ambientBottom: [0.12, 0.13, 0.16],
    ambientIntensity: 1,
  };
}

/** Deterministic default sun: travels down-and-to-the-right, warm white. */
export function defaultSun(): DirectionalLight {
  return {
    direction: [0.4, -1.0, 0.3],
    color: [1.0, 0.96, 0.88],
    intensity: 3.0,
    shadows: {
      cascades: 4,
      lambda: 0.6,
      texelSize: 1.0,
      bias: 0.0025,
    },
  };
}
