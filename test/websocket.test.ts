/**
 * WebSocket integration tests — validates the middleware works with a
 * real y-websocket server, proving end-to-end collaboration over the
 * network.
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

const PORT = 4321 + Math.floor(Math.random() * 1000);

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

describe("yjs middleware — y-websocket integration", () => {
  it("syncs state between two clients via WebSocket server", async () => {
    const room = `test-${Date.now()}-1`;
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const providerA = createProvider(docA, room);
    const providerB = createProvider(docB, room);

    // Wait for both providers to connect.
    await wait(500);

    const storeA = createConnectedStore(docA, "shared", (set) => ({
      message: "hello from A",
      count: 0,
      setMessage: (msg: string) => set({ message: msg }),
      increment: () => set((s) => ({ count: s.count + 1 })),
    }));

    // Give time for initial sync.
    await wait(500);

    const storeB = createConnectedStore(docB, "shared", (set) => ({
      message: "",
      count: 0,
      setMessage: (msg: string) => set({ message: msg }),
      increment: () => set((s) => ({ count: s.count + 1 })),
    }));

    // Wait for sync.
    await wait(500);

    expect(storeB.getState().message).toBe("hello from A");

    // A sends a message.
    storeA.getState().setMessage("updated by A");
    await wait(500);

    expect(storeB.getState().message).toBe("updated by A");

    // B increments.
    storeB.getState().increment();
    await wait(500);

    expect(storeA.getState().count).toBe(1);
    expect(storeB.getState().count).toBe(1);

    // Clean up.
    providerA.destroy();
    providerB.destroy();
  });

  it("handles concurrent updates from multiple clients", async () => {
    const room = `test-${Date.now()}-2`;
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

    // Both add items concurrently.
    storeA.getState().addItem("from-A");
    storeB.getState().addItem("from-B");

    await wait(1000);

    // Both should have both items (order may vary due to CRDT).
    const itemsA = storeA.getState().items;
    const itemsB = storeB.getState().items;

    expect(itemsA).toHaveLength(2);
    expect(itemsB).toHaveLength(2);
    expect([...itemsA].sort()).toEqual([...itemsB].sort());
    expect([...itemsA].sort()).toEqual(["from-A", "from-B"]);

    providerA.destroy();
    providerB.destroy();
  });
});
