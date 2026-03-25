/**
 * Bidirectional conversion between plain JavaScript values and Yjs shared
 * types. Each converter is a pure function — no Yjs transaction is started
 * here; callers are responsible for wrapping mutations in `doc.transact()`.
 *
 * Return types are `unknown` because the JS ↔ Yjs mapping is inherently
 * dynamic: the output type depends on the runtime value of the input.
 */

import * as Y from "yjs";
import type { PlainObject, KeyMatcher } from "./types.js";

// ---------------------------------------------------------------------------
// JS → Yjs
// ---------------------------------------------------------------------------

/**
 * Convert an arbitrary JS value to its Yjs shared-type equivalent.
 *
 * - Objects      → Y.Map
 * - Arrays       → Y.Array
 * - Strings      → Y.Text  (unless the key is listed in `atomicMatcher`)
 * - Uint8Array   → Uint8Array (Yjs stores binary natively)
 * - Primitives   → stored directly (number, boolean, null)
 * - Functions    → skipped (returns undefined)
 */
export function toYType(
  value: unknown,
  atomicMatcher: KeyMatcher,
  key?: string,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "function") return undefined;
  if (typeof value === "string") return stringToYType(value, atomicMatcher, key);
  if (value instanceof Uint8Array) return value; // Yjs stores binary natively
  // For objects and arrays, descend the matcher when we have a named key.
  const childMatcher = key ? atomicMatcher.child(key) : atomicMatcher;
  if (Array.isArray(value)) return arrayToYArray(value, childMatcher);
  if (typeof value === "object") return objectToYMap(value as PlainObject, childMatcher);
  return value; // number | boolean — stored directly by Yjs
}

function stringToYType(
  value: string,
  atomicMatcher: KeyMatcher,
  key?: string,
): string | Y.Text {
  if (key !== undefined && atomicMatcher.matches(key)) return value;
  const text = new Y.Text();
  text.insert(0, value);
  return text;
}

function arrayToYArray(
  value: unknown[],
  atomicMatcher: KeyMatcher,
): Y.Array<unknown> {
  const arr = new Y.Array<unknown>();
  const items = value.map((v) => toYType(v, atomicMatcher));
  arr.insert(0, items);
  return arr;
}

function objectToYMap(
  value: PlainObject,
  atomicMatcher: KeyMatcher,
): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== "function") {
      map.set(k, toYType(v, atomicMatcher, k));
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Yjs → JS
// ---------------------------------------------------------------------------

/**
 * Convert a Yjs shared type back to a plain JS value.
 */
export function fromYType(value: unknown): unknown {
  if (value instanceof Y.Text) return value.toString();
  if (value instanceof Y.Array) return value.toArray().map(fromYType);
  if (value instanceof Y.Map) return yMapToObject(value);
  // Uint8Array, number, boolean, null — already plain
  return value;
}

function yMapToObject(yMap: Y.Map<unknown>): PlainObject {
  const obj: PlainObject = {};
  yMap.forEach((v, k) => {
    obj[k] = fromYType(v);
  });
  return obj;
}
