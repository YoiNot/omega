import { describe, it, expect } from 'vitest';
import * as NR from './index.js';

describe('@omega/net-replication public API', () => {
  it('re-exports the codec, server, client, and net building blocks', () => {
    // Codec + binary primitives
    expect(typeof NR.Codec).toBe('function');
    expect(typeof NR.BinaryWriter).toBe('function');
    expect(typeof NR.BinaryReader).toBe('function');
    expect(typeof NR.worldToSnapshot).toBe('function');
    expect(typeof NR.snapshotToWorld).toBe('function');

    // Server + client
    expect(typeof NR.ReplicatedServer).toBe('function');
    expect(typeof NR.ReplicatedClient).toBe('function');

    // Re-exported net layer
    expect(typeof NR.ServerAuthoritativeSim).toBe('function');
    expect(typeof NR.LoopbackTransport).toBe('function');
    expect(typeof NR.SnapshotBuffer).toBe('function');
    expect(typeof NR.interpolate).toBe('function');
    expect(typeof NR.encodeSnapshot).toBe('function');
    expect(typeof NR.decodeSnapshot).toBe('function');

    // Re-exported ecs + engine-core + sim
    expect(typeof NR.World).toBe('function');
    expect(typeof NR.defineComponent).toBe('function');
    expect(typeof NR.Rng).toBe('function');
    expect(typeof NR.Simulation).toBe('function');
  });

  it('constructs a Codec and a ReplicatedServer/Client end to end', () => {
    const codec = new NR.Codec();
    const Position = NR.defineComponent<{ x: number; y: number }>('position');
    codec.registerComponent(Position, 'position');
    const server = new NR.ReplicatedServer(new NR.World(), codec);
    const client = new NR.ReplicatedClient(new NR.World(), codec);
    expect(server).toBeInstanceOf(NR.ReplicatedServer);
    expect(client).toBeInstanceOf(NR.ReplicatedClient);
  });
});
