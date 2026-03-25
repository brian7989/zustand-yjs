import { useSyncExternalStore } from "react";
import { useHotkeys } from "@mantine/hooks";
import type { UndoManager } from "yjs-zustand";

export function useUndo(manager: UndoManager) {
  const { canUndo, canRedo } = useSyncExternalStore(
    manager.store.subscribe,
    manager.store.getState,
  );

  useHotkeys([
    ["mod+z", () => manager.undo()],
    ["mod+shift+z", () => manager.redo()],
  ]);

  return { canUndo, canRedo, undo: manager.undo, redo: manager.redo };
}
