/**
 * @omega/ai-relationships — a light, deterministic social model between agents.
 *
 * A {@link RelationshipNetwork} tracks DIRECTED sentiment between agents: how `a` feels about
 * `b` (sympathy) and how `a` ranks `b` (status). Both are clamped to a closed range
 * (default [-1, 1] for sympathy, [0, 1] for status). Relations are NOT assumed symmetric:
 * A can like B while B dislikes A. This is the realistic and still fully deterministic case.
 *
 * Every change flows through a single pure reducer: {@link applyInteraction}. An interaction
 * is a deterministic function of `{ type, magnitude, weight }` — e.g. `'help'` raises sympathy
 * by magnitude, `'harm'` lowers it, `'submit'` raises the actor's perceived status with the
 * target, `'dominate'` raises the actor's status over the target. The exact update math is a
 * fixed, monotonic, bounded formula (see below) with NO randomness and NO clock, so feeding the
 * SAME ordered list of interactions between the same agent ids ALWAYS produces the SAME network.
 *
 * This module deliberately does NOT depend on ai-goap — relationships are a stand-alone social
 * substrate other systems (goals, personality) can read. It only uses engine-math for clamp.
 *
 * UPDATE MATH (all pure, reproducible):
 *   sympathy(a→b) += weight * magnitude * dir   where dir = +1 for 'help'/'bond', -1 for 'harm'
 *   then clamped to [SYM_MIN, SYM_MAX].
 *   status(a over b) is moved toward 1 by `weight * magnitude * statusDir` for 'dominate'/'submit'
 *   (submit moves the actor's status DOWN relative to target; dominate moves it UP), clamped to
 *   [0, 1]. `status` is interpreted as "how much `a` outranks `b`".
 */

import { clamp } from '@omega/engine-math';

/** Directed sympathy range. */
export const SYM_MIN = -1;
export const SYM_MAX = 1;
/** Status range (0 = target dominates, 1 = actor dominates). */
export const STATUS_MIN = 0;
export const STATUS_MAX = 1;

/** The kind of social interaction. Each maps to a deterministic sympathy/status delta. */
export type InteractionType =
  | 'help' // increases sympathy (a feels warmer toward b)
  | 'harm' // decreases sympathy
  | 'bond' // conversation/alliance — mild sympathy increase
  | 'submit' // a yields to b — a's status relative to b drops
  | 'dominate'; // a asserts over b — a's status relative to b rises

/** A single social interaction: `actor` does `type` toward `target`. */
export interface Interaction {
  readonly actor: string;
  readonly target: string;
  /** The kind of social interaction. */
  readonly type: InteractionType;
  /** Signed magnitude of the effect (kept explicit so 'harm' can be passed with a +mag and we
   * apply the sign from the type, keeping call sites readable). Default 1. */
  readonly magnitude?: number;
  /** How strongly this interaction counts (0..1). Default 1. Scales the effect. */
  readonly weight?: number;
}

/** Serializable dump of the whole network (save/load + deterministic equality). */
export interface NetworkSnapshot {
  readonly actors: readonly string[];
  /** sympathy[actor][target] */
  readonly sympathy: Record<string, Record<string, number>>;
  /** status[actor][target] (actor's status OVER target) */
  readonly status: Record<string, Record<string, number>>;
}

/** A directed relation from `actor` toward `target`. */
export interface Relation {
  readonly actor: string;
  readonly target: string;
  readonly sympathy: number;
  readonly status: number;
}

/** The deterministic social network. */
export class RelationshipNetwork {
  private readonly sym: Record<string, Record<string, number>> = {};
  private readonly st: Record<string, Record<string, number>> = {};
  private readonly actors: Set<string> = new Set();

  /** All known actors (union of every interaction endpoint so far). */
  get actorIds(): readonly string[] {
    return [...this.actors];
  }

  private ensure(actor: string): void {
    this.actors.add(actor);
    if (!this.sym[actor]) this.sym[actor] = {};
    if (!this.st[actor]) this.st[actor] = {};
  }

  /** Sympathy of `actor` toward `target`, clamped/0 if unknown. */
  getSympathy(actor: string, target: string): number {
    const row = this.sym[actor];
    if (!row) return 0;
    const v = row[target];
    return v === undefined ? 0 : v;
  }

  /** Status of `actor` over `target` (1 = actor dominates), clamped/0 if unknown. */
  getStatus(actor: string, target: string): number {
    const row = this.st[actor];
    if (!row) return 0;
    const v = row[target];
    return v === undefined ? 0 : v;
  }

  /** The full directed relation from actor to target. */
  relation(actor: string, target: string): Relation {
    return {
      actor,
      target,
      sympathy: this.getSympathy(actor, target),
      status: this.getStatus(actor, target),
    };
  }

  /**
   * Apply one interaction deterministically. Returns the new Relation (post-update). The
   * update is a pure function of the prior relation + interaction params.
   */
  applyInteraction(it: Interaction): Relation {
    const mag = it.magnitude ?? 1;
    const w = clamp(it.weight ?? 1, 0, 1);
    const actor = it.actor;
    const target = it.target;
    this.ensure(actor);
    this.ensure(target);

    const symA = this.sym[actor]; // actor -> target sympathy
    const stA = this.st[actor]; // actor -> target status

    const prevSym = symA[target] ?? 0;
    const prevSt = stA[target] ?? 0;

    let nextSym = prevSym;
    let nextSt = prevSt;

    switch (it.type) {
      case 'help':
      case 'bond':
        nextSym = prevSym + w * mag; // warm up
        break;
      case 'harm':
        nextSym = prevSym - w * mag; // cool down
        break;
      case 'submit':
        // Actor yields: its status relative to target drops toward 0.
        nextSt = prevSt - w * mag;
        break;
      case 'dominate':
        // Actor asserts: its status relative to target rises toward 1.
        nextSt = prevSt + w * mag;
        break;
    }

    symA[target] = clamp(nextSym, SYM_MIN, SYM_MAX);
    stA[target] = clamp(nextSt, STATUS_MIN, STATUS_MAX);
    return this.relation(actor, target);
  }

  /** Apply a sequence of interactions in order (deterministic fold). */
  applyInteractions(seq: readonly Interaction[]): void {
    for (const it of seq) this.applyInteraction(it);
  }

  /**
   * Best ally of `actor`: the known target with the highest sympathy. Ties broken by target id
   * lexicographically so the result is unique and deterministic. Null if no relations exist.
   */
  bestAlly(actor: string): string | null {
    const row = this.sym[actor];
    if (!row) return null;
    let best: string | null = null;
    let bestVal = -Infinity;
    for (const t in row) {
      const v = row[t];
      if (v > bestVal || (v === bestVal && best !== null && t < best)) {
        best = t;
        bestVal = v;
      }
    }
    return best;
  }

  /**
   * Greatest rival of `actor`: the known target with the lowest sympathy. Ties broken by target
   * id lexicographically. Null if no relations exist.
   */
  worstRival(actor: string): string | null {
    const row = this.sym[actor];
    if (!row) return null;
    let worst: string | null = null;
    let worstVal = Infinity;
    for (const t in row) {
      const v = row[t];
      if (v < worstVal || (v === worstVal && worst !== null && t < worst)) {
        worst = t;
        worstVal = v;
      }
    }
    return worst;
  }

  /** Serialize the whole network for checkpoint/restore. */
  serialize(): NetworkSnapshot {
    const sympathy: Record<string, Record<string, number>> = {};
    const status: Record<string, Record<string, number>> = {};
    for (const a of this.actors) {
      sympathy[a] = { ...this.sym[a] };
      status[a] = { ...this.st[a] };
    }
    return { actors: [...this.actors], sympathy, status };
  }

  /** Rebuild a network byte-identically from a {@link serialize} blob. */
  static fromSnapshot(s: NetworkSnapshot): RelationshipNetwork {
    const net = new RelationshipNetwork();
    for (const a of s.actors) {
      net.ensure(a);
      for (const t in s.sympathy[a]) net.sym[a][t] = s.sympathy[a][t];
      for (const t in s.status[a]) net.st[a][t] = s.status[a][t];
    }
    return net;
  }
}
