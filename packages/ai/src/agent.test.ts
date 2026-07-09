import { describe, it, expect } from 'vitest';
import { World, EventBus, Rng } from '@omega/engine-core';
import { GoapAction, GoapPlanner, WorldState } from './goap.js';
import { UtilityOption } from './utility.js';
import { Brain, AgentEvents, think, readWorldState } from './agent.js';

// Deterministic seed via engine-core Rng (no Math.random / Date.now in this package).
const rng = new Rng(0xc0ffee);

interface Inventory { hasAxe: number; atTree: number; hasWood: number; }

const goapActions: GoapAction[] = [
  { name: 'walkToTree', cost: 1, preconditions: {}, effects: { atTree: 1 } },
  { name: 'pickUpAxe', cost: 1, preconditions: { atTree: 1 }, effects: { hasAxe: 1 } },
  { name: 'chopTree', cost: 2, preconditions: { hasAxe: 1, atTree: 1 }, effects: { hasWood: 1 } },
];

describe('agent Brain + think', () => {
  it('emits agent:decision with the expected first GOAP action', () => {
    const world = new World();
    const bus = new EventBus<AgentEvents>();
    const events: AgentEvents['agent:decision'][] = [];
    bus.on('agent:decision', (e) => events.push(e));

    const id = world.spawn<Inventory>('Inventory', () => ({
      hasAxe: rng.nextInt(0, 0), // deterministic 0
      atTree: 0,
      hasWood: 0,
    }));
    const brain: Brain = {
      mode: 'goap',
      sensors: ['Inventory'],
      actions: goapActions,
      options: [],
      goal: { hasWood: 1 } as WorldState,
    };
    world.addComponent('Brain', id, brain);

    const action = think(world, id, bus);

    expect(action).toBe('walkToTree');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ entityId: id, action: 'walkToTree', mode: 'goap' });
    expect(brain.lastDecision).toBe('walkToTree');
  });

  it('emits the chosen utility option name', () => {
    const world = new World();
    const bus = new EventBus<AgentEvents>();
    const events: AgentEvents['agent:decision'][] = [];
    bus.on('agent:decision', (e) => events.push(e));

    const id = world.spawn<Inventory>('Inventory', () => ({ hasAxe: 0, atTree: 0, hasWood: 0 }));
    const options: UtilityOption[] = [
      {
        name: 'rest',
        considerations: [{ input: (c: unknown) => 1 - (c as any)['Inventory.hasWood'], curve: (x) => x }],
      },
      {
        name: 'gather',
        considerations: [{ input: (c: unknown) => (c as any)['Inventory.hasWood'], curve: (x) => x }],
      },
    ];
    const brain: Brain = {
      mode: 'utility',
      sensors: ['Inventory'],
      actions: [],
      options,
      goal: {},
    };
    world.addComponent('Brain', id, brain);

    const action = think(world, id, bus);
    expect(action).toBe('rest'); // hasWood is 0 -> rest scores higher
    expect(events[0].action).toBe('rest');
    expect(events[0].mode).toBe('utility');
  });

  it('readWorldState flattens sensor component fields into named features', () => {
    const world = new World();
    const id = world.spawn<Inventory>('Inventory', () => ({ hasAxe: 1, atTree: 0, hasWood: 0 }));
    const state = readWorldState(world, id, ['Inventory']);
    expect(state['Inventory.hasAxe']).toBe(1);
    expect(state['Inventory.hasWood']).toBe(0);
  });

  it('throws when entity has no Brain', () => {
    const world = new World();
    const bus = new EventBus<AgentEvents>();
    const id = world.createEntity();
    expect(() => think(world, id, bus)).toThrow();
  });

  it('is deterministic: same world/brain yields same decision via Rng-seeded state', () => {
    const planner = new GoapPlanner();
    const run = () => {
      const world = new World();
      const bus = new EventBus<AgentEvents>();
      const seed = rng.nextInt(0, 0); // deterministic
      const id = world.spawn<Inventory>('Inventory', () => ({ hasAxe: seed, atTree: 0, hasWood: 0 }));
      const brain: Brain = {
        mode: 'goap',
        sensors: ['Inventory'],
        actions: goapActions.filter((a) => a.name !== 'pickUpAxe'), // axe already held
        options: [],
        goal: { hasWood: 1 } as WorldState,
      };
      world.addComponent('Brain', id, brain);
      return think(world, id, bus, planner);
    };
    expect(run()).toBe(run());
  });
});
