/**
 * zustand-yjs — Production-quality Yjs middleware for Zustand.
 *
 * @example
 * ```ts
 * import * as Y from "yjs";
 * import { create } from "zustand";
 * import { yjs } from "zustand-yjs";
 *
 * const doc = new Y.Doc();
 *
 * const useStore = create(
 *   yjs("shared", (set) => ({
 *     count: 0,
 *     increment: () => set((s) => ({ count: s.count + 1 })),
 *   }))
 * );
 *
 * useStore.yjs.connect(doc);
 * ```
 */

// Core middleware
export { yjs, createYjsStore } from "./middleware.js";

// Extensions
export { createAwareness } from "./awareness.js";
export { createUndoManager } from "./undo.js";

// Types
export type {
  YjsOptions,
  SyncStatus,
  YjsStoreApi,
  YjsConnection,
  AwarenessState,
  AwarenessStore,
  UndoManager,
} from "./types.js";

// Constants
export { ORIGIN } from "./types.js";
