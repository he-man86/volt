/**
 * THE RETIRED `(* @volt-… *)` COMMENTS (rule FMT7) — an older Volt's boundary and marker comments, reported naming
 * `volt pull` wherever they stand, as the push refuses a file holding one.
 */
import { expect, test } from "bun:test"
import { isGraphicalBody, parseSource, parseStatements, unitBodies } from "../index.js"

/** A function block whose body is `impl` — its boundary line and what follows it. */
const fb = (impl: string): string =>
  `FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\n\tout : BOOL;\nEND_VAR\n${impl}\nEND_FUNCTION_BLOCK\n`

/** Every syntax error of a file: its declarations' (the top-level parse) and each ST body's, as the `parse-errors`
 *  check drains them. A graphical body is the network parser's. */
function syntaxErrors(src: string): string[] {
  const parsed = parseSource(src, { networkText: true })
  const bodies = parsed.units.flatMap(unitBodies).filter((b) => !isGraphicalBody(b))
  return [...parsed.errors, ...bodies.flatMap((b) => parseStatements(b).errors)].map((e) => e.message)
}

test("a (* @volt-… *) comment is an older Volt's, reported naming `volt pull` wherever it stands — as the push refuses it", () => {
  // No Volt writes one any more (the push: `ImplementationMarker.FindRetiredComment`). A comment only — outermost or
  // nested — and in any case; the same characters after `//` or in a string are text.
  const reported = {
    "the retired boundary": fb("(* @volt-implementation LD *)\nNETWORK\nout := a;\nEND_NETWORK\n"),
    "the retired marker": `${fb("IMPLEMENTATION ST\n")}\nMETHOD M\nIMPLEMENTATION ST\n(* @volt-graphical: CFC *)\nEND_METHOD\n`,
    "nested, another case": fb("IMPLEMENTATION ST\n(* doc (*  @VOLT-implementation *) *)\nout := a;\n"),
    "in a declaration": "FUNCTION_BLOCK F\nVAR\n\ta : BOOL; (* @volt-implementation *)\nEND_VAR\nIMPLEMENTATION ST\na := TRUE;\nEND_FUNCTION_BLOCK\n",
  }
  for (const [where, src] of Object.entries(reported))
    expect({ where, named: syntaxErrors(src).filter((m) => m.includes("volt pull")).length }).toEqual({ where, named: 1 })
  const text = {
    "a line comment": fb("IMPLEMENTATION ST\n// (* @volt-implementation *)\nout := a;\n"),
    "a string": "FUNCTION_BLOCK F\nVAR\n\ts : STRING := '(* @volt-implementation *)';\nEND_VAR\nIMPLEMENTATION ST\ns := '';\nEND_FUNCTION_BLOCK\n",
  }
  for (const [where, src] of Object.entries(text)) expect({ where, errors: syntaxErrors(src) }).toEqual({ where, errors: [] })
})
