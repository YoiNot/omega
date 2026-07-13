import { describe, it, expect } from 'vitest';
import { RelationshipNetwork, SYM_MIN, SYM_MAX, STATUS_MIN, STATUS_MAX, type Interaction } from './index.js';

function seq(...xs: Interaction[]): Interaction[] {
  return xs;
}

describe('RelationshipNetwork — determinism (same interactions => same network)', () => {
  it('two networks fed the same ordered interactions are byte-identical', () => {
    const interactions = seq(
      { actor: 'a', target: 'b', type: 'help', magnitude: 0.5 },
      { actor: 'b', target: 'a', type: 'harm', magnitude: 0.3 },
      { actor: 'a', target: 'c', type: 'bond', magnitude: 0.4, weight: 0.5 },
      { actor: 'a', target: 'b', type: 'dominate', magnitude: 0.6 },
    );
    const n1 = new RelationshipNetwork();
    const n2 = new RelationshipNetwork();
    n1.applyInteractions(interactions);
    n2.applyInteractions(interactions);
    expect(n1.serialize()).toEqual(n2.serialize());
  });

  it('stable across many repeated rebuilds', () => {
    const interactions = seq(
      { actor: 'a', target: 'b', type: 'help', magnitude: 0.5 },
      { actor: 'a', target: 'b', type: 'harm', magnitude: 0.2 },
    );
    const ref = (() => {
      const n = new RelationshipNetwork();
      n.applyInteractions(interactions);
      return n.serialize();
    })();
    for (let i = 0; i < 30; i++) {
      const n = new RelationshipNetwork();
      n.applyInteractions(interactions);
      expect(n.serialize()).toEqual(ref);
    }
  });

  it('ORDER matters: help-then-harm differs from harm-then-help only via clamping boundary', () => {
    // With clamping, large opposite interactions can cancel to the same clamped value; but a
    // partial net effect is order-sensitive, so assert the reducers compose as a fold.
    const n = new RelationshipNetwork();
    n.applyInteraction({ actor: 'a', target: 'b', type: 'help', magnitude: 0.4 });
    n.applyInteraction({ actor: 'a', target: 'b', type: 'harm', magnitude: 0.1 });
    expect(n.getSympathy('a', 'b')).toBeCloseTo(0.3, 12);
  });
});

describe('sympathy update math', () => {
  it('help/bond increase, harm decreases, all clamped to [-1,1]', () => {
    const n = new RelationshipNetwork();
    n.applyInteraction({ actor: 'a', target: 'b', type: 'help', magnitude: 2 }); // saturates at 1
    expect(n.getSympathy('a', 'b')).toBe(SYM_MAX);
    const m = new RelationshipNetwork();
    m.applyInteraction({ actor: 'a', target: 'b', type: 'harm', magnitude: 5 });
    expect(m.getSympathy('a', 'b')).toBe(SYM_MIN);
  });

  it('symmetry is NOT assumed (a->b can differ from b->a)', () => {
    const n = new RelationshipNetwork();
    n.applyInteraction({ actor: 'a', target: 'b', type: 'help', magnitude: 0.7 });
    n.applyInteraction({ actor: 'b', target: 'a', type: 'harm', magnitude: 0.5 });
    expect(n.getSympathy('a', 'b')).toBeCloseTo(0.7, 12);
    expect(n.getSympathy('b', 'a')).toBeCloseTo(-0.5, 12);
  });

  it('weight scales the effect (0.5 -> half)', () => {
    const full = new RelationshipNetwork();
    full.applyInteraction({ actor: 'a', target: 'b', type: 'help', magnitude: 0.8, weight: 1 });
    const half = new RelationshipNetwork();
    half.applyInteraction({ actor: 'a', target: 'b', type: 'help', magnitude: 0.8, weight: 0.5 });
    expect(half.getSympathy('a', 'b')).toBeCloseTo(full.getSympathy('a', 'b') * 0.5, 12);
  });
});

describe('status update math', () => {
  it('dominate raises, submit lowers, clamped to [0,1]', () => {
    const n = new RelationshipNetwork();
    n.applyInteraction({ actor: 'a', target: 'b', type: 'dominate', magnitude: 3 });
    expect(n.getStatus('a', 'b')).toBe(STATUS_MAX);
    const m = new RelationshipNetwork();
    m.applyInteraction({ actor: 'c', target: 'd', type: 'submit', magnitude: 3 });
    expect(m.getStatus('c', 'd')).toBe(STATUS_MIN);
  });

  it('status is directional and independent of sympathy', () => {
    const n = new RelationshipNetwork();
    n.applyInteraction({ actor: 'a', target: 'b', type: 'help', magnitude: 0.5 });
    n.applyInteraction({ actor: 'a', target: 'b', type: 'dominate', magnitude: 0.2 });
    expect(n.getSympathy('a', 'b')).toBeCloseTo(0.5, 12);
    expect(n.getStatus('a', 'b')).toBeCloseTo(0.2, 12);
  });
});

describe('best ally / worst rival (deterministic tie-break)', () => {
  it('returns the highest-sympathy target; ties broken by id', () => {
    const n = new RelationshipNetwork();
    n.applyInteraction({ actor: 'a', target: 'x', type: 'help', magnitude: 0.5 });
    n.applyInteraction({ actor: 'a', target: 'y', type: 'help', magnitude: 0.5 });
    n.applyInteraction({ actor: 'a', target: 'z', type: 'help', magnitude: 0.9 });
    expect(n.bestAlly('a')).toBe('z');
  });

  it('ties broken by lexicographic id, not insertion order', () => {
    const n = new RelationshipNetwork();
    n.applyInteraction({ actor: 'a', target: 'm', type: 'help', magnitude: 0.5 });
    n.applyInteraction({ actor: 'a', target: 'b', type: 'help', magnitude: 0.5 });
    expect(n.bestAlly('a')).toBe('b'); // 'b' < 'm'
  });

  it('worst rival returns the lowest-sympathy target', () => {
    const n = new RelationshipNetwork();
    n.applyInteraction({ actor: 'a', target: 'friend', type: 'help', magnitude: 0.8 });
    n.applyInteraction({ actor: 'a', target: 'enemy', type: 'harm', magnitude: 0.8 });
    expect(n.worstRival('a')).toBe('enemy');
  });

  it('null when no relations', () => {
    const n = new RelationshipNetwork();
    expect(n.bestAlly('a')).toBeNull();
    expect(n.worstRival('a')).toBeNull();
  });
});

describe('serialize / restore is byte-identical', () => {
  it('fromSnapshot rebuilds the full network', () => {
    const n = new RelationshipNetwork();
    n.applyInteractions(seq(
      { actor: 'a', target: 'b', type: 'help', magnitude: 0.5 },
      { actor: 'a', target: 'b', type: 'dominate', magnitude: 0.3 },
      { actor: 'b', target: 'a', type: 'harm', magnitude: 0.2 },
    ));
    const snap = n.serialize();
    const r = RelationshipNetwork.fromSnapshot(snap);
    expect(r.serialize()).toEqual(snap);
    expect(r.actorIds.slice().sort()).toEqual(['a', 'b']);
  });
});
