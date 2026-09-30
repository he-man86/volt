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
import { implementationLine, parseSource, type BodySpan, type TopLevel } from "../../../src/frontend/syntax/index.js"

/** The line an ST fixture body is pushed under — `syntax/format/implementation-line`'s one spelling. */
export const IMPLEMENTATION_ST = implementationLine("ST")

/** Offsets in `source` where an `IMPLEMENTATION ST` line belongs (`lineUnder`), ascending. */
function boundaries(source: string): number[] {
  const at: number[] = []
  for (const unit of parseSource(source, { networkText: true }).units) push(unit, at)
  return at.sort((a, b) => a - b)
}

/**
 * Where the line goes for a body that states none: the start of the first non-blank line UNDER the declaration's last
 * line. The body's tokens begin right after the declaration's last token, so they open with whatever else stands on
 * that line — a trailing comment or pragma after `END_VAR` — and that belongs to the declaration: the line goes under
 * it, never above it (where `END_VAR` would become body code). Code on that line (`VAR x : INT; END_VAR x := 1;`) leaves no line
 * between the halves to write the keyword on, and is refused rather than split at a place someone made up.
 */
function lineUnder(body: BodySpan): number {
  const tokens = body.tokens
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.kind === "whitespace" && t.text.includes("\n")) {
      // Blank lines under the declaration stay above the line, as they always have: the recordings were made with them
      // there, and a blank line is nobody's code. The line goes at the start of the first line holding anything.
      let blank = ""
      for (let j = i; j < tokens.length && tokens[j].kind === "whitespace"; j++) blank += tokens[j].text
      return t.span.start + blank.lastIndexOf("\n") + 1
    }
    if (t.kind === "line_comment" || t.kind === "block_comment" || t.kind === "pragma" || t.kind === "whitespace") continue
    break
  }
  throw new Error(
    `the body at line ${body.span.startLine} shares a line with the end of its declaration, so there is no line ` +
      `between the two to write '${IMPLEMENTATION_ST}' on. Put the body on its own line in the fixture.`,
  )
}

function push(unit: TopLevel, at: number[]): void {
  // A body that already states its language — a graphical fixture opens with `IMPLEMENTATION FBD|LD` — keeps its own
  // line: a second one above it would be a second boundary, which the push refuses.
  const mark = (body: BodySpan): void => {
    if (body.implementation === undefined) at.push(lineUnder(body))
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
 * A body's span STARTS right after the declaration's last token, still ON that token's line, so the line is written at
 * the start of the NEXT line (`lineUnder`). Both earlier placements wrote it above a declaration line: walking back
 * from the span start landed on the line holding `END_VAR` (measured live: "'END_VAR' expected instead of ''" and five
 * more), and walking forward to the body's first character first still did whenever that character was a trailing
 * comment on the `END_VAR` line.
 */
export function markImplementations(source: string): string {
  let out = source
  for (const lineStart of boundaries(source).reverse())
    out = out.slice(0, lineStart) + IMPLEMENTATION_ST + "\n" + out.slice(lineStart)
  return out
}
