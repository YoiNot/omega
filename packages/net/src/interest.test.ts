import { describe, it, expect } from 'vitest';
import {
  computeRelevant,
  isRelevant,
  InterestManager,
  type EntityView,
} from './interest.js';

const entities: EntityView[] = [
  { id: 0, x: 0, y: 0, radius: 1 },
  { id: 1, x: 3, y: 0, radius: 1 },
  { id: 2, x: 100, y: 100, radius: 1 },
  { id: 3, x: -5, y: 2, radius: 2 },
];

describe('computeRelevant', () => {
  it('returns only entities within observerRadius + entityRadius', () => {
    // Observer at origin, view radius 5.
    const rel = computeRelevant(0, 0, 5, entities);
    // e0 dist 0 (<=5+1), e1 dist 3 (<=6), e3 dist sqrt(25+4)=~5.39 (<=7) -> in.
    // e2 far away -> out.
    expect([...rel].sort((a, b) => a - b)).toEqual([0, 1, 3]);
  });

  it('is deterministic: same inputs -> identical (sorted) set', () => {
    const a = computeRelevant(0, 0, 5, entities);
    const b = computeRelevant(0, 0, 5, entities);
    expect([...a]).toEqual([...b]);
  });

  it('smaller radius drops farther entities', () => {
    const near = computeRelevant(0, 0, 2, entities);
    // e0 (dist0, reach3) in; e1 (dist3, reach3) boundary in; e3 (dist~5.39, reach4) out.
    expect([...near].sort((a, b) => a - b)).toEqual([0, 1]);
  });

  it('isRelevant honours the summed radius', () => {
    expect(isRelevant(0, 0, 1, { id: 9, x: 2, y: 0, radius: 1 })).toBe(true); // 2 <= 1+1
    expect(isRelevant(0, 0, 1, { id: 9, x: 2.1, y: 0, radius: 1 })).toBe(false); // 2.1 > 2
  });
});

describe('InterestManager', () => {
  it('produces an identical relevance map across runs', () => {
    const mgr = new InterestManager();
    mgr.setObserver(10, { x: 0, y: 0, radius: 5 });
    mgr.setObserver(20, { x: 100, y: 100, radius: 5 });

    const a = mgr.compute(entities);
    const b = mgr.compute(entities);
    expect(a).toEqual(b);
  });

  it('each client sees only its own neighbourhood', () => {
    const mgr = new InterestManager();
    mgr.setObserver(10, { x: 0, y: 0, radius: 5 });
    mgr.setObserver(20, { x: 100, y: 100, radius: 5 });
    const map = mgr.compute(entities);
    expect([...map.get(10)!].sort((a, b) => a - b)).toEqual([0, 1, 3]);
    expect([...map.get(20)!].sort((a, b) => a - b)).toEqual([2]);
  });

  it('removing an observer drops its entry', () => {
    const mgr = new InterestManager();
    mgr.setObserver(10, { x: 0, y: 0, radius: 5 });
    mgr.setObserver(20, { x: 100, y: 100, radius: 5 });
    mgr.removeObserver(20);
    const map = mgr.compute(entities);
    expect(map.has(20)).toBe(false);
    expect(map.size).toBe(1);
  });

  it('empty entity list yields empty relevance sets', () => {
    const mgr = new InterestManager();
    mgr.setObserver(1, { x: 0, y: 0, radius: 5 });
    const map = mgr.compute([]);
    expect([...map.get(1)!]).toEqual([]);
  });
});
