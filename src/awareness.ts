/**
 * Awareness protocol integration for Zustand.
 *
 * Creates a reactive Zustand store backed by the Yjs awareness protocol.
 * Awareness is for ephemeral, per-client state that isn't persisted in the
 * document: cursor positions, user names, online status, selections, etc.
 *
 * Each client sets its own local state; all clients can observe everyone's
 * state reactively through the returned Zustand store.
 *
 * @example
 * ```ts
 * import { WebsocketProvider } from "y-websocket";
 * import { createAwareness } from "yjs-zustand";
 *
 * const awareness = createAwareness(provider.awareness, {
 *   cursor: null,
 *   name: "Anonymous",
 * });
 *
 * awareness.setLocal({ name: "Alice", cursor: { x: 10, y: 20 } });
 * awareness.store.getState().peers; // Map of all clients' states
 * ```
 */

import { createStore } from "zustand";
import type { Awareness } from "y-protocols/awareness";
import type { AwarenessState, AwarenessStore, PlainObject } from "./types.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a reactive awareness store backed by the Yjs awareness protocol.
 *
 * @param awareness - The Yjs awareness instance (from a provider).
 * @param defaults  - Default values for your local awareness state.
 * @returns An `AwarenessStore` with `setLocal()`, `getLocal()`, `store`, and `destroy()`.
 */
export function createAwareness<TLocal extends PlainObject>(
  awareness: Awareness,
  defaults: TLocal,
): AwarenessStore<TLocal> {
  // Set initial local state.
  awareness.setLocalState({ ...defaults });

  // Create the reactive Zustand store.
  const store = createStore<AwarenessState<TLocal>>()(() => ({
    peers: buildPeersMap<TLocal>(awareness),
    localClientId: awareness.clientID,
  }));

  // Observe awareness changes and incrementally update the peers Map.
  const onChange = (
    changes: { added: number[]; updated: number[]; removed: number[] },
  ) => {
    const currentPeers = store.getState().peers;
    const newPeers = new Map(currentPeers);

    for (const id of changes.removed) {
      newPeers.delete(id);
    }

    const states = awareness.getStates();
    for (const id of changes.added) {
      const state = states.get(id);
      if (state != null) newPeers.set(id, state as TLocal);
    }
    for (const id of changes.updated) {
      const state = states.get(id);
      if (state != null) newPeers.set(id, state as TLocal);
    }

    store.setState({ peers: newPeers });
  };

  awareness.on("change", onChange);

  return {
    setLocal(partial: Partial<TLocal>) {
      const current = awareness.getLocalState() ?? {};
      awareness.setLocalState({ ...current, ...partial });
    },

    getLocal(): TLocal {
      return (awareness.getLocalState() ?? { ...defaults }) as TLocal;
    },

    store,

    destroy() {
      awareness.off("change", onChange);
      awareness.setLocalState(null);
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a Map of all connected peers' awareness states.
 * Filters out clients with null state (disconnected).
 * Used only for initial state — incremental updates use the onChange handler.
 */
function buildPeersMap<TLocal extends PlainObject>(
  awareness: Awareness,
): Map<number, TLocal> {
  const peers = new Map<number, TLocal>();

  awareness.getStates().forEach((state, clientId) => {
    if (state !== null) {
      peers.set(clientId, state as TLocal);
    }
  });

  return peers;
}
