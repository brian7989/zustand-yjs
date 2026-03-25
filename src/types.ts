/**
 * Public types and constants for yjs-zustand.
 */

import type * as Y from "yjs";
import type { StoreApi, StoreMutatorIdentifier } from "zustand";

// ---------------------------------------------------------------------------
// Utility types
// ---------------------------------------------------------------------------

/** Merge U into T, overwriting conflicting keys. */
type Write<T, U> = Omit<T, keyof U> & U;

// ---------------------------------------------------------------------------
// Core middleware options
// ---------------------------------------------------------------------------

export interface YjsOptions<T = Record<string, unknown>> {
  /**
   * Keys to exclude from Yjs sync. These keys remain local-only in the
   * Zustand store and are never written to or read from the Y.Doc.
   * Useful for local UI state (drafts, selections, scroll position).
   *
   * Supports dot-paths for nested keys: `"ui.draft"` excludes `draft`
   * inside `ui` while still syncing the rest of `ui`.
   *
   * @example
   * ```ts
   * yjs("shared", creator, { exclude: ["localDraft", "ui.draft"] })
   * ```
   */
  exclude?: Array<(keyof T & string) | (string & {})>;

  /**
   * Keys whose string values should be stored as plain strings in Yjs
   * rather than as Y.Text. Useful for UUIDs, base64 data, and other
   * values that don't benefit from character-level CRDT merging.
   *
   * Simple names (no dots) match at any nesting level. Dot-paths like
   * `"settings.theme"` match only at that specific path.
   */
  atomicStrings?: Array<(keyof T & string) | (string & {})>;

  /**
   * Schema version number. Stored in the Y.Map under a special key.
   * When a client with a newer version connects to a doc with an older
   * version, the `migrate` callback is invoked.
   */
  version?: number;

  /**
   * Called when the Y.Map's schema version is older than `version`.
   * Receives the current state from the Y.Map and the old version number.
   * Return the migrated state.
   *
   * @example
   * ```ts
   * yjs("shared", creator, {
   *   version: 2,
   *   migrate: (state, oldVersion) => {
   *     if (oldVersion < 2) return { ...state, newField: "default" };
   *     return state;
   *   },
   * })
   * ```
   */
  migrate?: (state: PlainObject, oldVersion: number) => PlainObject;

  /**
   * Called when the middleware begins and finishes synchronizing remote
   * changes into the Zustand store.
   *
   * - `"syncing"` – remote update received, about to apply
   * - `"synced"`  – store is up-to-date with the Y.Doc
   */
  onSyncStatusChange?: (status: SyncStatus) => void;

  /** Called after successfully connecting to a Y.Doc. */
  onConnect?: () => void;

  /** Called after disconnecting from a Y.Doc. */
  onDisconnect?: () => void;

  /**
   * Called when an error occurs while applying remote Yjs changes.
   * If not provided, errors are silently swallowed to prevent them
   * from bubbling into Yjs internals.
   */
  onError?: (error: unknown) => void;

  /**
   * Map of array paths to their identity key field. When specified,
   * array items are matched by key instead of by position, producing
   * more efficient Yjs operations for insertions and deletions.
   *
   * Without this, inserting an item at position 0 causes every
   * subsequent item to be "changed" and rewritten. With arrayKeys,
   * only the new item is inserted — existing items are patched in place.
   *
   * @example
   * ```ts
   * yjs("shared", creator, {
   *   arrayKeys: {
   *     todos: "id",
   *     "projects.tasks": "taskId",
   *   },
   * })
   * ```
   */
  arrayKeys?: Record<string, string>;
}

export type SyncStatus = "syncing" | "synced";

// ---------------------------------------------------------------------------
// Connection API — exposed on the store as store.yjs
// ---------------------------------------------------------------------------

/**
 * The connection API attached to the store as `store.yjs`.
 * Manages the lifecycle of the Yjs binding.
 */
export interface YjsConnection {
  /** Connect to a Y.Doc, starting two-way sync. */
  connect: (doc: Y.Doc) => void;
  /** Disconnect from the current Y.Doc, stopping sync. */
  disconnect: () => void;
  /** Disconnect from current doc and connect to a new one. */
  switchRoom: (doc: Y.Doc) => void;
  /** The Y.Map backing this store's synced state. Null when disconnected. */
  readonly yMap: Y.Map<unknown> | null;
  /** The Y.Doc this store is connected to. Null when disconnected. */
  readonly doc: Y.Doc | null;
  /** Whether the store is currently connected to a Y.Doc. */
  readonly connected: boolean;
}

// ---------------------------------------------------------------------------
// Zustand mutator declaration — makes store.yjs typed automatically
// ---------------------------------------------------------------------------

declare module "zustand/vanilla" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface StoreMutators<S, A> {
    "yjs-zustand": Write<S, { yjs: YjsConnection }>;
  }
}

// ---------------------------------------------------------------------------
// Middleware function type
// ---------------------------------------------------------------------------

/**
 * Type for the yjs middleware function. Properly threads mutator types
 * so that store.yjs is typed when composed with other middleware.
 */
export type Yjs = <
  T,
  Mps extends [StoreMutatorIdentifier, unknown][] = [],
  Mcs extends [StoreMutatorIdentifier, unknown][] = [],
>(
  mapName: string,
  creator: import("zustand").StateCreator<T, [...Mps, ["yjs-zustand", never]], Mcs>,
  options?: YjsOptions<T>,
) => import("zustand").StateCreator<T, Mps, [["yjs-zustand", never], ...Mcs]>;

// ---------------------------------------------------------------------------
// Store extensions — convenience types
// ---------------------------------------------------------------------------

/** A Zustand StoreApi with the yjs connection API. */
export type YjsStoreApi<T> = StoreApi<T> & { yjs: YjsConnection };

// ---------------------------------------------------------------------------
// Awareness types
// ---------------------------------------------------------------------------

/** State shape returned by the awareness store. */
export interface AwarenessState<TLocal extends PlainObject> {
  /** Map of all connected peers' awareness states, keyed by client ID. */
  peers: Map<number, TLocal>;
  /** Your local client ID. */
  localClientId: number;
}

/** The object returned by `createAwareness()`. */
export interface AwarenessStore<TLocal extends PlainObject> {
  /** Set your local awareness state (cursor, name, status, etc). */
  setLocal: (state: Partial<TLocal>) => void;
  /** Get the current local awareness state. */
  getLocal: () => TLocal;
  /** A Zustand store containing all peers' states. Subscribe for reactivity. */
  store: StoreApi<AwarenessState<TLocal>>;
  /** Detach the awareness observer. */
  destroy: () => void;
}

// ---------------------------------------------------------------------------
// Undo types
// ---------------------------------------------------------------------------

/** The object returned by `createUndoManager()`. */
export interface UndoManager {
  /** Undo the last local change. */
  undo: () => void;
  /** Redo the last undone change. */
  redo: () => void;
  /** Whether there are changes to undo. */
  canUndo: () => boolean;
  /** Whether there are changes to redo. */
  canRedo: () => boolean;
  /** A Zustand store with reactive `canUndo` and `canRedo` booleans. */
  store: StoreApi<{ canUndo: boolean; canRedo: boolean }>;
  /** Detach the undo manager. */
  destroy: () => void;
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/** Branded symbol used as the Yjs transaction origin to prevent echo. */
export const ORIGIN = Symbol.for("yjs-zustand");

/**
 * Passed as the second argument to Zustand's `set()` to indicate a full
 * state replacement rather than a partial merge.
 */
export const REPLACE_STATE = true;

/** Key used to store the schema version in the Y.Map. */
export const VERSION_KEY = "__zustand_yjs_version__";

// ---------------------------------------------------------------------------
// Internal type aliases
// ---------------------------------------------------------------------------

/** A plain JS object — the data portion of Zustand state (no functions). */
export type PlainObject = Record<string, unknown>;

/**
 * Zustand's `set()` uses complex overloads that cannot be expressed as a
 * single callable type. This simplified signature captures the underlying
 * behaviour (accept state + optional replace flag) so we can wrap and
 * forward calls without using `Function` or `any`.
 */
export type SetFn = (state: unknown, replace?: boolean) => void;

/**
 * Mutable boolean ref for tracking whether the middleware is currently
 * applying remote Yjs changes.
 */
export interface RemoteRef {
  current: boolean;
}

// ---------------------------------------------------------------------------
// Path-aware key matching (internal)
// ---------------------------------------------------------------------------

/**
 * A path-aware key matcher. Used internally for `exclude` and `atomicStrings`
 * to support dot-path syntax like `"ui.draft"` or `"items.id"`.
 */
export interface KeyMatcher {
  /** Check if a key matches at the current nesting level. */
  matches(key: string): boolean;
  /** Get the sub-matcher for a key's children (next nesting level). */
  child(key: string): KeyMatcher;
}

/** A KeyMatcher that never matches anything. */
export const EMPTY_MATCHER: KeyMatcher = {
  matches: () => false,
  child: () => EMPTY_MATCHER,
};

/**
 * Create a KeyMatcher from an array of dot-paths.
 * `"foo"` matches key `"foo"` at the top level only.
 * `"foo.bar"` matches key `"bar"` inside `"foo"`.
 */
export function createPathMatcher(paths: string[]): KeyMatcher {
  if (paths.length === 0) return EMPTY_MATCHER;

  const direct = new Set<string>();
  const nested = new Map<string, string[]>();

  for (const path of paths) {
    const dot = path.indexOf(".");
    if (dot === -1) {
      direct.add(path);
    } else {
      const head = path.slice(0, dot);
      const tail = path.slice(dot + 1);
      let sub = nested.get(head);
      if (!sub) { sub = []; nested.set(head, sub); }
      sub.push(tail);
    }
  }

  const childMatchers = new Map<string, KeyMatcher>();
  for (const [key, subPaths] of nested) {
    childMatchers.set(key, createPathMatcher(subPaths));
  }

  return {
    matches: (key) => direct.has(key),
    child: (key) => childMatchers.get(key) ?? EMPTY_MATCHER,
  };
}

/**
 * Create a KeyMatcher where simple names (no dots) match at ANY nesting
 * level, and dot-paths match at specific levels. Used for `atomicStrings`
 * to preserve backwards compatibility — `"id"` matches all keys named
 * `"id"` regardless of depth.
 */
export function createWildcardMatcher(paths: string[]): KeyMatcher {
  if (paths.length === 0) return EMPTY_MATCHER;

  const wildcards = new Set<string>();
  const specific: string[] = [];

  for (const path of paths) {
    if (path.includes(".")) {
      specific.push(path);
    } else {
      wildcards.add(path);
    }
  }

  if (wildcards.size === 0) return createPathMatcher(specific);

  const specificMatcher = createPathMatcher(specific);

  // A matcher with only wildcards — reused as child for keys without
  // specific sub-paths. Self-referential so it propagates to all depths.
  const wildcardOnly: KeyMatcher = {
    matches: (key) => wildcards.has(key),
    child: () => wildcardOnly,
  };

  if (specific.length === 0) return wildcardOnly;

  return combineWildcard(wildcards, specificMatcher, wildcardOnly);
}

function combineWildcard(
  wildcards: ReadonlySet<string>,
  specific: KeyMatcher,
  wildcardOnly: KeyMatcher,
): KeyMatcher {
  return {
    matches: (key) => wildcards.has(key) || specific.matches(key),
    child: (key) => {
      const sc = specific.child(key);
      return sc === EMPTY_MATCHER
        ? wildcardOnly
        : combineWildcard(wildcards, sc, wildcardOnly);
    },
  };
}

// ---------------------------------------------------------------------------
// Array key mapping (internal)
// ---------------------------------------------------------------------------

/**
 * Path-aware map from array key names to their identity field.
 * Used to enable key-based array reconciliation at specific paths.
 */
export interface ArrayKeyMap {
  /** Get the identity key field for an array at this nesting level. */
  get(key: string): string | undefined;
  /** Descend into a child key (next nesting level). */
  child(key: string): ArrayKeyMap;
}

/** An ArrayKeyMap with no entries. */
export const EMPTY_ARRAY_KEY_MAP: ArrayKeyMap = {
  get: () => undefined,
  child: () => EMPTY_ARRAY_KEY_MAP,
};

/**
 * Build an ArrayKeyMap from a `Record<string, string>` where keys are
 * dot-paths and values are the identity field name.
 *
 * Example: `{ "todos": "id", "projects.tasks": "taskId" }`
 */
export function createArrayKeyMap(
  config: Record<string, string>,
): ArrayKeyMap {
  const entries = Object.entries(config);
  if (entries.length === 0) return EMPTY_ARRAY_KEY_MAP;

  const direct = new Map<string, string>();
  const nested = new Map<string, Record<string, string>>();

  for (const [path, keyField] of entries) {
    const dot = path.indexOf(".");
    if (dot === -1) {
      direct.set(path, keyField);
    } else {
      const head = path.slice(0, dot);
      const tail = path.slice(dot + 1);
      let sub = nested.get(head);
      if (!sub) { sub = {}; nested.set(head, sub); }
      sub[tail] = keyField;
    }
  }

  const childMaps = new Map<string, ArrayKeyMap>();
  for (const [key, subConfig] of nested) {
    childMaps.set(key, createArrayKeyMap(subConfig));
  }

  return {
    get: (key) => direct.get(key),
    child: (key) => childMaps.get(key) ?? EMPTY_ARRAY_KEY_MAP,
  };
}
