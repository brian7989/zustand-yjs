import { nanoid } from "nanoid";
import { createYjsStore } from "yjs-zustand";

// --- Types ---

interface Note {
  id: string;
  title: string;
  body: string;
}

interface NotesStore {
  notes: Note[];
  selectedId: string | null;
  add: () => void;
  updateTitle: (id: string, title: string) => void;
  updateBody: (id: string, body: string) => void;
  remove: (id: string) => void;
  select: (id: string | null) => void;
}

// --- Store ---

/**
 * The Y.Map name that backs this store inside the Y.Doc.
 * Multiple stores can share the same doc by using different map names.
 */
export const STORE_MAP_NAME = "notes";

export const store = createYjsStore<NotesStore>(STORE_MAP_NAME, (set) => ({
  notes: [],
  selectedId: null,
  add: () => {
    const id = nanoid();
    set((s) => ({ notes: [...s.notes, { id, title: "Untitled", body: "" }], selectedId: id }));
  },
  updateTitle: (id, title) =>
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, title } : n)) })),
  updateBody: (id, body) =>
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, body } : n)) })),
  remove: (id) =>
    set((s) => ({
      notes: s.notes.filter((n) => n.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),
  select: (id) => set({ selectedId: id }),
}), {
  arrayKeys: { notes: "id" },
  atomicStrings: ["id"],
  exclude: ["selectedId"],
});
