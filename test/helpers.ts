/**
 * Test helpers — shared utilities for all test files.
 */

import * as Y from "yjs";

/**
 * Connect two Y.Docs so that changes on one are applied to the other.
 * Returns a disconnect function. This simulates a network connection
 * without needing a real WebSocket server.
 */
export function connectDocs(docA: Y.Doc, docB: Y.Doc): () => void {
  const applyUpdate = (update: Uint8Array, origin: unknown, target: Y.Doc) => {
    // Only apply if the origin is not the target doc itself.
    if (origin !== target) {
      Y.applyUpdate(target, update, docA);
    }
  };

  const onUpdateA = (update: Uint8Array, origin: unknown) =>
    applyUpdate(update, origin, docB);
  const onUpdateB = (update: Uint8Array, origin: unknown) =>
    applyUpdate(update, origin, docA);

  docA.on("update", onUpdateA);
  docB.on("update", onUpdateB);

  // Initial sync: exchange full state.
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), docA);
  Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), docB);

  return () => {
    docA.off("update", onUpdateA);
    docB.off("update", onUpdateB);
  };
}

/**
 * Wait for the next microtask / event-loop tick. Useful for waiting
 * for Yjs observers to fire after a transaction.
 */
export function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Wait a specified number of milliseconds.
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
