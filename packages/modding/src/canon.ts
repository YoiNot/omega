/**
 * @omega/modding — canonical JSON serialization helpers.
 *
 * Determinism requires that two logically-equal manifests serialize to the same
 * byte sequence regardless of object-key insertion order or array shape. We
 * recursively sort object keys before stringifying so `canonicalStringify` is a
 * stable, order-independent projection of any JSON-legal value.
 */

/** True for a JSON-serializable plain object (i.e. a non-array, non-null object). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

/** Transform any JSON-legal value into a key-sorted, array-preserving form. */
function stableTransform(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => stableTransform(v));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const k of keys) {
      out[k] = stableTransform((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/**
 * Return a key-sorted, array-preserving copy of a JSON-legal value. Object keys
 * are sorted so the structure is independent of the order in which the object was
 * constructed; arrays keep their element order (entities/components are
 * positionally meaningful). Used both for byte-stable serialization and for the
 * canonical string form.
 */
export function canonicalize(value: unknown): unknown {
  return stableTransform(value);
}

/**
 * Deterministically stringify a JSON-legal value. Object keys are sorted so the
 * output is independent of the order in which the object was constructed. Arrays
 * preserve their element order (entities/components are positionally meaningful).
 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(stableTransform(value));
}
