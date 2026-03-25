/**
 * Stress / adversarial integration tests — validates the middleware under
 * challenging real-world scenarios against a live y-websocket server.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as Y from "yjs";
import { createStore } from "zustand";
import WebSocket from "ws";
import { WebsocketProvider } from "y-websocket";
import * as http from "http";
import { yjs } from "../src/index.js";

import { wait } from "./helpers.js";

// y-websocket's server utility
import { setupWSConnection } from "y-websocket/bin/utils";

const PORT = 5321 + Math.floor(Math.random() * 1000);

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

      server.listen(PORT, () => {
        resolve();
      });
    }),
);

afterAll(
  () =>
    new Promise<void>((resolve) => {
      wss.close();
      server.close(() => resolve());
    }),
);

function createProvider(doc: Y.Doc, room: string): WebsocketProvider {
  return new WebsocketProvider(`ws://localhost:${PORT}`, room, doc, {
    WebSocketPolyfill: WebSocket as any,
  });
}

/** Helper: create store + connect in one step. */
function createConnectedStore<T>(
  doc: Y.Doc,
  mapName: string,
  creator: Parameters<typeof yjs<T>>[1],
) {
  const store = createStore(yjs<T>(mapName, creator));
  store.yjs.connect(doc);
  return store;
}

describe("yjs middleware — stress tests", () => {
  it("late joiner receives full state from existing client", async () => {
    const room = `stress-late-joiner-${Date.now()}`;
    const docA = new Y.Doc();

    const providerA = createProvider(docA, room);
    await wait(500);

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      title: "initial title",
      count: 42,
      tags: ["alpha", "beta"],
      setTitle: (t: string) => set({ title: t }),
      setCount: (c: number) => set({ count: c }),
    }));

    // Client A makes several mutations before B joins.
    storeA.getState().setTitle("updated title");
    storeA.getState().setCount(100);
    await wait(500);

    // Client B joins 1 second after A created state.
    await wait(500);

    const docB = new Y.Doc();
    const providerB = createProvider(docB, room);
    await wait(500);

    const storeB = createConnectedStore(docB, "shared", (set) => ({
      title: "",
      count: 0,
      tags: [] as string[],
      setTitle: (t: string) => set({ title: t }),
      setCount: (c: number) => set({ count: c }),
    }));

    await wait(500);

    expect(storeB.getState().title).toBe("updated title");
    expect(storeB.getState().count).toBe(100);
    expect(storeB.getState().tags).toEqual(["alpha", "beta"]);

    providerA.destroy();
    providerB.destroy();
  });

  it("reconnecting client catches up on missed updates", async () => {
    const room = `stress-reconnect-${Date.now()}`;
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const providerA = createProvider(docA, room);
    const providerB = createProvider(docB, room);
    await wait(500);

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      value: "start",
      setValue: (v: string) => set({ value: v }),
    }));

    await wait(500);

    const storeB = createConnectedStore(docB, "shared", (set) => ({
      value: "",
      setValue: (v: string) => set({ value: v }),
    }));

    await wait(500);
    expect(storeB.getState().value).toBe("start");

    // Disconnect B.
    providerB.destroy();
    await wait(500);

    // A writes while B is disconnected.
    storeA.getState().setValue("while-b-offline-1");
    await wait(200);
    storeA.getState().setValue("while-b-offline-2");
    await wait(200);
    storeA.getState().setValue("final-value");
    await wait(500);

    // B should still have old value.
    expect(storeB.getState().value).toBe("start");

    // Reconnect B with a fresh provider on the same doc.
    const providerB2 = createProvider(docB, room);
    await wait(500);

    expect(storeB.getState().value).toBe("final-value");

    providerA.destroy();
    providerB2.destroy();
  });

  it("rapid concurrent edits from both clients converge", async () => {
    const room = `stress-rapid-${Date.now()}`;
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const providerA = createProvider(docA, room);
    const providerB = createProvider(docB, room);
    await wait(500);

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      items: [] as string[],
      addItem: (item: string) =>
        set((s) => ({ items: [...s.items, item] })),
    }));

    await wait(500);

    const storeB = createConnectedStore(docB, "shared", (set) => ({
      items: [] as string[],
      addItem: (item: string) =>
        set((s) => ({ items: [...s.items, item] })),
    }));

    await wait(500);

    // Both clients fire 20 updates each simultaneously.
    for (let i = 0; i < 20; i++) {
      storeA.getState().addItem(`a-${i}`);
      storeB.getState().addItem(`b-${i}`);
    }

    await wait(1000);

    const itemsA = storeA.getState().items;
    const itemsB = storeB.getState().items;

    // Both should have all 40 items.
    expect(itemsA).toHaveLength(40);
    expect(itemsB).toHaveLength(40);
    expect([...itemsA].sort()).toEqual([...itemsB].sort());

    // Verify all expected items are present.
    for (let i = 0; i < 20; i++) {
      expect(itemsA).toContain(`a-${i}`);
      expect(itemsA).toContain(`b-${i}`);
    }

    providerA.destroy();
    providerB.destroy();
  });

  it("syncs large deeply nested state (3+ levels)", async () => {
    const room = `stress-nested-${Date.now()}`;
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const providerA = createProvider(docA, room);
    const providerB = createProvider(docB, room);
    await wait(500);

    interface NestedState {
      config: {
        database: {
          connections: {
            primary: { host: string; port: number; options: { ssl: boolean; timeout: number } };
            replicas: Array<{ host: string; port: number }>;
          };
          migrations: { version: number; applied: string[] };
        };
        features: { flags: Record<string, boolean> };
      };
      setConfig: (config: NestedState["config"]) => void;
    }

    const deepState: NestedState["config"] = {
      database: {
        connections: {
          primary: { host: "db.example.com", port: 5432, options: { ssl: true, timeout: 30 } },
          replicas: [
            { host: "replica1.example.com", port: 5432 },
            { host: "replica2.example.com", port: 5432 },
          ],
        },
        migrations: { version: 42, applied: ["001_init", "002_users", "003_posts"] },
      },
      features: { flags: { darkMode: true, beta: false, experimental: true } },
    };

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      config: deepState,
      setConfig: (config: NestedState["config"]) => set({ config }),
    }));

    await wait(500);

    const storeB = createConnectedStore(docB, "shared", (set) => ({
      config: null as NestedState["config"] | null,
      setConfig: (config: NestedState["config"]) => set({ config }),
    }));

    await wait(500);

    const receivedConfig = storeB.getState().config as NestedState["config"];
    expect(receivedConfig).toBeTruthy();
    expect(receivedConfig.database.connections.primary.host).toBe("db.example.com");
    expect(receivedConfig.database.connections.primary.options.ssl).toBe(true);
    expect(receivedConfig.database.connections.primary.options.timeout).toBe(30);
    expect(receivedConfig.database.connections.replicas).toHaveLength(2);
    expect(receivedConfig.database.connections.replicas[1].host).toBe("replica2.example.com");
    expect(receivedConfig.database.migrations.applied).toEqual(["001_init", "002_users", "003_posts"]);
    expect(receivedConfig.features.flags.darkMode).toBe(true);
    expect(receivedConfig.features.flags.beta).toBe(false);

    providerA.destroy();
    providerB.destroy();
  });

  it("handles concurrent modifications to an array of objects", async () => {
    const room = `stress-array-objects-${Date.now()}`;
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const providerA = createProvider(docA, room);
    const providerB = createProvider(docB, room);
    await wait(500);

    interface TodoItem {
      id: string;
      text: string;
      done: boolean;
    }

    interface TodoState {
      todos: TodoItem[];
      addTodo: (todo: TodoItem) => void;
      setTodos: (todos: TodoItem[]) => void;
    }

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      todos: [
        { id: "1", text: "first", done: false },
        { id: "2", text: "second", done: false },
      ] as TodoItem[],
      addTodo: (todo: TodoItem) =>
        set((s: TodoState) => ({ todos: [...s.todos, todo] })),
      setTodos: (todos: TodoItem[]) => set({ todos }),
    }));

    await wait(500);

    const storeB = createConnectedStore(docB, "shared", (set) => ({
      todos: [] as TodoItem[],
      addTodo: (todo: TodoItem) =>
        set((s: TodoState) => ({ todos: [...s.todos, todo] })),
      setTodos: (todos: TodoItem[]) => set({ todos }),
    }));

    await wait(500);

    expect(storeB.getState().todos).toHaveLength(2);

    // Both peers add items concurrently.
    storeA.getState().addTodo({ id: "3", text: "from A", done: false });
    storeB.getState().addTodo({ id: "4", text: "from B", done: true });

    await wait(1000);

    const todosA = storeA.getState().todos;
    const todosB = storeB.getState().todos;

    expect(todosA).toHaveLength(4);
    expect(todosB).toHaveLength(4);

    const idsA = todosA.map((t: TodoItem) => t.id).sort();
    const idsB = todosB.map((t: TodoItem) => t.id).sort();
    expect(idsA).toEqual(idsB);
    expect(idsA).toEqual(["1", "2", "3", "4"]);

    providerA.destroy();
    providerB.destroy();
  });

  it("propagates key deletion between peers", async () => {
    const room = `stress-deletion-${Date.now()}`;
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const providerA = createProvider(docA, room);
    const providerB = createProvider(docB, room);
    await wait(500);

    interface DeletionState {
      alpha: string;
      beta: string | undefined;
      gamma: number;
      setFields: (fields: Partial<DeletionState>) => void;
    }

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      alpha: "hello",
      beta: "world",
      gamma: 99,
      setFields: (fields: Partial<DeletionState>) => set(fields),
    }));

    await wait(500);

    const storeB = createConnectedStore(docB, "shared", (set) => ({
      alpha: "",
      beta: "" as string | undefined,
      gamma: 0,
      setFields: (fields: Partial<DeletionState>) => set(fields),
    }));

    await wait(500);

    expect(storeB.getState().beta).toBe("world");

    // A deletes the beta key by setting it to undefined.
    storeA.getState().setFields({ beta: undefined });
    await wait(500);

    expect(storeA.getState().beta).toBeUndefined();
    expect(storeB.getState().beta).toBeUndefined();

    // Verify other keys are unaffected.
    expect(storeB.getState().alpha).toBe("hello");
    expect(storeB.getState().gamma).toBe(99);

    providerA.destroy();
    providerB.destroy();
  });

  it("handles type changes across syncs (string -> number -> object -> array)", async () => {
    const room = `stress-typechange-${Date.now()}`;
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const providerA = createProvider(docA, room);
    const providerB = createProvider(docB, room);
    await wait(500);

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      value: "hello" as unknown,
      setValue: (v: unknown) => set({ value: v }),
    }));

    await wait(500);

    const storeB = createConnectedStore(docB, "shared", (set) => ({
      value: null as unknown,
      setValue: (v: unknown) => set({ value: v }),
    }));

    await wait(500);

    expect(storeB.getState().value).toBe("hello");

    // Change to number.
    storeA.getState().setValue(42);
    await wait(500);
    expect(storeB.getState().value).toBe(42);

    // Change to object.
    storeA.getState().setValue({ nested: { key: "val" }, num: 7 });
    await wait(500);
    const objB = storeB.getState().value as Record<string, unknown>;
    expect(objB).toBeTruthy();
    expect((objB.nested as Record<string, unknown>).key).toBe("val");
    expect(objB.num).toBe(7);

    // Change to array.
    storeA.getState().setValue([1, "two", { three: 3 }]);
    await wait(500);
    const arrB = storeB.getState().value as unknown[];
    expect(arrB).toHaveLength(3);
    expect(arrB[0]).toBe(1);
    expect(arrB[1]).toBe("two");
    expect((arrB[2] as Record<string, unknown>).three).toBe(3);

    providerA.destroy();
    providerB.destroy();
  });

  it("propagates changes across three peers", async () => {
    const room = `stress-three-peers-${Date.now()}`;
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const docC = new Y.Doc();

    const providerA = createProvider(docA, room);
    const providerB = createProvider(docB, room);
    const providerC = createProvider(docC, room);
    await wait(500);

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      messages: [] as string[],
      addMessage: (msg: string) =>
        set((s) => ({ messages: [...s.messages, msg] })),
    }));

    await wait(500);

    const storeB = createConnectedStore(docB, "shared", (set) => ({
      messages: [] as string[],
      addMessage: (msg: string) =>
        set((s) => ({ messages: [...s.messages, msg] })),
    }));

    const storeC = createConnectedStore(docC, "shared", (set) => ({
      messages: [] as string[],
      addMessage: (msg: string) =>
        set((s) => ({ messages: [...s.messages, msg] })),
    }));

    await wait(500);

    // Each peer adds a message.
    storeA.getState().addMessage("from-A");
    storeB.getState().addMessage("from-B");
    storeC.getState().addMessage("from-C");

    await wait(1000);

    const msgsA = storeA.getState().messages;
    const msgsB = storeB.getState().messages;
    const msgsC = storeC.getState().messages;

    expect(msgsA).toHaveLength(3);
    expect(msgsB).toHaveLength(3);
    expect(msgsC).toHaveLength(3);

    const sorted = [...msgsA].sort();
    expect([...msgsB].sort()).toEqual(sorted);
    expect([...msgsC].sort()).toEqual(sorted);
    expect(sorted).toEqual(["from-A", "from-B", "from-C"]);

    // Now A updates, should propagate to B and C.
    storeA.getState().addMessage("second-from-A");
    await wait(500);

    expect(storeB.getState().messages).toContain("second-from-A");
    expect(storeC.getState().messages).toContain("second-from-A");
    expect(storeA.getState().messages).toHaveLength(4);
    expect(storeB.getState().messages).toHaveLength(4);
    expect(storeC.getState().messages).toHaveLength(4);

    providerA.destroy();
    providerB.destroy();
    providerC.destroy();
  });
});
