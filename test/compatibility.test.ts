/**
 * Middleware compatibility tests — validates that the Yjs middleware
 * composes correctly with other popular Zustand middleware.
 */

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createStore } from "zustand";
import { devtools, persist, subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { temporal } from "zundo";
import { yjs } from "../src/index.js";

import { connectDocs, nextTick } from "./helpers.js";

// ---------------------------------------------------------------------------
// yjs + devtools
// ---------------------------------------------------------------------------

describe("yjs + devtools", () => {
  it("works with devtools wrapping yjs", () => {
    const doc = new Y.Doc();

    const store = createStore(
      devtools(
        yjs("shared", (set) => ({
          count: 0,
          increment: () => set((s) => ({ count: s.count + 1 })),
        })),
      ),
    );
    store.yjs.connect(doc);

    expect(store.getState().count).toBe(0);

    store.getState().increment();
    expect(store.getState().count).toBe(1);
    expect(doc.getMap("shared").get("count")).toBe(1);
  });

  it("syncs remote changes with devtools", async () => {
    const doc = new Y.Doc();

    const store = createStore(
      devtools(
        yjs("shared", () => ({
          count: 0,
        })),
      ),
    );
    store.yjs.connect(doc);

    doc.transact(() => {
      doc.getMap("shared").set("count", 42);
    });

    await nextTick();
    expect(store.getState().count).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// yjs + subscribeWithSelector
// ---------------------------------------------------------------------------

describe("yjs + subscribeWithSelector", () => {
  it("fires selector-based subscriptions on remote changes", async () => {
    const doc = new Y.Doc();

    const store = createStore(
      subscribeWithSelector(
        yjs("shared", (set) => ({
          count: 0,
          name: "Alice",
          setCount: (n: number) => set({ count: n }),
        })),
      ),
    );
    store.yjs.connect(doc);

    const observed: number[] = [];
    store.subscribe(
      (s) => s.count,
      (count) => observed.push(count),
    );

    // Local change
    store.getState().setCount(5);
    expect(observed).toEqual([5]);

    // Remote change
    doc.transact(() => {
      doc.getMap("shared").set("count", 10);
    });
    await nextTick();

    expect(observed).toContain(10);
  });
});

// ---------------------------------------------------------------------------
// yjs + immer + devtools (triple stack)
// ---------------------------------------------------------------------------

describe("yjs + immer + devtools (triple stack)", () => {
  it("composes three middleware correctly", async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const disconnect = connectDocs(docA, docB);

    const storeA = createStore(
      devtools(
        immer(
          yjs("shared", (set) => ({
            items: [{ id: 1, text: "first", done: false }],
            toggle: (id: number) =>
              set((s) => {
                const item = s.items.find((i) => i.id === id);
                if (item) item.done = !item.done;
              }),
            add: (text: string) =>
              set((s) => {
                s.items.push({
                  id: s.items.length + 1,
                  text,
                  done: false,
                });
              }),
          })),
        ),
      ),
    );
    storeA.yjs.connect(docA);

    await nextTick();

    const storeB = createStore(
      devtools(
        immer(
          yjs("shared", (set) => ({
            items: [] as { id: number; text: string; done: boolean }[],
            toggle: (id: number) =>
              set((s) => {
                const item = s.items.find((i) => i.id === id);
                if (item) item.done = !item.done;
              }),
            add: (text: string) =>
              set((s) => {
                s.items.push({
                  id: s.items.length + 1,
                  text,
                  done: false,
                });
              }),
          })),
        ),
      ),
    );
    storeB.yjs.connect(docB);

    await nextTick();

    expect(storeB.getState().items).toHaveLength(1);

    storeA.getState().toggle(1);
    await nextTick();
    expect(storeB.getState().items[0].done).toBe(true);

    storeB.getState().add("second");
    await nextTick();
    expect(storeA.getState().items).toHaveLength(2);

    disconnect();
  });
});

// ---------------------------------------------------------------------------
// yjs + zundo (undo/redo)
// ---------------------------------------------------------------------------

describe("yjs + zundo (undo/redo)", () => {
  it("works with temporal wrapping yjs", () => {
    const doc = new Y.Doc();

    const store = createStore(
      temporal(
        yjs("shared", (set) => ({
          count: 0,
          increment: () => set((s) => ({ count: s.count + 1 })),
        })),
      ),
    );
    store.yjs.connect(doc);

    expect(store.getState().count).toBe(0);

    store.getState().increment();
    expect(store.getState().count).toBe(1);

    store.getState().increment();
    expect(store.getState().count).toBe(2);

    // Undo
    store.temporal.getState().undo();
    expect(store.getState().count).toBe(1);

    // Redo
    store.temporal.getState().redo();
    expect(store.getState().count).toBe(2);
  });

  it("undo restores Zustand state correctly", () => {
    const doc = new Y.Doc();

    const store = createStore(
      temporal(
        yjs("shared", (set) => ({
          count: 0,
          increment: () => set((s) => ({ count: s.count + 1 })),
        })),
      ),
    );
    store.yjs.connect(doc);

    store.getState().increment();
    store.getState().increment();
    expect(store.getState().count).toBe(2);

    store.temporal.getState().undo();
    expect(store.getState().count).toBe(1);

    store.temporal.getState().redo();
    expect(store.getState().count).toBe(2);
  });

  it("undo/redo with immer and yjs", () => {
    const doc = new Y.Doc();

    const store = createStore(
      temporal(
        immer(
          yjs("shared", (set) => ({
            count: 0,
            increment: () =>
              set((s) => {
                s.count += 1;
              }),
          })),
        ),
      ),
    );
    store.yjs.connect(doc);

    store.getState().increment();
    store.getState().increment();
    expect(store.getState().count).toBe(2);

    store.temporal.getState().undo();
    expect(store.getState().count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// yjs + persist (partial — persist doesn't make sense with Yjs in most cases,
// but it should not crash)
// ---------------------------------------------------------------------------

describe("yjs + persist", () => {
  it("does not crash when composed with persist", () => {
    const doc = new Y.Doc();

    // persist with a no-op storage to avoid actual persistence
    const store = createStore(
      persist(
        yjs("shared", (set) => ({
          count: 0,
          increment: () => set((s) => ({ count: s.count + 1 })),
        })),
        {
          name: "test-storage",
          storage: {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          },
        },
      ),
    );
    store.yjs.connect(doc);

    expect(store.getState().count).toBe(0);

    store.getState().increment();
    expect(store.getState().count).toBe(1);
    expect(doc.getMap("shared").get("count")).toBe(1);
  });
});
