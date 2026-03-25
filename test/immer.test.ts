/**
 * Immer compatibility tests — validates that the Yjs middleware works
 * correctly when composed with Zustand's Immer middleware.
 *
 * This was the #1 bug in the original library (#53): remote updates
 * tried to mutate Immer-frozen objects, causing
 * "Cannot add property, object is not extensible" errors.
 */

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createStore } from "zustand";
import { immer } from "zustand/middleware/immer";
import { yjs } from "../src/index.js";

import { connectDocs, nextTick } from "./helpers.js";

/** Helper: create immer + yjs store + connect. */
function createImmerConnectedStore<T>(
  doc: Y.Doc,
  mapName: string,
  creator: Parameters<typeof yjs<T>>[1],
) {
  const store = createStore(immer(yjs<T>(mapName, creator)));
  store.yjs.connect(doc);
  return store;
}

describe("yjs + immer middleware compatibility (#53)", () => {
  it("works with immer middleware wrapping yjs", async () => {
    const doc = new Y.Doc();

    const store = createImmerConnectedStore(doc, "shared", (set) => ({
      count: 0,
      items: ["a", "b"],
      increment: () =>
        set((state) => {
          state.count += 1;
        }),
      addItem: (item: string) =>
        set((state) => {
          state.items.push(item);
        }),
    }));

    // Local mutations via immer should work.
    store.getState().increment();
    expect(store.getState().count).toBe(1);

    store.getState().addItem("c");
    expect(store.getState().items).toEqual(["a", "b", "c"]);

    // Changes should be reflected in Yjs.
    const map = doc.getMap("shared");
    expect(map.get("count")).toBe(1);
  });

  it("handles remote updates without mutating frozen immer objects", async () => {
    const doc = new Y.Doc();

    const store = createImmerConnectedStore(doc, "shared", (set) => ({
      count: 0,
      increment: () =>
        set((state) => {
          state.count += 1;
        }),
    }));

    // Simulate a remote change — this would crash the original library.
    doc.transact(() => {
      doc.getMap("shared").set("count", 42);
    });

    await nextTick();

    // Should work without "object is not extensible" errors.
    expect(store.getState().count).toBe(42);

    // Store should still be usable after remote update.
    store.getState().increment();
    expect(store.getState().count).toBe(43);
  });

  it("syncs immer-based stores between two peers", async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const disconnect = connectDocs(docA, docB);

    const storeA = createImmerConnectedStore(docA, "shared", (set) => ({
      todos: [{ id: 1, text: "Buy milk", done: false }],
      toggle: (id: number) =>
        set((state) => {
          const todo = state.todos.find((t) => t.id === id);
          if (todo) todo.done = !todo.done;
        }),
      addTodo: (text: string) =>
        set((state) => {
          state.todos.push({
            id: state.todos.length + 1,
            text,
            done: false,
          });
        }),
    }));

    await nextTick();

    const storeB = createImmerConnectedStore(docB, "shared", (set) => ({
      todos: [] as { id: number; text: string; done: boolean }[],
      toggle: (id: number) =>
        set((state) => {
          const todo = state.todos.find((t) => t.id === id);
          if (todo) todo.done = !todo.done;
        }),
      addTodo: (text: string) =>
        set((state) => {
          state.todos.push({
            id: state.todos.length + 1,
            text,
            done: false,
          });
        }),
    }));

    await nextTick();

    // B should have A's todos.
    expect(storeB.getState().todos).toEqual([
      { id: 1, text: "Buy milk", done: false },
    ]);

    // A toggles via immer mutation.
    storeA.getState().toggle(1);
    await nextTick();

    expect(storeA.getState().todos[0].done).toBe(true);
    expect(storeB.getState().todos[0].done).toBe(true);

    // B adds a todo via immer mutation.
    storeB.getState().addTodo("Walk dog");
    await nextTick();

    expect(storeA.getState().todos).toHaveLength(2);
    expect(storeB.getState().todos).toHaveLength(2);

    disconnect();
  });

  it("handles nested immer mutations synced across peers", async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const disconnect = connectDocs(docA, docB);

    const storeA = createImmerConnectedStore(docA, "shared", (set) => ({
      user: { profile: { name: "Alice", settings: { theme: "light" } } },
      setTheme: (theme: string) =>
        set((state) => {
          state.user.profile.settings.theme = theme;
        }),
    }));

    await nextTick();

    const storeB = createImmerConnectedStore(docB, "shared", (set) => ({
      user: {
        profile: { name: "", settings: { theme: "" } },
      },
      setTheme: (theme: string) =>
        set((state) => {
          state.user.profile.settings.theme = theme;
        }),
    }));

    await nextTick();

    expect(storeB.getState().user.profile.settings.theme).toBe("light");

    storeA.getState().setTheme("dark");
    await nextTick();

    expect(storeB.getState().user.profile.settings.theme).toBe("dark");

    disconnect();
  });
});
