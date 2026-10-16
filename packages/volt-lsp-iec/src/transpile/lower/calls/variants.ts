/**
 * A routine variant's identity: a type as a name in its key (transpile-review 42).
 */

import type { Type } from "../../../frontend/types/index.js"
import { LoweringBug } from "../../semantics/faults.js"

/**
 * A type as a name, for a routine variant's key — the storage the argument is, not the syntax. An ARRAY is its bounds
 * and its element's key, recursively: the bare kind made every array after the first reuse the first one's
 * instantiation, its hidden in-out typed for THAT array (Rust E0308 — transpile-review 42). No `.` in the key: the
 * emitter reads a routine's own name after the last one. A pointer or a reference is its target's key, recursively; an
 * enum or an interface its name. A type no variant is named by (a static name, an unknown) is refused: the bare kind
 * once keyed every pointer alike.
 */
export function typeKey(t: Type): string {
  switch (t.kind) {
    case "elementary":
      return `${t.name}${t.length === undefined ? "" : String(t.length)}`
    case "struct":
    case "function_block":
    case "enum":
    case "interface":
      return t.name.toUpperCase()
    case "array":
      return `ARRAY[${t.bounds === undefined ? "*" : t.bounds.map((b) => `${b.lower}:${b.upper}`).join(",")}] OF ${typeKey(t.element)}`
    case "pointer":
      return `POINTER TO ${typeKey(t.target)}`
    case "reference":
      return `REFERENCE TO ${typeKey(t.target)}`
    case "static":
    case "unknown":
      throw new LoweringBug(`a ${t.kind} type names no routine variant`)
  }
}
