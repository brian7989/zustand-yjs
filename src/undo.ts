/**
 * Collaborative undo/redo powered by Y.UndoManager.
 *
 * Unlike zundo (which undoes ALL state changes including remote ones),
 * Y.UndoManager only undoes changes made by the LOCAL client. This is the
 * correct behaviour for collaborative applications — you shouldn't be able
 * to undo your collaborator's edits.
 *
 * @example
 * ```ts
 * import { createYjsStore, createUndoManager } from "yjs-zustand";
 *
 * const store = createYjsStore("shared", (set) => ({
 *   count: 0,
 *   increment: () => set((s) => ({ count: s.count + 1 })),
 * }));
 * store.yjs.connect(doc);
 *
 * const undo = createUndoManager(store);
 *
 * undo.undo();
 * undo.redo();
 * undo.store.getState().canUndo; // reactive boolean
 * undo.destroy();
 * ```
 */

import * as Y from "yjs";
import { createStore } from "zustand";
import type { StoreApi } from "zustand";
import { ORIGIN } from "./types.js";
import type { UndoManager, YjsStoreApi } from "./types.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a collaborative undo manager for a yjs-powered Zustand store.
 *
 * @param store - A Zustand store created with the `yjs()` middleware.
 *                Must be connected (`store.yjs.connect(doc)`) before calling.
 * @returns An `UndoManager` with `undo()`, `redo()`, `canUndo()`, `canRedo()`,
 *          a reactive `store`, and `destroy()`.
 */
export function createUndoManager<T>(
  store: StoreApi<T> & Pick<YjsStoreApi<T>, "yjs">,
): UndoManager {
  const yMap = store.yjs.yMap;

  if (!yMap) {
    throw new Error(
      "yjs-zustand: Cannot create undo manager — store is not connected. " +
      "Call store.yjs.connect(doc) first.",
    );
  }

  const manager = new Y.UndoManager(yMap, {
    trackedOrigins: new Set([ORIGIN]),
  });

  // Reactive store for UI binding (e.g. disable undo button).
  const undoStore = createStore<{ canUndo: boolean; canRedo: boolean }>()(() => ({
    canUndo: manager.undoStack.length > 0,
    canRedo: manager.redoStack.length > 0,
  }));

  const updateUndoState = () => {
    undoStore.setState({
      canUndo: manager.undoStack.length > 0,
      canRedo: manager.redoStack.length > 0,
    });
  };

  manager.on("stack-item-added", updateUndoState);
  manager.on("stack-item-popped", updateUndoState);
  manager.on("stack-cleared", updateUndoState);

  return {
    undo() {
      manager.undo();
    },

    redo() {
      manager.redo();
    },

    canUndo() {
      return manager.undoStack.length > 0;
    },

    canRedo() {
      return manager.redoStack.length > 0;
    },

    store: undoStore,

    destroy() {
      manager.destroy();
    },
  };
}
