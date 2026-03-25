/**
 * Core middleware tests — validates the two-way binding between Zustand
 * stores and Yjs documents, including all the bugs fixed from the
 * original zustand-middleware-yjs library.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as Y from "yjs";
import { createStore } from "zustand";
import { yjs } from "../src/index.js";
import { connectDocs, nextTick } from "./helpers.js";

/** Helper: create store + connect in one step (common test pattern). */
function createConnectedStore<T>(
  doc: Y.Doc,
  mapName: string,
  creator: Parameters<typeof yjs<T>>[1],
  options?: Parameters<typeof yjs<T>>[2],
) {
  const store = createStore(yjs<T>(mapName, creator, options));
  store.yjs.connect(doc);
  return store;
}

// ---------------------------------------------------------------------------
// Basic functionality
// ---------------------------------------------------------------------------

describe("yjs middleware — basics", () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  it("creates a store with initial state", () => {
    const store = createConnectedStore(doc, "shared", () => ({
      count: 0,
      name: "hello",
    }));

    expect(store.getState()).toEqual({ count: 0, name: "hello" });
  });

  it("populates the Yjs map with initial state", () => {
    createConnectedStore(doc, "shared", () => ({
      count: 0,
      name: "hello",
    }));

    const map = doc.getMap("shared");
    expect(map.get("count")).toBe(0);
    expect(map.get("name")).toBeInstanceOf(Y.Text);
    expect((map.get("name") as Y.Text).toString()).toBe("hello");
  });

  it("syncs local state changes to Yjs", () => {
    const store = createConnectedStore(doc, "shared", (set) => ({
      count: 0,
      increment: () => set((s) => ({ count: s.count + 1 })),
    }));

    store.getState().increment();

    const map = doc.getMap("shared");
    expect(map.get("count")).toBe(1);
  });

  it("syncs remote Yjs changes to Zustand", async () => {
    const store = createConnectedStore(doc, "shared", () => ({
      count: 0,
    }));

    // Simulate a remote change (not from our middleware).
    doc.transact(() => {
      doc.getMap("shared").set("count", 42);
    });

    await nextTick();
    expect(store.getState().count).toBe(42);
  });

  it("does not sync function values to Yjs", () => {
    createConnectedStore(doc, "shared", (set) => ({
      count: 0,
      increment: () => set((s) => ({ count: s.count + 1 })),
    }));

    const map = doc.getMap("shared");
    expect(map.has("increment")).toBe(false);
    expect(map.has("count")).toBe(true);
  });

  it("does not sync nested function values to Yjs", async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const disconnect = connectDocs(docA, docB);

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      items: [
        { id: 1, label: "test", onClick: () => console.log("click") },
      ],
      config: {
        theme: "dark",
        onThemeChange: () => console.log("theme"),
      },
      addItem: (label: string) =>
        set((s) => ({
          items: [
            ...s.items,
            { id: s.items.length + 1, label, onClick: () => {} },
          ],
        })),
    }));

    await nextTick();

    const storeB = createConnectedStore(docB, "shared", () => ({
      items: [] as { id: number; label: string; onClick?: () => void }[],
      config: { theme: "" },
    }));

    await nextTick();

    // Nested functions should NOT appear in Yjs or on the remote peer.
    expect(storeB.getState().items[0].id).toBe(1);
    expect(storeB.getState().items[0].label).toBe("test");
    expect(storeB.getState().items[0].onClick).toBeUndefined();
    expect(storeB.getState().config.theme).toBe("dark");

    // The Y.Map should not contain function keys at any level.
    const map = docA.getMap("shared");
    const configMap = map.get("config") as Y.Map<unknown>;
    expect(configMap.has("onThemeChange")).toBe(false);
    expect(configMap.has("theme")).toBe(true);

    disconnect();
  });

  it("preserves functions after remote update", async () => {
    const store = createConnectedStore(doc, "shared", (set) => ({
      count: 0,
      increment: () => set((s) => ({ count: s.count + 1 })),
    }));

    doc.transact(() => {
      doc.getMap("shared").set("count", 10);
    });

    await nextTick();
    expect(typeof store.getState().increment).toBe("function");
    expect(store.getState().count).toBe(10);

    // Function should still work after remote update.
    store.getState().increment();
    expect(store.getState().count).toBe(11);
  });

  it("handles setState (outside actions)", () => {
    const store = createConnectedStore(doc, "shared", () => ({
      count: 0,
    }));

    store.setState({ count: 99 });

    const map = doc.getMap("shared");
    expect(map.get("count")).toBe(99);
  });

  it("does not push to Yjs when disconnected", () => {
    const store = createStore(
      yjs("shared", (set) => ({
        count: 0,
        increment: () => set((s) => ({ count: s.count + 1 })),
      })),
    );

    // Store works locally without being connected.
    store.getState().increment();
    expect(store.getState().count).toBe(1);

    // No Y.Map should have been touched.
    const map = doc.getMap("shared");
    expect(map.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Two-peer sync (the core collaboration scenario)
// ---------------------------------------------------------------------------

describe("yjs middleware — two-peer sync", () => {
  it("syncs state between two peers via connected Yjs docs", async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const disconnect = connectDocs(docA, docB);

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      count: 0,
      increment: () => set((s) => ({ count: s.count + 1 })),
    }));

    // Peer B connects after A has already initialised.
    await nextTick();

    const storeB = createConnectedStore(docB, "shared", (set) => ({
      count: 0,
      increment: () => set((s) => ({ count: s.count + 1 })),
    }));

    await nextTick();

    // B should have received A's initial state.
    expect(storeB.getState().count).toBe(0);

    // A increments.
    storeA.getState().increment();
    await nextTick();

    expect(storeA.getState().count).toBe(1);
    expect(storeB.getState().count).toBe(1);

    // B increments.
    storeB.getState().increment();
    await nextTick();

    expect(storeA.getState().count).toBe(2);
    expect(storeB.getState().count).toBe(2);

    disconnect();
  });

  it("syncs nested objects between peers", async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const disconnect = connectDocs(docA, docB);

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      user: { name: "Alice", age: 30 },
      setName: (name: string) =>
        set((s) => ({ user: { ...s.user, name } })),
    }));

    await nextTick();

    const storeB = createConnectedStore(docB, "shared", (set) => ({
      user: { name: "", age: 0 },
      setName: (name: string) =>
        set((s) => ({ user: { ...s.user, name } })),
    }));

    await nextTick();

    expect(storeB.getState().user.name).toBe("Alice");
    expect(storeB.getState().user.age).toBe(30);

    storeA.getState().setName("Bob");
    await nextTick();

    expect(storeA.getState().user.name).toBe("Bob");
    expect(storeB.getState().user.name).toBe("Bob");

    disconnect();
  });

  it("syncs arrays between peers", async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const disconnect = connectDocs(docA, docB);

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      items: ["a", "b", "c"],
      addItem: (item: string) =>
        set((s) => ({ items: [...s.items, item] })),
    }));

    await nextTick();

    const storeB = createConnectedStore(docB, "shared", (set) => ({
      items: [] as string[],
      addItem: (item: string) =>
        set((s) => ({ items: [...s.items, item] })),
    }));

    await nextTick();

    expect(storeB.getState().items).toEqual(["a", "b", "c"]);

    storeA.getState().addItem("d");
    await nextTick();

    expect(storeB.getState().items).toEqual(["a", "b", "c", "d"]);

    disconnect();
  });
});

// ---------------------------------------------------------------------------
// Bug fix: Array deletion with multiple items (#61)
// ---------------------------------------------------------------------------

describe("yjs middleware — array deletion bug fix (#61)", () => {
  it("correctly deletes multiple array items at once", async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const disconnect = connectDocs(docA, docB);

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      items: [0, 1, 2, 3, 4],
      removeItems: (indices: number[]) =>
        set((s) => ({
          items: s.items.filter((_, i) => !indices.includes(i)),
        })),
    }));

    await nextTick();

    const storeB = createConnectedStore(docB, "shared", () => ({
      items: [] as number[],
    }));

    await nextTick();
    expect(storeB.getState().items).toEqual([0, 1, 2, 3, 4]);

    // Delete items at index 0 and 3 simultaneously.
    storeA.getState().removeItems([0, 3]);
    await nextTick();

    expect(storeA.getState().items).toEqual([1, 2, 4]);
    expect(storeB.getState().items).toEqual([1, 2, 4]);

    disconnect();
  });

  it("handles deleting all items from an array", async () => {
    const doc = new Y.Doc();

    const store = createConnectedStore(doc, "shared", (set) => ({
      items: [1, 2, 3],
      clear: () => set({ items: [] }),
    }));

    store.getState().clear();

    const map = doc.getMap("shared");
    const yArr = map.get("items") as Y.Array<unknown>;
    expect(yArr.length).toBe(0);
    expect(store.getState().items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Bug fix: Nested array re-render (#63) — structural sharing
// ---------------------------------------------------------------------------

describe("yjs middleware — structural sharing / immutability (#63)", () => {
  it("produces new references for changed nested objects", async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const disconnect = connectDocs(docA, docB);

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      todos: [
        { id: 1, text: "Buy milk", done: false },
        { id: 2, text: "Walk dog", done: false },
      ],
      toggle: (id: number) =>
        set((s) => ({
          todos: s.todos.map((t) =>
            t.id === id ? { ...t, done: !t.done } : t,
          ),
        })),
    }));

    await nextTick();

    const storeB = createConnectedStore(docB, "shared", () => ({
      todos: [] as { id: number; text: string; done: boolean }[],
    }));

    await nextTick();

    const todosBeforeB = storeB.getState().todos;

    // A toggles a todo.
    storeA.getState().toggle(1);
    await nextTick();

    const todosAfterB = storeB.getState().todos;

    // The array reference should have changed.
    expect(todosAfterB).not.toBe(todosBeforeB);

    // The changed todo should be different.
    expect(todosAfterB[0].done).toBe(true);

    disconnect();
  });

  it("reuses references for unchanged subtrees (structural sharing)", async () => {
    const doc = new Y.Doc();

    const store = createConnectedStore(doc, "shared", (set) => ({
      a: { x: 1 },
      b: { y: 2 },
      setA: (x: number) => set({ a: { x } }),
    }));

    const bBefore = store.getState().b;

    // Only change `a`, not `b`.
    store.getState().setA(10);

    expect(store.getState().a).toEqual({ x: 10 });
    expect(store.getState().b).toEqual({ y: 2 });

    // Now test via remote update path.
    const docB = new Y.Doc();
    const disconnect = connectDocs(doc, docB);

    const storeB = createConnectedStore(docB, "shared", () => ({
      a: { x: 0 },
      b: { y: 0 },
    }));

    await nextTick();

    const bBeforeRemote = storeB.getState().b;

    // Change only `a` remotely.
    doc.transact(() => {
      const map = doc.getMap("shared");
      const aMap = map.get("a") as Y.Map<unknown>;
      aMap.set("x", 999);
    });

    await nextTick();

    // `b` reference should be preserved.
    expect(storeB.getState().b).toBe(bBeforeRemote);
    expect(storeB.getState().a).toEqual({ x: 999 });

    disconnect();
  });

  it("preserves intermediate references for deep nested changes (recursive structural sharing)", async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const disconnect = connectDocs(docA, docB);

    createConnectedStore(docA, "shared", (set) => ({
      data: {
        sidebar: { width: 200, collapsed: false },
        content: { title: "Hello", body: "World" },
      },
      setTitle: (t: string) =>
        set((s) => ({
          data: { ...s.data, content: { ...s.data.content, title: t } },
        })),
    }));

    const storeB = createConnectedStore(docB, "shared", () => ({
      data: {
        sidebar: { width: 0, collapsed: false },
        content: { title: "", body: "" },
      },
    }));

    await nextTick();

    const sidebarBefore = storeB.getState().data.sidebar;

    // Change only content.title remotely via docA.
    docA.transact(() => {
      const map = docA.getMap("shared");
      const dataMap = map.get("data") as Y.Map<unknown>;
      const contentMap = dataMap.get("content") as Y.Map<unknown>;
      const titleText = contentMap.get("title") as Y.Text;
      titleText.delete(0, titleText.length);
      titleText.insert(0, "Changed");
    });

    await nextTick();

    // sidebar reference should be preserved — it's an unchanged sibling.
    expect(storeB.getState().data.sidebar).toBe(sidebarBefore);
    expect(storeB.getState().data.content.title).toBe("Changed");

    disconnect();
  });
});

// ---------------------------------------------------------------------------
// Atomic strings option (#65)
// ---------------------------------------------------------------------------

describe("yjs middleware — atomic strings (#65)", () => {
  it("stores atomic string keys as plain strings, not Y.Text", () => {
    const doc = new Y.Doc();

    createConnectedStore(
      doc,
      "shared",
      () => ({
        id: "abc-123-uuid",
        name: "editable text",
      }),
      { atomicStrings: ["id"] },
    );

    const map = doc.getMap("shared");
    // `id` should be a plain string.
    expect(typeof map.get("id")).toBe("string");
    expect(map.get("id")).toBe("abc-123-uuid");
    // `name` should still be Y.Text.
    expect(map.get("name")).toBeInstanceOf(Y.Text);
  });

  it("syncs atomic strings between peers", async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const disconnect = connectDocs(docA, docB);

    const opts = { atomicStrings: ["id"] };

    const storeA = createConnectedStore(
      docA,
      "shared",
      (set) => ({
        id: "abc",
        setId: (id: string) => set({ id }),
      }),
      opts,
    );

    await nextTick();

    const storeB = createConnectedStore(
      docB,
      "shared",
      () => ({ id: "" }),
      opts,
    );

    await nextTick();
    expect(storeB.getState().id).toBe("abc");

    storeA.getState().setId("xyz-new-uuid");
    await nextTick();

    expect(storeB.getState().id).toBe("xyz-new-uuid");

    disconnect();
  });
});

// ---------------------------------------------------------------------------
// Sync status callback (#25)
// ---------------------------------------------------------------------------

describe("yjs middleware — sync status callback (#25)", () => {
  it("calls onSyncStatusChange for remote updates", async () => {
    const doc = new Y.Doc();
    const statuses: string[] = [];

    createConnectedStore(
      doc,
      "shared",
      () => ({ count: 0 }),
      {
        onSyncStatusChange: (status) => statuses.push(status),
      },
    );

    // Simulate a remote change.
    doc.transact(() => {
      doc.getMap("shared").set("count", 5);
    });

    await nextTick();

    expect(statuses).toContain("syncing");
    expect(statuses).toContain("synced");
    expect(statuses[statuses.length - 1]).toBe("synced");
  });

  it("does not call onSyncStatusChange for local updates", () => {
    const doc = new Y.Doc();
    const statuses: string[] = [];

    const store = createConnectedStore(
      doc,
      "shared",
      (set) => ({
        count: 0,
        increment: () => set((s) => ({ count: s.count + 1 })),
      }),
      {
        onSyncStatusChange: (status) => statuses.push(status),
      },
    );

    store.getState().increment();

    // No status change should have been emitted (local origin).
    expect(statuses).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("yjs middleware — edge cases", () => {
  it("handles null and undefined values", () => {
    const doc = new Y.Doc();

    const store = createConnectedStore(doc, "shared", (set) => ({
      value: null as string | null,
      setValue: (v: string | null) => set({ value: v }),
    }));

    expect(store.getState().value).toBeNull();

    store.getState().setValue("hello");
    expect(store.getState().value).toBe("hello");

    store.getState().setValue(null);
    expect(store.getState().value).toBeNull();
  });

  it("handles boolean values", () => {
    const doc = new Y.Doc();

    const store = createConnectedStore(doc, "shared", (set) => ({
      active: false,
      toggle: () => set((s) => ({ active: !s.active })),
    }));

    expect(store.getState().active).toBe(false);
    store.getState().toggle();
    expect(store.getState().active).toBe(true);
    expect(doc.getMap("shared").get("active")).toBe(true);
  });

  it("handles deeply nested objects", async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const disconnect = connectDocs(docA, docB);

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      data: {
        level1: {
          level2: {
            value: "deep",
          },
        },
      },
      setDeep: (v: string) =>
        set({
          data: { level1: { level2: { value: v } } },
        }),
    }));

    await nextTick();

    const storeB = createConnectedStore(docB, "shared", () => ({
      data: { level1: { level2: { value: "" } } },
    }));

    await nextTick();
    expect(storeB.getState().data.level1.level2.value).toBe("deep");

    storeA.getState().setDeep("deeper");
    await nextTick();

    expect(storeB.getState().data.level1.level2.value).toBe("deeper");

    disconnect();
  });

  it("handles empty initial state gracefully", () => {
    const doc = new Y.Doc();

    const store = createConnectedStore(doc, "shared", () => ({}));

    expect(store.getState()).toEqual({});
  });

  it("handles rapid successive updates", async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const disconnect = connectDocs(docA, docB);

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      count: 0,
      set: (n: number) => set({ count: n }),
    }));

    await nextTick();

    const storeB = createConnectedStore(docB, "shared", () => ({ count: 0 }));

    await nextTick();

    // Fire many updates rapidly.
    for (let i = 1; i <= 50; i++) {
      storeA.getState().set(i);
    }

    await nextTick();

    expect(storeA.getState().count).toBe(50);
    expect(storeB.getState().count).toBe(50);

    disconnect();
  });

  it("uses existing Yjs map data when store connects late", async () => {
    const doc = new Y.Doc();

    // Pre-populate the Yjs map as if another peer already wrote data.
    doc.transact(() => {
      const map = doc.getMap("shared");
      map.set("count", 42);
      const text = new Y.Text();
      text.insert(0, "existing");
      map.set("name", text);
    });

    // Now create the store — it should pick up existing data.
    const store = createConnectedStore(doc, "shared", () => ({
      count: 0,
      name: "default",
    }));

    expect(store.getState().count).toBe(42);
    expect(store.getState().name).toBe("existing");
  });
});

// ---------------------------------------------------------------------------
// Cleanup / disconnect
// ---------------------------------------------------------------------------

describe("yjs middleware — cleanup / disconnect", () => {
  it("stops syncing remote changes after disconnect()", async () => {
    const doc = new Y.Doc();

    const store = createConnectedStore(doc, "shared", () => ({
      count: 0,
    }));

    store.yjs.disconnect();

    // Remote change after disconnect should NOT update the store.
    doc.transact(() => {
      doc.getMap("shared").set("count", 999);
    });

    await nextTick();

    expect(store.getState().count).toBe(0);
  });

  it("local changes still work after disconnect (just no Yjs sync)", () => {
    const doc = new Y.Doc();

    const store = createConnectedStore(doc, "shared", (set) => ({
      count: 0,
      increment: () => set((s) => ({ count: s.count + 1 })),
    }));

    store.yjs.disconnect();

    // Local set still works on the Zustand store itself.
    store.getState().increment();
    expect(store.getState().count).toBe(1);
  });

  it("can be called multiple times without error", () => {
    const doc = new Y.Doc();

    const store = createConnectedStore(doc, "shared", () => ({ count: 0 }));

    expect(() => {
      store.yjs.disconnect();
      store.yjs.disconnect();
      store.yjs.disconnect();
    }).not.toThrow();
  });

  it("can reconnect after disconnect", async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const store = createConnectedStore(docA, "shared", (set) => ({
      count: 0,
      setCount: (n: number) => set({ count: n }),
    }));

    store.getState().setCount(5);
    expect(docA.getMap("shared").get("count")).toBe(5);

    // Disconnect and reconnect to a different doc.
    store.yjs.disconnect();
    store.yjs.connect(docB);

    // Should populate the new doc with current state.
    expect(docB.getMap("shared").get("count")).toBe(5);

    store.getState().setCount(10);
    expect(docB.getMap("shared").get("count")).toBe(10);
    // Old doc should not be updated.
    expect(docA.getMap("shared").get("count")).toBe(5);
  });

  it("switchRoom disconnects and reconnects atomically", async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const store = createConnectedStore(docA, "shared", (set) => ({
      count: 0,
      setCount: (n: number) => set({ count: n }),
    }));

    store.getState().setCount(42);

    store.yjs.switchRoom(docB);

    expect(store.yjs.doc).toBe(docB);
    expect(store.yjs.connected).toBe(true);

    // New doc should have current state.
    expect(docB.getMap("shared").get("count")).toBe(42);

    // Old doc should not receive new updates.
    store.getState().setCount(100);
    expect(docA.getMap("shared").get("count")).toBe(42);
    expect(docB.getMap("shared").get("count")).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Y.Text incremental diff
// ---------------------------------------------------------------------------

describe("yjs middleware — Y.Text incremental diff", () => {
  it("patches text by only changing the middle section", () => {
    const doc = new Y.Doc();

    const store = createConnectedStore(doc, "shared", (set) => ({
      text: "hello world",
      setText: (t: string) => set({ text: t }),
    }));

    const map = doc.getMap("shared");
    const yText = map.get("text") as Y.Text;

    store.getState().setText("hello there");
    expect(yText.toString()).toBe("hello there");

    store.getState().setText("hello there!");
    expect(yText.toString()).toBe("hello there!");

    store.getState().setText("hi there!");
    expect(yText.toString()).toBe("hi there!");
  });

  it("handles complete text replacement", () => {
    const doc = new Y.Doc();

    const store = createConnectedStore(doc, "shared", (set) => ({
      text: "abc",
      setText: (t: string) => set({ text: t }),
    }));

    store.getState().setText("xyz");

    const yText = doc.getMap("shared").get("text") as Y.Text;
    expect(yText.toString()).toBe("xyz");
  });

  it("handles empty string transitions", () => {
    const doc = new Y.Doc();

    const store = createConnectedStore(doc, "shared", (set) => ({
      text: "",
      setText: (t: string) => set({ text: t }),
    }));

    store.getState().setText("something");
    expect(
      (doc.getMap("shared").get("text") as Y.Text).toString(),
    ).toBe("something");

    store.getState().setText("");
    expect(
      (doc.getMap("shared").get("text") as Y.Text).toString(),
    ).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Concurrent synchronous set() calls
// ---------------------------------------------------------------------------

describe("yjs middleware — concurrent synchronous set() calls", () => {
  it("handles multiple set() calls in same tick", () => {
    const doc = new Y.Doc();

    const store = createConnectedStore(doc, "shared", (set) => ({
      a: 0,
      b: 0,
      setA: (v: number) => set({ a: v }),
      setB: (v: number) => set({ b: v }),
    }));

    store.getState().setA(1);
    store.getState().setB(2);
    store.getState().setA(3);

    expect(store.getState().a).toBe(3);
    expect(store.getState().b).toBe(2);

    const map = doc.getMap("shared");
    expect(map.get("a")).toBe(3);
    expect(map.get("b")).toBe(2);
  });

  it("handles set() with identical values (no-op)", async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const disconnect = connectDocs(docA, docB);

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      count: 5,
      setCount: (n: number) => set({ count: n }),
    }));

    await nextTick();

    const storeB = createConnectedStore(docB, "shared", () => ({ count: 0 }));

    await nextTick();

    storeA.getState().setCount(5);

    await nextTick();

    expect(storeA.getState().count).toBe(5);
    expect(storeB.getState().count).toBe(5);

    disconnect();
  });
});
