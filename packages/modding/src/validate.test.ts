import { describe, it, expect } from 'vitest';
import { validateModManifest, assertValidModManifest } from './validate.js';

/** A fully-valid manifest used as the happy-path baseline. */
function validManifest(): unknown {
  return {
    id: 'demo',
    version: '1.0.0',
    rules: [
      { id: 'boost', component: 'PhysicsBody', strategy: 'merge', value: { restitution: 0.9 }, priority: 5 },
      { id: 'tag', component: 'Tag', strategy: 'merge', value: { label: 'x' } },
    ],
    content: [{ components: { PhysicsBody: { mass: 7 }, Tag: { label: 'new' } } }],
  };
}

describe('validateModManifest — happy path', () => {
  it('accepts a well-formed manifest', () => {
    const r = validateModManifest(validManifest());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.manifest?.id).toBe('demo');
  });

  it('normalizes missing rules/content to empty arrays', () => {
    const r = validateModManifest({ id: 'x', version: '1' });
    expect(r.valid).toBe(true);
    expect(r.manifest?.rules).toEqual([]);
    expect(r.manifest?.content).toEqual([]);
  });

  it('assertValidModManifest returns the manifest when valid', () => {
    expect(() => assertValidModManifest(validManifest())).not.toThrow();
  });
});

describe('validateModManifest — determinism (same invalid input => identical errors)', () => {
  const bad = {
    id: '',
    version: 42 as unknown,
    rules: [
      { id: 'a', component: '', strategy: 'frob' as unknown, value: [1, 2] as unknown, priority: 'high' as unknown },
      { id: 'a', component: 'Tag', strategy: 'merge', value: { ok: 1 }, priority: 99 },
    ],
    content: [{ components: { PhysicsBody: 5 as unknown } }],
  };

  function errorSignature(input: unknown): string {
    const r = validateModManifest(input);
    // Re-serialize the error list in a stable way.
    return JSON.stringify(r.errors.map((e) => [e.code, e.path, e.message]));
  }

  it('two structurally identical (but differently-ordered) inputs give identical errors', () => {
    const reordered = {
      content: [{ components: { PhysicsBody: 5 } }],
      version: 42,
      id: '',
      rules: [
        { strategy: 'frob', value: [1, 2], id: 'a', component: '', priority: 'high' },
        { strategy: 'merge', value: { ok: 1 }, priority: 99, id: 'a', component: 'Tag' },
      ],
    };
    expect(errorSignature(bad)).toBe(errorSignature(reordered));
  });

  it('error list is stable across repeated calls', () => {
    expect(errorSignature(bad)).toBe(errorSignature(bad));
  });

  it('catches every field on the malformed manifest', () => {
    const r = validateModManifest(bad);
    expect(r.valid).toBe(false);
    const codes = r.errors.map((e) => e.code);
    expect(codes).toContain('id-empty');
    expect(codes).toContain('version-not-string');
    expect(codes).toContain('rule-component-empty');
    expect(codes).toContain('rule-strategy-invalid');
    expect(codes).toContain('rule-value-not-object');
    expect(codes).toContain('rule-priority-not-number');
    expect(codes).toContain('duplicate-rule-id');
    expect(codes).toContain('conflicting-rule-priority');
    expect(codes).toContain('content-component-value-not-object');
  });

  it('assertValidModManifest throws a deterministic message', () => {
    let msg = '';
    try {
      assertValidModManifest(bad);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg.startsWith('Invalid ModManifest:')).toBe(true);
    // Calling again yields the same message text.
    let msg2 = '';
    try {
      assertValidModManifest(bad);
    } catch (e) {
      msg2 = (e as Error).message;
    }
    expect(msg2).toBe(msg);
  });
});

describe('validateModManifest — specific shape rules', () => {
  it('rejects a non-object root', () => {
    const r = validateModManifest(42);
    expect(r.valid).toBe(false);
    expect(r.errors[0].code).toBe('manifest-not-object');
  });

  it('flags rules/content being non-arrays', () => {
    const r = validateModManifest({ id: 'x', version: '1', rules: {}, content: 'nope' });
    expect(r.errors.map((e) => e.code)).toEqual(['rules-not-array', 'content-not-array']);
  });

  it('detects a duplicate rule id without a priority conflict', () => {
    const r = validateModManifest({
      id: 'x',
      version: '1',
      rules: [
        { id: 'dup', component: 'A', strategy: 'merge', value: { a: 1 } },
        { id: 'dup', component: 'A', strategy: 'merge', value: { a: 2 } },
      ],
    });
    expect(r.errors.map((e) => e.code)).toEqual(['duplicate-rule-id']);
  });

  it('reports conflicting priorities for the same id', () => {
    const r = validateModManifest({
      id: 'x',
      version: '1',
      rules: [
        { id: 'dup', component: 'A', strategy: 'merge', value: { a: 1 }, priority: 1 },
        { id: 'dup', component: 'A', strategy: 'merge', value: { a: 2 }, priority: 2 },
      ],
    });
    expect(r.errors.map((e) => e.code).sort()).toEqual(['conflicting-rule-priority', 'duplicate-rule-id']);
  });

  it('accepts @everywhere-style absence of priority (defaults to 0, no conflict)', () => {
    const r = validateModManifest({
      id: 'x',
      version: '1',
      rules: [
        { id: 'dup', component: 'A', strategy: 'merge', value: { a: 1 } },
        { id: 'dup', component: 'A', strategy: 'merge', value: { a: 2 } },
      ],
    });
    // Duplicate id is still reported, but no conflicting-priority error.
    expect(r.errors.map((e) => e.code)).toEqual(['duplicate-rule-id']);
  });
});
