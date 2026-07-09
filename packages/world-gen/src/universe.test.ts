import { describe, it, expect } from 'vitest';
import { UniverseGenerator, Catalog } from './universe.js';

describe('universe', () => {
  it('is deterministic: same seed => deep-equal', () => {
    const a = new UniverseGenerator(424242).generate();
    const b = new UniverseGenerator(424242).generate();
    expect(JSON.parse(JSON.stringify(a))).toEqual(JSON.parse(JSON.stringify(b)));
  });

  it('galaxy count is within [1, 4]', () => {
    for (let seed = 0; seed < 12; seed++) {
      const u = new UniverseGenerator(seed, { systemsPerGalaxy: 4 }).generate();
      expect(u.galaxies.length).toBeGreaterThanOrEqual(1);
      expect(u.galaxies.length).toBeLessThanOrEqual(4);
    }
  });

  it('every galaxy has placed star systems', () => {
    const u = new UniverseGenerator(31, { systemsPerGalaxy: 24 }).generate();
    for (const g of u.galaxies) {
      expect(g.starSystems.length).toBeGreaterThan(0);
      for (const s of g.starSystems) expect(s.planets.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('catalogSize accounts for all objects', () => {
    const u = new UniverseGenerator(77, { systemsPerGalaxy: 10 }).generate();
    let expected = u.galaxies.length;
    for (const g of u.galaxies) {
      expected += g.starSystems.length;
      for (const s of g.starSystems) expected += s.planets.length;
    }
    expect(u.catalogSize).toBe(expected);
  });

  it('Catalog builds stable, splittable ids', () => {
    expect(Catalog.galaxyId(0)).toBe('GLX-0001');
    expect(Catalog.systemId(41)).toBe('SYS-0042');
    expect(Catalog.planetId(6)).toBe('PLN-0007');
    const path = Catalog.join('GLX-0001', 'SYS-0042', 'PLN-0007');
    expect(path).toBe('GLX-0001/SYS-0042/PLN-0007');
    expect(Catalog.split(path)).toEqual(['GLX-0001', 'SYS-0042', 'PLN-0007']);
  });

  it('different seeds => different universe', () => {
    const a = new UniverseGenerator(1).generate();
    const b = new UniverseGenerator(2).generate();
    expect(JSON.parse(JSON.stringify(a))).not.toEqual(JSON.parse(JSON.stringify(b)));
  });

  it('reproducible catalog ids across regenerations', () => {
    const u1 = new UniverseGenerator(555, { systemsPerGalaxy: 4 }).generate();
    const idPath = (g: number, s: number, p: number) =>
      Catalog.join(u1.galaxies[g]!.id, u1.galaxies[g]!.starSystems[s]!.id, u1.galaxies[g]!.starSystems[s]!.planets[p]!.id);
    const path1 = idPath(0, 0, 0);
    const path2 = idPath(0, 0, 0);
    expect(path1).toBe(path2);
    expect(path1.startsWith('GLX-0001/SYS-0001/PLN-0001')).toBe(true);
  });
});
