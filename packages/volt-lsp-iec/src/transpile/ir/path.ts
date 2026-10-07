/**
 * THE IDE'S VARIABLE PATH — `count`, `inst.q`, `arr[2].x`, `a[1, 2]`, ``fb.`TYPE` `` — as segments. One grammar for the
 * two readers that walk it: the interpreter's `Runner.get`/`set` and the Rust harness's `rustAccess`, so a test reads the
 * emitted program exactly where the interpreter reads (transpile-restructure design.md §2.2).
 */
import { sameName } from "../../frontend/syntax/index.js"

/** One step of a path: a variable or field by name, or one array index. */
export type PathSegment = { kind: "name"; name: string } | { kind: "index"; index: bigint }

/**
 * A path's segments. A name may be backtick-quoted — ``fb.`TYPE` `` is how CODESYS names a variable declared `` `TYPE` ``
 * — and comes back without its quotes; `a[1, 2]` indexes two dimensions, one segment each, as `a[1][2]` would.
 */
export function parsePath(path: string): PathSegment[] {
  return [...path.matchAll(/(`[^`]+`|[A-Za-z_]\w*)|\[([^\]]+)\]/g)].flatMap((m): PathSegment[] =>
    m[2] === undefined
      ? [{ kind: "name", name: unquoted(m[1]!) }]
      : m[2].split(",").map((index) => ({ kind: "index", index: BigInt(index.trim()) })),
  )
}

/** A name without the backticks that may quote it. */
const unquoted = (n: string): string => n.replace(/^`|`$/g, "")

/** Does a path segment's name name the variable declared `declared` (quoted or not) — ST names are case-insensitive. */
export function namesVariable(declared: string, segment: string): boolean {
  return sameName(unquoted(declared), segment)
}
