import { describe, it, expect } from 'vitest';
import { Marketplace, loadLocalCatalog, type ModCatalog } from './marketplace.js';

/** Build a catalog with entries in a deliberately scrambled order. */
function scrambledCatalog(): ModCatalog {
  return {
    name: 'test-catalog',
    manifests: [
      { id: 'zeta', version: '2.0.0', rules: [], content: [] },
      { id: 'alpha', version: '1.0.0', rules: [], content: [{ components: { Tag: { label: 'x' } } }] },
      { id: 'alpha', version: '0.9.0', rules: [], content: [] },
      { id: 'mid', version: '3.1.4', rules: [{ id: 'r', component: 'PhysicsBody', strategy: 'merge', value: { mass: 1 } }], content: [] },
      // An intentionally malformed entry — still browsable, flagged invalid.
      { id: 'broken', version: '1.0.0', rules: [{ id: 'r', component: 'C', strategy: 'nope', value: {} }], content: [] } as unknown as ModCatalog['manifests'][number],
    ],
  };
}

describe('Marketplace — deterministic listing', () => {
  it('sorts entries by (id, version) regardless of catalog array order', () => {
    const mp = new Marketplace(scrambledCatalog());
    const listing = mp.list();
    const ids = listing.entries.map((e) => `${e.manifest.id}@${e.manifest.version}`);
    expect(ids).toEqual([
      'alpha@0.9.0',
      'alpha@1.0.0',
      'broken@1.0.0',
      'mid@3.1.4',
      'zeta@2.0.0',
    ]);
  });

  it('rebuild from a reordered catalog yields an identical listing', () => {
    const a = new Marketplace(scrambledCatalog()).list();
    const shuffled: ModCatalog = {
      name: 'test-catalog',
      manifests: [...scrambledCatalog().manifests].reverse(),
    };
    const b = new Marketplace(shuffled).list();
    expect(b.entries.map((e) => `${e.manifest.id}@${e.manifest.version}`))
      .toEqual(a.entries.map((e) => `${e.manifest.id}@${e.manifest.version}`));
  });

  it('flags malformed manifests without throwing', () => {
    const listing = new Marketplace(scrambledCatalog()).list();
    const broken = listing.entries.find((e) => e.manifest.id === 'broken')!;
    expect(broken.valid).toBe(false);
    expect(broken.errorCount).toBeGreaterThan(0);
    // Valid ones report zero errors.
    const alpha = listing.entries.find((e) => e.manifest.id === 'alpha' && e.manifest.version === '1.0.0')!;
    expect(alpha.valid).toBe(true);
    expect(alpha.errorCount).toBe(0);
  });

  it('get() resolves by (id, version)', () => {
    const mp = new Marketplace(scrambledCatalog());
    expect(mp.get('alpha', '0.9.0')?.version).toBe('0.9.0');
    expect(mp.get('nope', '9.9.9')).toBeUndefined();
  });
});

describe('loadLocalCatalog — catalog envelope validation', () => {
  it('builds a Marketplace from a JSON blob', () => {
    const mp = loadLocalCatalog(JSON.parse(JSON.stringify(scrambledCatalog())));
    expect(mp.name).toBe('test-catalog');
    expect(mp.list().entries.length).toBe(5);
  });

  it('throws deterministically when the envelope is malformed', () => {
    expect(() => loadLocalCatalog(null)).toThrow(/JSON object/);
    expect(() => loadLocalCatalog({ manifests: [] })).toThrow(/"name"/);
    expect(() => loadLocalCatalog({ name: 'x' })).toThrow(/"manifests"/);
  });
});
