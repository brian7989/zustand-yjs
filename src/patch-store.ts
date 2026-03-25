/**
 * Yjs → Zustand sync: structural patching.
 *
 * Builds a new state object from incoming Yjs data while reusing references
 * from the existing Zustand state wherever values haven't changed. This
 * gives us immutability (React re-renders correctly), structural sharing
 * (unchanged subtrees don't re-render), and Immer compatibility (frozen
 * objects are never mutated).
 */

import type { PlainObject } from "./types.js";

// ---------------------------------------------------------------------------
// Structural patch
// ---------------------------------------------------------------------------

/**
 * Create a new state by merging `incoming` (from Yjs) into `existing`
 * (from Zustand), reusing existing references for unchanged values.
 *
 * Functions in `existing` are preserved — they're never synced to Yjs.
 */
export function structuralPatch<T extends PlainObject>(
  existing: T,
  incoming: PlainObject,
): T {
  let changed = false;
  const result: PlainObject = {};

  preserveFunctions(existing, result);

  for (const [key, incomingValue] of Object.entries(incoming)) {
    const existingValue = existing[key];

    if (deepEqual(existingValue, incomingValue)) {
      result[key] = existingValue;
    } else {
      const reused = reuseIfPossible(existingValue, incomingValue);
      if (reused !== existingValue) changed = true;
      result[key] = reused;
    }
  }

  if (hasRemovedKeys(existing, incoming)) {
    changed = true;
  }

  return changed ? (result as T) : existing;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to recursively preserve references for nested structures.
 * If both values are plain objects, recurse with structuralPatch.
 * If both are arrays, do element-wise structural sharing.
 * Otherwise return the incoming value wholesale.
 */
function reuseIfPossible(existing: unknown, incoming: unknown): unknown {
  if (
    existing !== null && incoming !== null &&
    typeof existing === "object" && typeof incoming === "object" &&
    !(existing instanceof Uint8Array) && !(incoming instanceof Uint8Array)
  ) {
    if (Array.isArray(existing) && Array.isArray(incoming)) {
      return structuralPatchArray(existing, incoming);
    }
    if (!Array.isArray(existing) && !Array.isArray(incoming)) {
      return structuralPatch(existing as PlainObject, incoming as PlainObject);
    }
  }
  return incoming;
}

/**
 * Element-wise structural sharing for arrays.
 * Returns the original array reference if nothing changed.
 */
function structuralPatchArray(existing: unknown[], incoming: unknown[]): unknown[] {
  if (existing.length !== incoming.length) {
    return incoming.map((item, i) =>
      i < existing.length ? reuseElement(existing[i], item) : item,
    );
  }

  let changed = false;
  const result = incoming.map((item, i) => {
    const reused = reuseElement(existing[i], item);
    if (reused !== existing[i]) changed = true;
    return reused;
  });

  return changed ? result : existing;
}

/** Reuse an array element reference if deeply equal, or recurse if both are objects. */
function reuseElement(existing: unknown, incoming: unknown): unknown {
  if (deepEqual(existing, incoming)) return existing;
  return reuseIfPossible(existing, incoming);
}

/** Copy function-valued keys from source to target. */
function preserveFunctions(source: PlainObject, target: PlainObject): void {
  for (const key of Object.keys(source)) {
    if (typeof source[key] === "function") {
      target[key] = source[key];
    }
  }
}

/** Check if any non-function keys were removed (exist in old but not new). */
function hasRemovedKeys(existing: PlainObject, incoming: PlainObject): boolean {
  for (const key of Object.keys(existing)) {
    if (typeof existing[key] !== "function" && !(key in incoming)) {
      return true;
    }
  }
  return false;
}

/** Deep structural equality for plain JSON-serialisable values + Uint8Array. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;

  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    return uint8ArraysEqual(a, b);
  }

  if (Array.isArray(a)) {
    return Array.isArray(b) && arraysEqual(a, b);
  }

  return objectsEqual(a as PlainObject, b as PlainObject);
}

function arraysEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((val, i) => deepEqual(val, b[i]));
}

function uint8ArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function objectsEqual(a: PlainObject, b: PlainObject): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => deepEqual(a[key], b[key]));
}
