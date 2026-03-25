# zustand-yjs

[Yjs](https://yjs.dev/) middleware for [Zustand](https://zustand.docs.pmnd.rs/). Sync any Zustand store with a `Y.Doc` for real-time collaboration.

```
npm install zustand-yjs yjs
```

## Quick Start

```ts
import * as Y from "yjs";
import { create } from "zustand";
import { yjs } from "zustand-yjs";

const useStore = create(
  yjs("shared", (set) => ({
    count: 0,
    increment: () => set((s) => ({ count: s.count + 1 })),
  })),
);

const doc = new Y.Doc();
useStore.yjs.connect(doc);
```

The store works locally before `connect()`. Once connected, local changes push to the `Y.Doc` and remote changes pull into the store. Connect the doc to any [Yjs provider](https://docs.yjs.dev/ecosystem/connection-provider) for multiplayer.

## Usage with a Provider

```ts
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { createYjsStore } from "zustand-yjs";

const store = createYjsStore("shared", (set) => ({
  todos: [] as { id: string; text: string; done: boolean }[],
  addTodo: (text: string) =>
    set((s) => ({
      todos: [...s.todos, { id: crypto.randomUUID(), text, done: false }],
    })),
  toggleTodo: (id: string) =>
    set((s) => ({
      todos: s.todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    })),
}));

function joinRoom(roomName: string) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider("wss://your-server.com", roomName, doc);
  store.yjs.connect(doc);

  return () => {
    store.yjs.disconnect();
    provider.disconnect();
  };
}
```

## API

### `yjs(mapName, stateCreator, options?)`

Zustand middleware. Wraps a state creator and adds a `.yjs` connection API to the store.

- `mapName` — Name for the `Y.Map` inside the doc (allows multiple stores per doc)
- `stateCreator` — Standard Zustand `(set, get, api) => state`
- `options` — See [Options](#options)

### `createYjsStore(mapName, stateCreator, options?)`

Shorthand for `createStore(yjs(...))` with proper typing. Use when you don't need React hooks.

### `store.yjs`

```ts
store.yjs.connect(doc);    // Start two-way sync
store.yjs.disconnect();    // Stop syncing
store.yjs.switchRoom(doc); // Disconnect + connect atomically

store.yjs.connected;       // boolean
store.yjs.yMap;            // Y.Map | null
store.yjs.doc;             // Y.Doc | null
```

## Options

```ts
yjs("shared", creator, {
  // Keys to exclude from sync (local-only). Supports dot-paths.
  exclude: ["localDraft", "ui.scrollPosition"],

  // Strings stored as plain values instead of Y.Text.
  // Simple names match at any depth; dot-paths match specifically.
  atomicStrings: ["id", "settings.apiKey"],

  // Match array items by key instead of position.
  // Prevents recreating every item when one is inserted/removed.
  arrayKeys: { todos: "id", "projects.tasks": "taskId" },

  // Schema migration
  version: 2,
  migrate: (state, oldVersion) => {
    if (oldVersion < 2) return { ...state, newField: "default" };
    return state;
  },

  // Callbacks
  onSyncStatusChange: (status) => {}, // "syncing" | "synced"
  onConnect: () => {},
  onDisconnect: () => {},
  onError: (error) => {},
});
```

### `exclude`

Keys that stay local-only and never touch Yjs. Supports dot-paths: `"ui.draft"` excludes `draft` inside `ui` while syncing the rest.

### `atomicStrings`

By default, strings become `Y.Text` for character-level collaborative editing. For UUIDs, tokens, or hashes, that's wasteful. Mark them atomic to store as plain strings (last-write-wins). Simple names like `"id"` match at any nesting depth.

### `arrayKeys`

Without this, inserting a todo at index 0 causes every subsequent item to be "changed" in Yjs. With `arrayKeys: { todos: "id" }`, items are matched by their `id` field — only the new item is inserted, existing items stay untouched.

### `version` / `migrate`

When a client with a newer `version` connects to a doc with an older version, `migrate` transforms the state. The migrated data is written back to Yjs so other clients don't re-migrate.

### `onSyncStatusChange`

Fires `"syncing"` when remote changes start being applied and `"synced"` when done.

### `onConnect` / `onDisconnect`

Called after `connect()` and `disconnect()` complete. Also fires on `switchRoom()`.

### `onError`

Called when an error occurs while applying remote changes. Without this, errors are silently caught to prevent them from bubbling into Yjs internals.

## Extensions

### Awareness (Presence)

Ephemeral per-client state (cursors, names, status) using the Yjs awareness protocol. Requires `y-protocols`.

```
npm install y-protocols
```

```ts
import { createAwareness } from "zustand-yjs";

const presence = createAwareness(provider.awareness, {
  name: "Anonymous",
  cursor: null as { x: number; y: number } | null,
});

presence.setLocal({ name: "Alice", cursor: { x: 10, y: 20 } });
presence.store.getState().peers; // Map<clientId, state>
presence.destroy();
```

### Collaborative Undo/Redo

Uses Yjs's `Y.UndoManager` to undo only **your own** changes, not your collaborators'. The store must be connected first.

```ts
import { createUndoManager } from "zustand-yjs";

const undo = createUndoManager(store);

undo.undo();
undo.redo();
undo.store.getState().canUndo; // reactive boolean for UI
undo.destroy();
```

## Middleware Composition

Works with other Zustand middleware:

```ts
// With immer
create(immer(yjs("shared", (set) => ({ ... }))));

// With devtools
create(devtools(yjs("shared", (set) => ({ ... }))));

// With zundo
create(temporal(yjs("shared", (set) => ({ ... }))));

// All three
create(devtools(immer(yjs("shared", (set) => ({ ... })))));
```

### `ORIGIN`

The `Symbol` used as the Yjs transaction origin. Exported so you can distinguish zustand-yjs transactions from your own:

```ts
import { ORIGIN } from "zustand-yjs";

doc.on("update", (update, origin) => {
  if (origin === ORIGIN) { /* came from zustand-yjs */ }
});
```

## How It Works

```
Local:   set() → diff against Y.Map → patch only changed keys → Yjs syncs to peers
Remote:  Yjs observeDeep → convert to plain JS → structural patch → setState
```

- **Echo prevention** — Local transactions are tagged with `ORIGIN`. The observer skips them.
- **Structural sharing** — Unchanged subtrees keep the same JS reference, so React's `===` checks work.
- **Incremental text diff** — `Y.Text` is patched with prefix/suffix diffing, not delete-all/reinsert.
- **Functions are never synced** — Actions stay local. Remote state merges preserve existing functions.

## Type Mapping

| JavaScript | Yjs | Notes |
|-----------|-----|-------|
| `object` | `Y.Map` | Recursive |
| `array` | `Y.Array` | Recursive, or key-based with `arrayKeys` |
| `string` | `Y.Text` | Character-level merging |
| `string` (atomic) | `string` | Last-write-wins |
| `number`, `boolean`, `null` | stored directly | |
| `Uint8Array` | `Uint8Array` | Binary, native |
| `function` | — | Stripped, never synced |

**Not supported:** `Date` (use ISO string), `Set`/`Map` (use arrays/objects), `BigInt`, `Symbol`, circular references.

## License

MIT
