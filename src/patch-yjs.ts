/**
 * Zustand → Yjs sync: incremental patching.
 *
 * Diffs a plain JS state against the current Yjs shared types and applies
 * only the necessary mutations. This avoids tearing down and recreating the
 * entire Yjs structure on every store update, preserving Yjs's internal
 * change-tracking and minimising the data sent over the wire.
 */

import * as Y from "yjs";
import type { PlainObject, KeyMatcher, ArrayKeyMap } from "./types.js";
import { EMPTY_ARRAY_KEY_MAP } from "./types.js";
import { toYType, fromYType } from "./convert.js";

// ---------------------------------------------------------------------------
// Y.Map patching
// ---------------------------------------------------------------------------

/**
 * Recursively patch a `Y.Map` so it mirrors `desired` (a plain object).
 * Only keys that actually changed are touched.
 */
export function patchYMap(
  yMap: Y.Map<unknown>,
  desired: Record<string, unknown>,
  atomicMatcher: KeyMatcher,
  arrayKeyMap: ArrayKeyMap = EMPTY_ARRAY_KEY_MAP,
): void {
  deleteRemovedKeys(yMap, desired);

  for (const [key, newValue] of Object.entries(desired)) {
    patchYValue(yMap, key, yMap.get(key), newValue, atomicMatcher, arrayKeyMap);
  }
}

/** Remove Y.Map keys that no longer exist in the desired state. */
function deleteRemovedKeys(
  yMap: Y.Map<unknown>,
  desired: Record<string, unknown>,
): void {
  for (const key of yMap.keys()) {
    if (!(key in desired)) {
      yMap.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Single-value patching
// ---------------------------------------------------------------------------

/**
 * Patch a single value inside a Y.Map. If the structural type hasn't
 * changed (e.g. both old and new are objects) we recurse; otherwise we
 * replace the value wholesale.
 */
function patchYValue(
  parent: Y.Map<unknown>,
  key: string,
  current: unknown,
  desired: unknown,
  atomicMatcher: KeyMatcher,
  arrayKeyMap: ArrayKeyMap,
): void {
  if (typeof desired === "function") return;

  if (desired === null || desired === undefined) {
    patchPrimitive(parent, key, current, desired);
    return;
  }

  if (typeof desired === "string") {
    patchString(parent, key, current, desired, atomicMatcher);
    return;
  }

  if (typeof desired !== "object") {
    patchPrimitive(parent, key, current, desired);
    return;
  }

  if (desired instanceof Uint8Array) {
    patchBinary(parent, key, current, desired);
    return;
  }

  // Descend matchers for nested structures.
  const childAtomic = atomicMatcher.child(key);
  const childArrayKeys = arrayKeyMap.child(key);

  if (Array.isArray(desired)) {
    const keyField = arrayKeyMap.get(key);
    if (keyField && current instanceof Y.Array) {
      patchYArrayByKey(current, desired, keyField, childAtomic, childArrayKeys);
    } else if (current instanceof Y.Array) {
      patchYArray(current, desired, childAtomic, childArrayKeys);
    } else {
      parent.set(key, toYType(desired, childAtomic));
    }
    return;
  }

  if (current instanceof Y.Map) {
    patchYMap(current, desired as PlainObject, childAtomic, childArrayKeys);
  } else {
    parent.set(key, toYType(desired, childAtomic));
  }
}

function patchBinary(
  parent: Y.Map<unknown>,
  key: string,
  current: unknown,
  desired: Uint8Array,
): void {
  if (!(current instanceof Uint8Array) || !bytesEqual(current, desired)) {
    parent.set(key, desired);
  }
}

/** Compare two Uint8Arrays byte-by-byte. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function patchPrimitive(
  parent: Y.Map<unknown>,
  key: string,
  current: unknown,
  desired: unknown,
): void {
  if (current !== desired) {
    parent.set(key, desired);
  }
}

function patchString(
  parent: Y.Map<unknown>,
  key: string,
  current: unknown,
  desired: string,
  atomicMatcher: KeyMatcher,
): void {
  if (atomicMatcher.matches(key)) {
    patchPrimitive(parent, key, current, desired);
    return;
  }

  if (current instanceof Y.Text) {
    patchYText(current, desired);
  } else {
    parent.set(key, toYType(desired, atomicMatcher, key));
  }
}

// ---------------------------------------------------------------------------
// Positional Y.Array patching (default)
// ---------------------------------------------------------------------------

/**
 * Patch a `Y.Array` to match `desired` using positional comparison.
 *
 * Excess items are trimmed from the end first to avoid index-shifting bugs
 * (fixes joebobmiles/zustand-middleware-yjs#61).
 */
export function patchYArray(
  yArr: Y.Array<unknown>,
  desired: unknown[],
  atomicMatcher: KeyMatcher,
  arrayKeyMap: ArrayKeyMap = EMPTY_ARRAY_KEY_MAP,
): void {
  trimExcessItems(yArr, desired.length);
  patchOverlappingItems(yArr, desired, atomicMatcher, arrayKeyMap);
  appendNewItems(yArr, desired, atomicMatcher);
}

/** Remove trailing items if the array shrunk. */
function trimExcessItems(yArr: Y.Array<unknown>, desiredLen: number): void {
  const excess = yArr.length - desiredLen;
  if (excess > 0) {
    yArr.delete(desiredLen, excess);
  }
}

/** Patch items that exist in both the current and desired arrays. */
function patchOverlappingItems(
  yArr: Y.Array<unknown>,
  desired: unknown[],
  atomicMatcher: KeyMatcher,
  arrayKeyMap: ArrayKeyMap,
): void {
  const overlapLen = Math.min(yArr.length, desired.length);

  for (let i = 0; i < overlapLen; i++) {
    patchArrayItem(yArr, i, yArr.get(i), desired[i], atomicMatcher, arrayKeyMap);
  }
}

/** Append items that only exist in the desired array. */
function appendNewItems(
  yArr: Y.Array<unknown>,
  desired: unknown[],
  atomicMatcher: KeyMatcher,
): void {
  if (desired.length <= yArr.length) return;

  const newItems = desired
    .slice(yArr.length)
    .map((v) => toYType(v, atomicMatcher));
  yArr.insert(yArr.length, newItems);
}

/** Patch a single array item at position `i`. */
function patchArrayItem(
  yArr: Y.Array<unknown>,
  index: number,
  current: unknown,
  desired: unknown,
  atomicMatcher: KeyMatcher,
  arrayKeyMap: ArrayKeyMap,
): void {
  if (isPrimitive(desired) || isPrimitive(current)) {
    if (fromYType(current) !== desired) {
      replaceArrayItem(yArr, index, desired, atomicMatcher);
    }
    return;
  }

  if (Array.isArray(desired) && current instanceof Y.Array) {
    patchYArray(current, desired, atomicMatcher, arrayKeyMap);
    return;
  }

  if (typeof desired === "object" && desired !== null && current instanceof Y.Map) {
    patchYMap(current, desired as PlainObject, atomicMatcher, arrayKeyMap);
    return;
  }

  if (typeof desired === "string" && current instanceof Y.Text) {
    patchYText(current, desired);
    return;
  }

  replaceArrayItem(yArr, index, desired, atomicMatcher);
}

/** Delete and reinsert a single array item. */
function replaceArrayItem(
  yArr: Y.Array<unknown>,
  index: number,
  value: unknown,
  atomicMatcher: KeyMatcher,
): void {
  yArr.delete(index, 1);
  yArr.insert(index, [toYType(value, atomicMatcher)]);
}

// ---------------------------------------------------------------------------
// Key-based Y.Array patching
// ---------------------------------------------------------------------------

/**
 * Patch a Y.Array by matching items using a key field (like React's `key`).
 *
 * Instead of comparing by position, items are matched by their identity
 * key (e.g. `id`). This means inserting an item at index 0 only creates
 * one new Y.Map — existing items are matched by key and patched in place.
 *
 * Algorithm:
 * 1. Build a key → Y.Map index for current items
 * 2. Delete items whose keys are no longer present (back to front)
 * 3. If remaining items are in the same relative order as desired,
 *    walk the desired array and insert new items / patch existing ones
 * 4. If order changed (reorder), fall back to positional patching
 */
function patchYArrayByKey(
  yArr: Y.Array<unknown>,
  desired: unknown[],
  keyField: string,
  atomicMatcher: KeyMatcher,
  arrayKeyMap: ArrayKeyMap,
): void {
  // Extract keys from current Y.Array.
  const currentKeys: string[] = [];
  const currentKeySet = new Set<string>();
  for (let i = 0; i < yArr.length; i++) {
    const key = extractKey(yArr.get(i), keyField);
    if (key === undefined) {
      // Item without a key — fall back to positional patching.
      patchYArray(yArr, desired, atomicMatcher, arrayKeyMap);
      return;
    }
    currentKeys.push(key);
    currentKeySet.add(key);
  }

  // Extract keys from desired items.
  const desiredKeys: string[] = [];
  for (const item of desired) {
    const key = extractDesiredKey(item, keyField);
    if (key === undefined) {
      patchYArray(yArr, desired, atomicMatcher, arrayKeyMap);
      return;
    }
    desiredKeys.push(key);
  }

  const desiredKeySet = new Set(desiredKeys);

  // Phase 1: Delete items not in desired (back to front to preserve indices).
  for (let i = currentKeys.length - 1; i >= 0; i--) {
    if (!desiredKeySet.has(currentKeys[i])) {
      yArr.delete(i, 1);
    }
  }

  // After deletions, remaining keys in their original relative order.
  const remainingKeys = currentKeys.filter((k) => desiredKeySet.has(k));

  // Check if remaining items are in the same relative order as in desired.
  const desiredExistingKeys = desiredKeys.filter((k) => currentKeySet.has(k));

  if (
    remainingKeys.length !== desiredExistingKeys.length ||
    !remainingKeys.every((k, i) => k === desiredExistingKeys[i])
  ) {
    // Order changed — fall back to full rebuild via positional patching.
    // The deletions above already removed stale items, so we work with
    // what's left and let positional patching handle the rest.
    patchYArray(yArr, desired, atomicMatcher, arrayKeyMap);
    return;
  }

  // Phase 2: Walk desired array. Insert new items, patch existing ones.
  let yIndex = 0;
  for (let dIdx = 0; dIdx < desired.length; dIdx++) {
    const dKey = desiredKeys[dIdx];

    if (!currentKeySet.has(dKey)) {
      // New item — insert at current position.
      yArr.insert(yIndex, [toYType(desired[dIdx], atomicMatcher)]);
    } else {
      // Existing item — patch the Y.Map in place.
      const existing = yArr.get(yIndex);
      if (
        existing instanceof Y.Map &&
        typeof desired[dIdx] === "object" &&
        desired[dIdx] !== null
      ) {
        patchYMap(existing, desired[dIdx] as PlainObject, atomicMatcher, arrayKeyMap);
      }
    }
    yIndex++;
  }
}

/** Extract the identity key from a Y.Map item in a Y.Array. */
function extractKey(item: unknown, keyField: string): string | undefined {
  if (!(item instanceof Y.Map)) return undefined;
  const val = item.get(keyField);
  if (val instanceof Y.Text) return val.toString();
  if (typeof val === "string" || typeof val === "number") return String(val);
  return undefined;
}

/** Extract the identity key from a plain JS object. */
function extractDesiredKey(
  item: unknown,
  keyField: string,
): string | undefined {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    return undefined;
  }
  const val = (item as Record<string, unknown>)[keyField];
  if (typeof val === "string" || typeof val === "number") return String(val);
  return undefined;
}

// ---------------------------------------------------------------------------
// Y.Text patching — minimal diff
// ---------------------------------------------------------------------------

/**
 * Patch a `Y.Text` to match `desired` using a prefix/suffix diff.
 *
 * Finds the longest common prefix and suffix, then replaces only the
 * changed middle section. This preserves Yjs cursor positions in the
 * unchanged regions and minimises the transaction size.
 */
export function patchYText(yText: Y.Text, desired: string): void {
  const current = yText.toString();
  if (current === desired) return;

  const prefixLen = commonPrefixLength(current, desired);
  const suffixLen = commonSuffixLength(current, desired, prefixLen);

  const deleteCount = current.length - prefixLen - suffixLen;
  const insertEnd = desired.length - suffixLen;
  const insertStr = desired.slice(prefixLen, insertEnd);

  if (deleteCount > 0) {
    yText.delete(prefixLen, deleteCount);
  }
  if (insertStr.length > 0) {
    yText.insert(prefixLen, insertStr);
  }
}

/** Count how many characters match from the start. */
function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i++;
  return i;
}

/** Count how many characters match from the end (without overlapping the prefix). */
function commonSuffixLength(a: string, b: string, prefixLen: number): number {
  const limit = Math.min(a.length, b.length) - prefixLen;
  let i = 0;
  while (i < limit && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPrimitive(v: unknown): boolean {
  return v === null || v === undefined || typeof v !== "object";
}
