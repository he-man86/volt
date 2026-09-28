/**
 * Write `IMPLEMENTATION ST` into a fixture's ST at the boundary the PARSER already knows.
 *
 * **Why this exists.** A Volt workspace file states where its declaration ends, and in what language its body is,
 * because the vendors keep the two halves apart (`WriteSourceText(native, declaration, implementation)` takes them as
 * two arguments) and a Volt file holds one text. The bridge used to INFER the split — the last `END_VAR`, then a rule
 * about which trailing comments and pragmas belonged to which side — and every one of those rules was written after a
 * data bug. The inference is gone: a push without the `IMPLEMENTATION <LANG>` line is refused.
 *
 * The conformance fixtures are hand-written ST, so they carry no line, and the language recorder pushes them
 * through the bridge. Without this they are all refused.
 *
 * **This is not the deleted inference coming back.** `asUnit`/`asMember` in `fixture-units.ts` already split every
 * fixture into `declaration` and `implementation` at `unit.body.span.start` — the offset the PARSER reports, from
 * the same frontend the LSP analyses with. The line goes exactly there. Nothing is guessed, no keyword is hunted
 * for, and a fixture whose shape the parser cannot make sense of gets no line and is refused loudly rather than
 * pushed with a boundary someone made up.
 *
 * **Which units get one** mirrors `ImplementationMarker.AppliesTo` (`Volt.Engine/Format/St/ImplementationMarker.cs`):
 * everything with an implementation to separate. A GVL and a DUT are a declaration and nothing else; an INTERFACE
 * and its members are SIGNATURES, so there is no boundary to record and a line would invent one.
 */
import { implementationLine, parseSource, type BodySpan, type TopLevel } from "../../../src/syntax/index.js"

/** The line an ST fixture body is pushed under — `syntax/implementation-keyword`'s one spelling. */
export const IMPLEMENTATION_ST = implementationLine("ST")

/** Offsets in `source` where an `IMPLEMENTATION ST` line belongs, ascending. */
function boundaries(source: string): number[] {
  const at: number[] = []
  for (const unit of parseSource(source).units) push(unit, at)
  return at.sort((a, b) => a - b)
}

function push(unit: TopLevel, at: number[]): void {
  // A body that already states its language — a graphical fixture opens with `IMPLEMENTATION FBD|LD` — keeps its own
  // line: a second one above it would be a second boundary, which the push refuses.
  const mark = (body: BodySpan): void => {
    if (body.implementation === undefined) at.push(body.span.start)
  }
  switch (unit.kind) {
    // A POU and its code-bearing members: the declaration runs to the body's first token.
    case "function_block":
    case "program":
    case "function":
    case "method":
    case "action":
      mark(unit.body)
      return
    // A property has no body of its own — each ACCESSOR does, and they split independently.
    case "property":
      if (unit.getter !== undefined) mark(unit.getter.body)
      if (unit.setter !== undefined) mark(unit.setter.body)
      return
    // interface / global_var_list / type_decl / namespace — no implementation, so no boundary to state.
    default:
      return
  }
}

/**
 * `source` with an `IMPLEMENTATION ST` line written above each implementation that states no language.
 *
 * Inserted back-to-front so an earlier offset is never shifted by a later insertion, and always on its own line:
 * the line is matched WHOLE (`ImplementationMarker.Is`: the keyword, the language and nothing else), so appending it
 * to the end of a declaration's last line would make it invisible to the reader and the file unpushable.
 *
 * A body's span STARTS ON THE NEWLINE that ends the declaration's last line, not on the body's first character —
 * `END_VAR` at offset 73..80 gives `body.span.start === 80`, the `\n` after it. Walking back to a line start from
 * there lands on the line holding `END_VAR` and writes the line ABOVE it, inside the variable block: measured
 * live (with the comment marker this line replaced), that produced "'END_VAR' expected instead of ''" and five more.
 * So the walk goes FORWARD over whitespace to the body's first real character first, and only then back to that
 * character's own line.
 */
export function markImplementations(source: string): string {
  let out = source
  for (const offset of boundaries(source).reverse()) {
    let first = offset
    while (first < out.length && /\s/.test(out[first]!)) first += 1
    const lineStart = out.lastIndexOf("\n", Math.max(0, first - 1)) + 1
    out = out.slice(0, lineStart) + IMPLEMENTATION_ST + "\n" + out.slice(lineStart)
  }
  return out
}
