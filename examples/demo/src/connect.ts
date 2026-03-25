import * as Y from "yjs";
import YProvider from "y-partykit/provider";
import { nanoid } from "nanoid";
import { createAwareness, createUndoManager } from "yjs-zustand";
import type { AwarenessStore, UndoManager } from "yjs-zustand";
import { store, STORE_MAP_NAME } from "./store";

// --- Types ---

export type Presence = {
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
};

export interface Connection {
  awareness: AwarenessStore<Presence>;
  undoManager: UndoManager;
}

// --- Helpers ---

const PARTYKIT_HOST = "yjs-zustand-demo.brian7989.partykit.dev";
const COLORS = ["#f06595", "#845ef7", "#339af0", "#20c997", "#fab005", "#ff6b6b"];
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

function resolveRoomId(): string {
  const existing = location.hash.slice(1);
  if (existing) return existing;
  const id = nanoid(6);
  location.hash = id;
  return id;
}

// --- Exported promise (consumed via React 19 `use()`) ---

export const connection: Promise<Connection> = (async () => {
  const doc = new Y.Doc();
  const roomId = resolveRoomId();

  const provider = new YProvider(PARTYKIT_HOST, roomId, doc);
  await new Promise<void>((resolve) => {
    if (provider.synced) { resolve(); return; }
    const timeout = setTimeout(resolve, 1500);
    provider.on("synced", () => { clearTimeout(timeout); resolve(); });
  });

  store.yjs.connect(doc);

  return {
    awareness: createAwareness<Presence>(provider.awareness, {
      name: `User ${Math.floor(Math.random() * 1000)}`,
      color: pick(COLORS),
      cursor: null,
    }),
    undoManager: createUndoManager(store),
  };
})();
