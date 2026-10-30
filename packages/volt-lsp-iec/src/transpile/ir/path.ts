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

/** A variable a path can start at: a POU slot or a global — its name, its GVL and whether that list is `qualified_only`;
 *  a called PROGRAM's instance (`section` "program") no path names. */
interface Named {
  readonly name: string
  readonly section: string
  readonly list?: string
  readonly qualifiedOnly?: true
}

/**
 * THE ROOT A PATH STARTS AT — the one rule the interpreter's `Runner.get`/`set` and the Rust harness's `rustAccess` both
 * read, so a test names a global exactly where the program holds it:
 *   - the POU's own variable, which shadows a global of its name, as it does in the body;
 *   - `<list>.<name>`, a GVL variable named through its list — the one path every global has;
 *   - a bare name, only for a global ONE list declares and that list not `qualified_only` (the `__clock` too). A bare name
 *     two lists declare is AMBIGUOUS, and one a `qualified_only` list declares is not its name: both are refused by
 *     name, never resolved to the first or to the only plain one.
 * A GVL variable whose declaration did not lower (`IrPou.unlowered`) is a variable all the same — named, counted for
 * ambiguity — and the path that reaches it is refused with the refusal it met.
 * `rest` is the path after the root. A throw names what the path does not reach.
 */
export function pathRoot(
  pou: {
    readonly name: string
    readonly slots: readonly Named[]
    readonly globals: readonly Named[]
    readonly unlowered?: readonly (Omit<Named, "section"> & { readonly code: string; readonly message: string })[]
  },
  path: string,
): { global: boolean; slot: number; rest: PathSegment[] } {
  const parts = parsePath(path)
  const [head, member] = parts
  if (head?.kind !== "name") throw new Error(`no variable ${path} in ${pou.name}`)
  const own = pou.slots.findIndex((s) => namesVariable(s.name, head.name))
  if (own >= 0) return { global: false, slot: own, rest: parts.slice(1) }
  const globals = [
    ...pou.globals.flatMap((g, slot) => (g.section === "program" ? [] : [{ g, slot, refused: undefined }])),
    ...(pou.unlowered ?? []).map((g) => ({ g, slot: -1, refused: `${g.code}: ${g.message}` })),
  ]
  const reached = (found: (typeof globals)[number], rest: PathSegment[]) => {
    if (found.refused !== undefined) throw new Error(`${found.g.list}.${found.g.name} has no value — its declaration did not lower (${found.refused})`)
    return { global: true, slot: found.slot, rest }
  }
  const listed =
    member?.kind === "name" ? globals.find(({ g }) => g.list !== undefined && sameName(g.list, head.name) && namesVariable(g.name, member.name)) : undefined
  if (listed !== undefined) return reached(listed, parts.slice(2))
  const bare = globals.filter(({ g }) => namesVariable(g.name, head.name))
  const [only] = bare
  if (only === undefined) throw new Error(`no variable ${path} in ${pou.name}`)
  if (bare.length > 1) throw new Error(`${head.name} is ambiguous: ${bare.map(({ g }) => `${g.list}.${g.name}`).join(", ")}`)
  if (only.g.qualifiedOnly === true) throw new Error(`${head.name} is declared by the qualified_only list ${only.g.list} — name it ${only.g.list}.${only.g.name}`)
  return reached(only, parts.slice(1))
}
