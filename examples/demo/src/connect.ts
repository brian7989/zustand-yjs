import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { nanoid } from "nanoid";
import { createAwareness, createUndoManager } from "yjs-zustand";
import type { AwarenessStore, UndoManager } from "yjs-zustand";
import { store } from "./store";

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

const COLORS = ["#f06595", "#845ef7", "#339af0", "#20c997", "#fab005", "#ff6b6b"];
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

function resolveRoomId(): string {
  const existing = location.hash.slice(1);
  if (existing) return existing;
  const id = nanoid(6);
  location.hash = id;
  return id;
}

function waitForProvider(provider: WebrtcProvider): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 1000);
    provider.on("synced", () => { clearTimeout(timeout); resolve(); });
  });
}

// --- Exported promise (consumed via React 19 `use()`) ---

export const connection: Promise<Connection> = (async () => {
  const doc = new Y.Doc();
  const provider = new WebrtcProvider(resolveRoomId(), doc);

  await waitForProvider(provider);
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
