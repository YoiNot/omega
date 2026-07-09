/**
 * @omega/net — server-authoritative networking layer for PROJECT OMEGA.
 *
 * Provides the transport abstraction, input-command recording/acknowledgement,
 * world-snapshot buffering/interpolation/serialization, and a server-authoritative
 * simulation with client-side prediction and reconciliation.
 */

export * from './transport.js';
export * from './commands.js';
export * from './snapshot.js';
export * from './reconcile.js';
