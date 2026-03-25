/**
 * Comprehensive end-to-end tests against a real y-websocket server.
 *
 * Every test here runs two or more Zustand stores connected via WebSocket
 * to a real y-websocket server process — no mocks, no in-memory shortcuts.
 * This is the ultimate validation that the middleware works in production.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as Y from "yjs";
import { createStore } from "zustand";
import { immer } from "zustand/middleware/immer";
import WebSocket from "ws";
import { WebsocketProvider } from "y-websocket";
import * as http from "http";
import { yjs } from "../src/index.js";

import { wait } from "./helpers.js";

import { setupWSConnection } from "y-websocket/bin/utils";

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const PORT = 6321 + Math.floor(Math.random() * 1000);
let server: http.Server;
let wss: InstanceType<typeof WebSocket.Server>;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = http.createServer();
      wss = new WebSocket.Server({ server });
      wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
        setupWSConnection(ws, req);
      });
      server.listen(PORT, resolve);
    }),
);

afterAll(
  () =>
    new Promise<void>((resolve) => {
      wss.close();
      server.close(() => resolve());
    }),
);

function connect(doc: Y.Doc, room: string): WebsocketProvider {
  return new WebsocketProvider(`ws://localhost:${PORT}`, room, doc, {
    WebSocketPolyfill: WebSocket as any,
  });
}

let roomCounter = 0;
function room(): string {
  return `e2e-${Date.now()}-${roomCounter++}`;
}

/** Helper: create store + connect in one step. */
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

// ---------------------------------------------------------------------------
// 1. Immer + WebSocket (most common production combo)
// ---------------------------------------------------------------------------

describe("e2e: immer over WebSocket", () => {
  it("syncs immer mutations between two clients", async () => {
    const r = room();
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const pA = connect(docA, r);
    const pB = connect(docB, r);
    await wait(500);

    const storeA = createImmerConnectedStore(docA, "shared", (set) => ({
      todos: [{ id: 1, text: "Buy milk", done: false }],
      toggle: (id: number) =>
        set((s) => {
          const t = s.todos.find((x) => x.id === id);
          if (t) t.done = !t.done;
        }),
      add: (text: string) =>
        set((s) => {
          s.todos.push({ id: s.todos.length + 1, text, done: false });
        }),
    }));

    await wait(500);

    const storeB = createImmerConnectedStore(docB, "shared", (set) => ({
      todos: [] as { id: number; text: string; done: boolean }[],
      toggle: (id: number) =>
        set((s) => {
          const t = s.todos.find((x) => x.id === id);
          if (t) t.done = !t.done;
        }),
      add: (text: string) =>
        set((s) => {
          s.todos.push({ id: s.todos.length + 1, text, done: false });
        }),
    }));

    await wait(500);
    expect(storeB.getState().todos).toHaveLength(1);
    expect(storeB.getState().todos[0].text).toBe("Buy milk");

    // A toggles via immer mutation
    storeA.getState().toggle(1);
    await wait(500);
    expect(storeB.getState().todos[0].done).toBe(true);

    // B adds via immer push
    storeB.getState().add("Walk dog");
    await wait(500);
    expect(storeA.getState().todos).toHaveLength(2);
    expect(storeA.getState().todos[1].text).toBe("Walk dog");

    // Both mutate concurrently
    storeA.getState().add("From A");
    storeB.getState().add("From B");
    await wait(1000);

    const a = storeA.getState().todos;
    const b = storeB.getState().todos;
    expect(a.length).toBe(b.length);
    expect(a.length).toBeGreaterThanOrEqual(4);

    pA.destroy();
    pB.destroy();
  });
});

// ---------------------------------------------------------------------------
// 2. disconnect() over WebSocket
// ---------------------------------------------------------------------------

describe("e2e: disconnect over WebSocket", () => {
  it("stops receiving remote updates after disconnect()", async () => {
    const r = room();
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const pA = connect(docA, r);
    const pB = connect(docB, r);
    await wait(500);

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      count: 0,
      set: (n: number) => set({ count: n }),
    }));

    await wait(500);

    const storeB = createConnectedStore(docB, "shared", (set) => ({
      count: 0,
      set: (n: number) => set({ count: n }),
    }));

    await wait(500);
    expect(storeB.getState().count).toBe(0);

    // Disconnect B's Yjs binding
    storeB.yjs.disconnect();

    // A updates
    storeA.getState().set(999);
    await wait(500);

    // B should NOT have received the update
    expect(storeB.getState().count).toBe(0);
    expect(storeA.getState().count).toBe(999);

    pA.destroy();
    pB.destroy();
  });
});

// ---------------------------------------------------------------------------
// 3. Atomic strings over WebSocket
// ---------------------------------------------------------------------------

describe("e2e: atomic strings over WebSocket", () => {
  it("syncs atomic strings as plain values between peers", async () => {
    const r = room();
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const pA = connect(docA, r);
    const pB = connect(docB, r);
    await wait(500);

    const opts = { atomicStrings: ["id", "avatar"] };

    const storeA = createConnectedStore(
      docA,
      "shared",
      (set) => ({
        id: "uuid-abc-123",
        avatar: "data:image/png;base64,longstringhere",
        name: "Alice",
        setId: (id: string) => set({ id }),
        setName: (name: string) => set({ name }),
      }),
      opts,
    );

    await wait(500);

    const storeB = createConnectedStore(
      docB,
      "shared",
      () => ({
        id: "",
        avatar: "",
        name: "",
      }),
      opts,
    );

    await wait(500);

    expect(storeB.getState().id).toBe("uuid-abc-123");
    expect(storeB.getState().avatar).toBe("data:image/png;base64,longstringhere");
    expect(storeB.getState().name).toBe("Alice");

    // Update atomic string
    storeA.getState().setId("uuid-xyz-789");
    await wait(500);
    expect(storeB.getState().id).toBe("uuid-xyz-789");

    // Update non-atomic string (Y.Text)
    storeA.getState().setName("Bob");
    await wait(500);
    expect(storeB.getState().name).toBe("Bob");

    // Verify Yjs types are correct
    const mapA = docA.getMap("shared");
    expect(typeof mapA.get("id")).toBe("string"); // atomic = plain string
    expect(mapA.get("name")).toBeInstanceOf(Y.Text); // non-atomic = Y.Text

    pA.destroy();
    pB.destroy();
  });
});

// ---------------------------------------------------------------------------
// 4. Sync status callback over WebSocket
// ---------------------------------------------------------------------------

describe("e2e: sync status callback over WebSocket", () => {
  it("fires syncing/synced on remote updates", async () => {
    const r = room();
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const pA = connect(docA, r);
    const pB = connect(docB, r);
    await wait(500);

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      count: 0,
      set: (n: number) => set({ count: n }),
    }));

    await wait(500);

    const statuses: string[] = [];

    createConnectedStore(
      docB,
      "shared",
      () => ({ count: 0 }),
      { onSyncStatusChange: (s) => statuses.push(s) },
    );

    await wait(500);

    // Clear any statuses from initial sync
    statuses.length = 0;

    storeA.getState().set(42);
    await wait(500);

    expect(statuses).toContain("syncing");
    expect(statuses).toContain("synced");
    // Last status should be synced
    expect(statuses[statuses.length - 1]).toBe("synced");

    pA.destroy();
    pB.destroy();
  });
});

// ---------------------------------------------------------------------------
// 5. Nested object field mutations (ongoing edits, not just initial sync)
// ---------------------------------------------------------------------------

describe("e2e: nested mutations over WebSocket", () => {
  it("syncs incremental nested field changes", async () => {
    const r = room();
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const pA = connect(docA, r);
    const pB = connect(docB, r);
    await wait(500);

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      user: {
        profile: { name: "Alice", age: 30 },
        settings: { theme: "light", lang: "en" },
      },
      setName: (name: string) =>
        set((s) => ({
          user: { ...s.user, profile: { ...s.user.profile, name } },
        })),
      setTheme: (theme: string) =>
        set((s) => ({
          user: { ...s.user, settings: { ...s.user.settings, theme } },
        })),
    }));

    await wait(500);

    const storeB = createConnectedStore(docB, "shared", (set) => ({
      user: {
        profile: { name: "", age: 0 },
        settings: { theme: "", lang: "" },
      },
      setName: (name: string) =>
        set((s) => ({
          user: { ...s.user, profile: { ...s.user.profile, name } },
        })),
      setTheme: (theme: string) =>
        set((s) => ({
          user: { ...s.user, settings: { ...s.user.settings, theme } },
        })),
    }));

    await wait(500);

    // Initial sync
    expect(storeB.getState().user.profile.name).toBe("Alice");
    expect(storeB.getState().user.settings.theme).toBe("light");

    // A changes just the name
    storeA.getState().setName("Bob");
    await wait(500);
    expect(storeB.getState().user.profile.name).toBe("Bob");
    // settings unchanged
    expect(storeB.getState().user.settings.theme).toBe("light");

    // B changes just the theme
    storeB.getState().setTheme("dark");
    await wait(500);
    expect(storeA.getState().user.settings.theme).toBe("dark");
    // name still Bob
    expect(storeA.getState().user.profile.name).toBe("Bob");

    // Rapid nested changes from both sides
    storeA.getState().setName("Charlie");
    storeB.getState().setTheme("auto");
    await wait(1000);

    expect(storeA.getState().user.profile.name).toBe("Charlie");
    expect(storeB.getState().user.profile.name).toBe("Charlie");
    expect(storeA.getState().user.settings.theme).toBe("auto");
    expect(storeB.getState().user.settings.theme).toBe("auto");

    pA.destroy();
    pB.destroy();
  });
});

// ---------------------------------------------------------------------------
// 6. Array removal over WebSocket
// ---------------------------------------------------------------------------

describe("e2e: array removal over WebSocket", () => {
  it("syncs item removal between peers", async () => {
    const r = room();
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const pA = connect(docA, r);
    const pB = connect(docB, r);
    await wait(500);

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      items: ["a", "b", "c", "d", "e"],
      remove: (idx: number) =>
        set((s) => ({ items: s.items.filter((_, i) => i !== idx) })),
      removeMultiple: (indices: number[]) =>
        set((s) => ({
          items: s.items.filter((_, i) => !indices.includes(i)),
        })),
    }));

    await wait(500);

    const storeB = createConnectedStore(docB, "shared", () => ({
      items: [] as string[],
    }));

    await wait(500);
    expect(storeB.getState().items).toEqual(["a", "b", "c", "d", "e"]);

    // Remove single item
    storeA.getState().remove(2); // remove "c"
    await wait(500);
    expect(storeB.getState().items).toEqual(["a", "b", "d", "e"]);

    // Remove multiple items at once (the bug from #61)
    // Current array is ["a", "b", "d", "e"], so [0, 2] removes "a" and "d"
    storeA.getState().removeMultiple([0, 2]);
    await wait(500);
    expect(storeA.getState().items).toEqual(["b", "e"]);
    expect(storeB.getState().items).toEqual(["b", "e"]);

    pA.destroy();
    pB.destroy();
  });
});

// ---------------------------------------------------------------------------
// 7. Multiple stores on the same doc
// ---------------------------------------------------------------------------

describe("e2e: multiple stores on same doc", () => {
  it("isolates stores by map name on the same Y.Doc", async () => {
    const r = room();
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const pA = connect(docA, r);
    const pB = connect(docB, r);
    await wait(500);

    // Two stores on docA, different map names
    const counterA = createConnectedStore(docA, "counter", (set) => ({
      count: 0,
      inc: () => set((s) => ({ count: s.count + 1 })),
    }));

    const chatA = createConnectedStore(docA, "chat", (set) => ({
      messages: [] as string[],
      send: (msg: string) =>
        set((s) => ({ messages: [...s.messages, msg] })),
    }));

    await wait(500);

    // Two stores on docB, same map names
    const counterB = createConnectedStore(docB, "counter", (set) => ({
      count: 0,
      inc: () => set((s) => ({ count: s.count + 1 })),
    }));

    const chatB = createConnectedStore(docB, "chat", (set) => ({
      messages: [] as string[],
      send: (msg: string) =>
        set((s) => ({ messages: [...s.messages, msg] })),
    }));

    await wait(500);

    // Counter updates don't leak into chat
    counterA.getState().inc();
    chatA.getState().send("hello");
    await wait(500);

    expect(counterB.getState().count).toBe(1);
    expect(chatB.getState().messages).toEqual(["hello"]);

    // Chat updates don't leak into counter
    chatB.getState().send("world");
    await wait(500);

    expect(counterA.getState().count).toBe(1);
    expect(chatA.getState().messages).toEqual(["hello", "world"]);

    pA.destroy();
    pB.destroy();
  });
});

// ---------------------------------------------------------------------------
// 8. Store created before provider connects
// ---------------------------------------------------------------------------

describe("e2e: store before provider", () => {
  it("syncs state when store is created before provider connects", async () => {
    const r = room();
    const docA = new Y.Doc();

    // Create store and connect to doc BEFORE connecting to the server
    const storeA = createConnectedStore(docA, "shared", (set) => ({
      count: 42,
      name: "pre-connected",
      set: (count: number) => set({ count }),
    }));

    // Now connect to server
    const pA = connect(docA, r);
    await wait(500);

    // Second client joins
    const docB = new Y.Doc();
    const pB = connect(docB, r);
    await wait(500);

    const storeB = createConnectedStore(docB, "shared", () => ({
      count: 0,
      name: "",
    }));

    await wait(500);

    // B should have A's state
    expect(storeB.getState().count).toBe(42);
    expect(storeB.getState().name).toBe("pre-connected");

    // Updates should still flow
    storeA.getState().set(100);
    await wait(500);
    expect(storeB.getState().count).toBe(100);

    pA.destroy();
    pB.destroy();
  });
});

// ---------------------------------------------------------------------------
// 9. Wholesale state replacement
// ---------------------------------------------------------------------------

describe("e2e: wholesale state replacement", () => {
  it("handles replacing entire state object at once", async () => {
    const r = room();
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const pA = connect(docA, r);
    const pB = connect(docB, r);
    await wait(500);

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      data: { x: 1, y: 2, z: 3 },
      replaceAll: (data: Record<string, number>) => set({ data }),
    }));

    await wait(500);

    const storeB = createConnectedStore(docB, "shared", () => ({
      data: {} as Record<string, number>,
    }));

    await wait(500);
    expect(storeB.getState().data).toEqual({ x: 1, y: 2, z: 3 });

    // Replace with completely different keys
    storeA.getState().replaceAll({ a: 10, b: 20 });
    await wait(500);

    expect(storeB.getState().data).toEqual({ a: 10, b: 20 });
    // Old keys should be gone
    expect((storeB.getState().data as any).x).toBeUndefined();

    pA.destroy();
    pB.destroy();
  });
});

// ---------------------------------------------------------------------------
// 10. Boolean/null value changes over WebSocket
// ---------------------------------------------------------------------------

describe("e2e: primitive edge cases over WebSocket", () => {
  it("syncs boolean and null transitions", async () => {
    const r = room();
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const pA = connect(docA, r);
    const pB = connect(docB, r);
    await wait(500);

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      flag: true,
      value: "hello" as string | null,
      setFlag: (f: boolean) => set({ flag: f }),
      setValue: (v: string | null) => set({ value: v }),
    }));

    await wait(500);

    const storeB = createConnectedStore(docB, "shared", () => ({
      flag: false,
      value: null as string | null,
    }));

    await wait(500);
    expect(storeB.getState().flag).toBe(true);
    expect(storeB.getState().value).toBe("hello");

    // Toggle boolean
    storeA.getState().setFlag(false);
    await wait(500);
    expect(storeB.getState().flag).toBe(false);

    // Set to null
    storeA.getState().setValue(null);
    await wait(500);
    expect(storeB.getState().value).toBeNull();

    // Back to string
    storeA.getState().setValue("back");
    await wait(500);
    expect(storeB.getState().value).toBe("back");

    pA.destroy();
    pB.destroy();
  });
});

// ---------------------------------------------------------------------------
// 11. Rapid fire on nested fields across peers
// ---------------------------------------------------------------------------

describe("e2e: rapid nested field updates", () => {
  it("converges after rapid nested mutations from both sides", async () => {
    const r = room();
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const pA = connect(docA, r);
    const pB = connect(docB, r);
    await wait(500);

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      x: 0,
      y: 0,
      z: 0,
      setX: (v: number) => set({ x: v }),
      setY: (v: number) => set({ y: v }),
      setZ: (v: number) => set({ z: v }),
    }));

    await wait(500);

    const storeB = createConnectedStore(docB, "shared", (set) => ({
      x: 0,
      y: 0,
      z: 0,
      setX: (v: number) => set({ x: v }),
      setY: (v: number) => set({ y: v }),
      setZ: (v: number) => set({ z: v }),
    }));

    await wait(500);

    // A rapidly updates x, B rapidly updates y
    for (let i = 1; i <= 20; i++) {
      storeA.getState().setX(i);
      storeB.getState().setY(i * 10);
    }

    await wait(1500);

    // Both should converge
    expect(storeA.getState().x).toBe(20);
    expect(storeB.getState().x).toBe(20);
    expect(storeA.getState().y).toBe(200);
    expect(storeB.getState().y).toBe(200);

    pA.destroy();
    pB.destroy();
  });
});
