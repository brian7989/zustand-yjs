/**
 * The core Yjs middleware for Zustand.
 *
 * Creates a Zustand store that can connect/disconnect to a Y.Doc on demand.
 * When connected, local store updates are pushed into Yjs; remote Yjs
 * changes are pulled into the store — with echo prevention via transaction
 * origins.
 */

import * as Y from "yjs";
import { createStore } from "zustand";
import type { StoreApi } from "zustand";
import {
  ORIGIN, REPLACE_STATE, VERSION_KEY,
  EMPTY_MATCHER, createPathMatcher, createWildcardMatcher,
  createArrayKeyMap,
} from "./types.js";
import type {
  Yjs, YjsOptions, PlainObject, SetFn, RemoteRef, YjsStoreApi,
  YjsConnection, KeyMatcher, ArrayKeyMap,
} from "./types.js";
import { toYType, fromYType } from "./convert.js";
import { patchYMap } from "./patch-yjs.js";
import { structuralPatch } from "./patch-store.js";

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Yjs middleware for Zustand. Wraps a state creator and exposes a `.yjs`
 * connection API on the store for connecting/disconnecting to Y.Docs.
 *
 * The store starts dormant — call `store.yjs.connect(doc)` to begin
 * two-way sync.
 *
 * @example
 * ```ts
 * import { create } from "zustand";
 * import { yjs } from "zustand-yjs";
 *
 * const useStore = create(yjs("shared", (set) => ({
 *   count: 0,
 *   increment: () => set(s => ({ count: s.count + 1 })),
 * })));
 *
 * useStore.yjs.connect(doc);     // start syncing
 * useStore.yjs.disconnect();     // stop syncing
 * useStore.yjs.switchRoom(doc2); // switch to another doc
 * ```
 */
export const yjs = (<T>(
  mapName: string,
  creator: (...args: unknown[]) => T,
  options: YjsOptions = {},
) => {
  const atomicMatcher = createWildcardMatcher(options.atomicStrings ?? []);
  const excludeMatcher = createPathMatcher(options.exclude ?? []);
  const arrayKeyMap = createArrayKeyMap(options.arrayKeys ?? {});

  return (set: unknown, get: () => T, api: StoreApi<T>) => {
    const remoteRef: RemoteRef = { current: false };

    // Zustand's `set` uses complex overloads that can't be expressed as a
    // single type. We cast to SetFn — a simplified (state, replace?) → void
    // signature — to forward calls cleanly.
    const rawSet = set as unknown as SetFn;

    // --- Connection state (mutable, closed over) ---
    let currentDoc: Y.Doc | null = null;
    let currentYMap: Y.Map<unknown> | null = null;
    let currentObserver: ((
      events: Y.YEvent<Y.Map<unknown>>[],
      txn: Y.Transaction,
    ) => void) | null = null;

    // --- Wrapped set: pushes to Yjs when connected ---
    const wrappedSet = ((stateOrUpdater: unknown, replace?: boolean) => {
      rawSet(stateOrUpdater, replace);

      if (!remoteRef.current && currentDoc && currentYMap) {
        pushStateToYjs(currentDoc, currentYMap, asPlain(get()), atomicMatcher, excludeMatcher, arrayKeyMap);
      }
    }) as typeof rawSet;

    // --- Wrapped setState: same conditional push ---
    const rawSetState = api.setState as unknown as SetFn;
    api.setState = ((stateOrUpdater: unknown, replace?: boolean) => {
      rawSetState(stateOrUpdater, replace);

      if (!remoteRef.current && currentDoc && currentYMap) {
        pushStateToYjs(currentDoc, currentYMap, asPlain(api.getState()), atomicMatcher, excludeMatcher, arrayKeyMap);
      }
    }) as typeof api.setState;

    // --- Connection API ---
    const yjsConnection: YjsConnection = {
      get yMap() { return currentYMap; },
      get doc() { return currentDoc; },
      get connected() { return currentDoc !== null; },

      connect(doc: Y.Doc) {
        if (currentDoc) {
          throw new Error(
            "zustand-yjs: Already connected. Call disconnect() first, or use switchRoom().",
          );
        }

        currentDoc = doc;
        currentYMap = doc.getMap(mapName);

        currentObserver = createObserver(
          currentYMap, rawSet, get, remoteRef, excludeMatcher, options,
        );
        currentYMap.observeDeep(currentObserver);

        // Hydrate: either populate Yjs from store, or store from Yjs.
        hydrateOnConnect(
          doc, currentYMap, rawSet, get, remoteRef,
          atomicMatcher, excludeMatcher, arrayKeyMap, options,
        );

        options.onConnect?.();
      },

      disconnect() {
        if (currentYMap && currentObserver) {
          currentYMap.unobserveDeep(currentObserver);
        }
        currentDoc = null;
        currentYMap = null;
        currentObserver = null;

        options.onDisconnect?.();
      },

      switchRoom(doc: Y.Doc) {
        yjsConnection.disconnect();
        yjsConnection.connect(doc);
      },
    };

    // Attach .yjs to the store API.
    (api as unknown as { yjs: YjsConnection }).yjs = yjsConnection;

    const initialState = creator(wrappedSet, get, api);
    return initialState;
  };
}) as Yjs;

/**
 * Convenience function that creates a Zustand store with the yjs middleware
 * and returns it with proper typing — no manual cast needed.
 *
 * @example
 * ```ts
 * const store = createYjsStore("shared", (set) => ({
 *   count: 0,
 *   increment: () => set((s) => ({ count: s.count + 1 })),
 * }));
 *
 * store.yjs.connect(doc);     // start syncing
 * store.yjs.disconnect();     // stop syncing
 * ```
 */
export function createYjsStore<T>(
  mapName: string,
  creator: Parameters<typeof yjs<T>>[1],
  options?: YjsOptions<T>,
): YjsStoreApi<T> {
  return createStore(yjs(mapName, creator, options)) as unknown as YjsStoreApi<T>;
}

// ---------------------------------------------------------------------------
// Set helpers — push local Zustand changes into Yjs
// ---------------------------------------------------------------------------

/** Strip functions and excluded keys, then push data into the Y.Map. */
function pushStateToYjs(
  doc: Y.Doc,
  yMap: Y.Map<unknown>,
  state: PlainObject,
  atomicMatcher: KeyMatcher,
  excludeMatcher: KeyMatcher,
  arrayKeyMap: ArrayKeyMap,
): void {
  const data = filterSyncableKeys(state, excludeMatcher);
  doc.transact(() => patchYMap(yMap, data, atomicMatcher, arrayKeyMap), ORIGIN);
}

// ---------------------------------------------------------------------------
// Observer — pull remote Yjs changes into Zustand
// ---------------------------------------------------------------------------

/**
 * Create the `observeDeep` callback that pulls remote Yjs changes into
 * the Zustand store. Uses structural patching to preserve unchanged
 * references and avoid mutating frozen (Immer) objects.
 */
function createObserver<T>(
  yMap: Y.Map<unknown>,
  rawSet: SetFn,
  get: () => T,
  remoteRef: RemoteRef,
  excludeMatcher: KeyMatcher,
  options: YjsOptions,
) {
  return (_events: Y.YEvent<Y.Map<unknown>>[], transaction: Y.Transaction) => {
    if (transaction.origin === ORIGIN) return;

    options.onSyncStatusChange?.("syncing");

    remoteRef.current = true;
    try {
      const currentRaw = get();
      // Guard: during initialisation, get() may return undefined before
      // the store is fully set up (e.g. migration triggers a transaction).
      if (currentRaw === undefined) return;

      const incoming = yMapToPlain(yMap, excludeMatcher);
      const current = asPlain(currentRaw);

      // Preserve excluded keys — they're local-only and should never
      // be touched by remote updates.
      preserveExcludedKeys(current, incoming, excludeMatcher);

      const patched = structuralPatch(current, incoming);

      if (patched !== current) {
        rawSet(patched, REPLACE_STATE);
      }
    } catch (error) {
      if (options.onError) {
        options.onError(error);
      }
    } finally {
      remoteRef.current = false;
    }

    options.onSyncStatusChange?.("synced");
  };
}

// ---------------------------------------------------------------------------
// Lifecycle — hydration on connect
// ---------------------------------------------------------------------------

/**
 * Hydrate state when connecting: populate Y.Map from store if empty,
 * or update store from Y.Map if data already exists.
 */
function hydrateOnConnect<T>(
  doc: Y.Doc,
  yMap: Y.Map<unknown>,
  rawSet: SetFn,
  get: () => T,
  remoteRef: RemoteRef,
  atomicMatcher: KeyMatcher,
  excludeMatcher: KeyMatcher,
  arrayKeyMap: ArrayKeyMap,
  options: YjsOptions,
): void {
  const isFirstClient = yMap.size === 0;

  if (isFirstClient) {
    populateYMapFromState(doc, yMap, asPlain(get()), atomicMatcher, excludeMatcher, arrayKeyMap, options.version);
  } else {
    const remoteData = yMapToPlain(yMap, excludeMatcher);
    const migratedData = applyMigration(
      remoteData, doc, yMap, atomicMatcher, excludeMatcher, arrayKeyMap, options,
    );

    const current = asPlain(get());
    preserveExcludedKeys(current, migratedData, excludeMatcher);

    const patched = structuralPatch(current, migratedData);

    if (patched !== current) {
      remoteRef.current = true;
      try {
        rawSet(patched, REPLACE_STATE);
      } finally {
        remoteRef.current = false;
      }
    }
  }
}

/** First client: write initial state into the empty Y.Map. */
function populateYMapFromState(
  doc: Y.Doc,
  yMap: Y.Map<unknown>,
  state: PlainObject,
  atomicMatcher: KeyMatcher,
  excludeMatcher: KeyMatcher,
  _arrayKeyMap: ArrayKeyMap,
  version?: number,
): void {
  const data = filterSyncableKeys(state, excludeMatcher);
  doc.transact(() => {
    for (const [key, value] of Object.entries(data)) {
      yMap.set(key, toYType(value, atomicMatcher, key));
    }
    if (version !== undefined) {
      yMap.set(VERSION_KEY, version);
    }
  }, ORIGIN);
}

/**
 * Apply schema migration if the stored version is older than the
 * configured version.
 */
function applyMigration(
  state: PlainObject,
  doc: Y.Doc,
  yMap: Y.Map<unknown>,
  atomicMatcher: KeyMatcher,
  excludeMatcher: KeyMatcher,
  arrayKeyMap: ArrayKeyMap,
  options: YjsOptions,
): PlainObject {
  if (options.version === undefined || !options.migrate) return state;

  const storedVersion = (yMap.get(VERSION_KEY) as number) ?? 0;

  if (storedVersion < options.version) {
    const migrated = options.migrate(state, storedVersion);
    // Write migrated data back to Yjs so other clients don't re-migrate.
    const syncable = filterSyncableKeys(migrated, excludeMatcher);
    doc.transact(() => {
      patchYMap(yMap, syncable, atomicMatcher, arrayKeyMap);
      yMap.set(VERSION_KEY, options.version!);
    }, ORIGIN);
    return migrated;
  }

  return state;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Remove function-valued keys and excluded keys from state.
 * Recurses into nested objects when there are nested exclude paths.
 */
function filterSyncableKeys(
  state: PlainObject,
  excludeMatcher: KeyMatcher,
): PlainObject {
  const result: PlainObject = {};
  for (const [key, value] of Object.entries(state)) {
    if (typeof value === "function" || excludeMatcher.matches(key)) continue;
    const childMatcher = excludeMatcher.child(key);
    if (childMatcher !== EMPTY_MATCHER && isPlainObject(value)) {
      result[key] = filterSyncableKeys(value as PlainObject, childMatcher);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Convert a Y.Map to a plain JS object, skipping excluded and internal keys.
 * Recurses into nested Y.Maps when there are nested exclude paths.
 */
function yMapToPlain(
  yMap: Y.Map<unknown>,
  excludeMatcher: KeyMatcher,
): PlainObject {
  const result: PlainObject = {};
  yMap.forEach((value, key) => {
    if (excludeMatcher.matches(key) || key === VERSION_KEY) return;
    const childMatcher = excludeMatcher.child(key);
    if (childMatcher !== EMPTY_MATCHER && value instanceof Y.Map) {
      result[key] = yMapToPlainWithExcludes(value, childMatcher);
    } else {
      result[key] = fromYType(value);
    }
  });
  return result;
}

/** Recursive helper: convert nested Y.Map while respecting exclude paths. */
function yMapToPlainWithExcludes(
  yMap: Y.Map<unknown>,
  excludeMatcher: KeyMatcher,
): PlainObject {
  const result: PlainObject = {};
  yMap.forEach((value, key) => {
    if (excludeMatcher.matches(key)) return;
    const childMatcher = excludeMatcher.child(key);
    if (childMatcher !== EMPTY_MATCHER && value instanceof Y.Map) {
      result[key] = yMapToPlainWithExcludes(value, childMatcher);
    } else {
      result[key] = fromYType(value);
    }
  });
  return result;
}

/**
 * Copy excluded keys from `current` into `incoming` so that `structuralPatch`
 * preserves them. Without this, excluded keys would be treated as "removed"
 * because they don't exist in the Yjs data.
 * Recurses into nested objects for nested exclude paths.
 */
function preserveExcludedKeys(
  current: PlainObject,
  incoming: PlainObject,
  excludeMatcher: KeyMatcher,
): void {
  for (const key of Object.keys(current)) {
    if (excludeMatcher.matches(key)) {
      incoming[key] = current[key];
    } else {
      const childMatcher = excludeMatcher.child(key);
      if (
        childMatcher !== EMPTY_MATCHER &&
        isPlainObject(current[key]) && isPlainObject(incoming[key])
      ) {
        preserveExcludedKeys(
          current[key] as PlainObject,
          incoming[key] as PlainObject,
          childMatcher,
        );
      }
    }
  }
}

/** Check if a value is a plain object (not null, not array, not Uint8Array). */
function isPlainObject(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array)
  );
}

/**
 * Treat a Zustand state T as a PlainObject. Safe because Zustand states
 * are always plain objects (with optional function-valued actions).
 */
function asPlain<T>(state: T): PlainObject {
  return state as PlainObject;
}
