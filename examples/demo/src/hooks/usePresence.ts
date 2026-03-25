import { useSyncExternalStore } from "react";
import type { AwarenessStore } from "yjs-zustand";
import type { Presence } from "../connect";

export function usePresence(awareness: AwarenessStore<Presence>) {
  return useSyncExternalStore(awareness.store.subscribe, awareness.store.getState);
}
