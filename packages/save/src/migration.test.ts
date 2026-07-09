import { describe, it, expect } from 'vitest';
import { SaveMigrator } from './migration.js';

describe('SaveMigrator', () => {
  it('applies migrations in sequence v1 -> v3', () => {
    const m = new SaveMigrator();
    // v1 -> v2: rename `hp` to `health`
    m.register(1, (d) => {
      const { hp, ...rest } = d;
      return { ...rest, health: hp };
    });
    // v2 -> v3: add default `mana` field
    m.register(2, (d) => ({ ...d, mana: 100 }));

    const v1 = { name: 'hero', hp: 50 };
    const v3 = m.migrate(v1, 1, 3);
    expect(v3).toEqual({ name: 'hero', health: 50, mana: 100 });
  });

  it('no-op when fromVersion === toVersion', () => {
    const m = new SaveMigrator();
    const d = { a: 1 };
    expect(m.migrate(d, 2, 2)).toBe(d);
  });

  it('throws on missing migrator', () => {
    const m = new SaveMigrator();
    expect(() => m.migrate({}, 1, 2)).toThrow(/No migrator/);
  });

  it('throws on downward migration', () => {
    const m = new SaveMigrator();
    expect(() => m.migrate({}, 3, 1)).toThrow(/downwards/);
  });
});
