/**
 * A routine variant's identity: a type as a name in its key (transpile-review 42).
 */

import type { Type } from "../../../frontend/types/index.js"

/**
 * A type as a name, for a routine variant's key — the storage the argument is, not the syntax. An ARRAY is its bounds
 * and its element's key, recursively: the bare kind made every array after the first reuse the first one's
 * instantiation, its hidden in-out typed for THAT array (Rust E0308 — transpile-review 42). No `.` in the key: the
 * emitter reads a routine's own name after the last one.
 */
export const typeKey = (t: Type): string =>
  t.kind === "elementary"
    ? `${t.name}${t.length === undefined ? "" : String(t.length)}`
    : t.kind === "struct" || t.kind === "function_block"
      ? t.name.toUpperCase()
      : t.kind === "array"
        ? `ARRAY[${t.bounds === undefined ? "*" : t.bounds.map((b) => `${b.lower}:${b.upper}`).join(",")}] OF ${typeKey(t.element)}`
        : t.kind
