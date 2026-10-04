/**
 * THE RETIRED `(* @volt-… *)` COMMENTS (rule FMT7) — an older Volt's boundary and marker comments: a comment to the
 * IDE, reported nowhere, and read only as the hint of a body that states no language (`server/diagnostics.ts`).
 */
import { expect, test } from "bun:test"
import { isGraphicalBody, lex, parseSource, bodyStatements, unitBodies } from "../index.js"
import { retiredCommentIn } from "./retired-comments.js"

/** A function block whose body is `impl` — its boundary line and what follows it. */
const fb = (impl: string): string =>
  `FUNCTION_BLOCK F\nVAR\n\ta : BOOL;\n\tout : BOOL;\nEND_VAR\n${impl}\nEND_FUNCTION_BLOCK\n`

/** Every syntax error of a file: its declarations' (the top-level parse) and each ST body's, as the `parse-errors`
 *  check drains them. A graphical body is the network parser's. */
function syntaxErrors(src: string): string[] {
  const parsed = parseSource(src, { networkText: true })
  const bodies = parsed.units.flatMap(unitBodies).filter((b) => !isGraphicalBody(b))
  return [...parsed.errors, ...bodies.flatMap((b) => bodyStatements(b).errors)].map((e) => e.message)
}

test("a (* @volt-… *) comment in a file that states its bodies is a comment: nothing is reported", () => {
  // The push writes it as sent (openspec bridge-refusal-review 1.4/2.1) and both builds are clean
  // (`rcc_retired_comment_in_body`, `pwh_gvl_retired_volt_comment`, 2026-10-04). Reporting it "as the push refuses it"
  // was an LSP-only message.
  const clean = {
    "in an ST body": fb("IMPLEMENTATION ST\n(* @volt-x *)\nout := a;"),
    "the retired marker in a member": `${fb("IMPLEMENTATION ST\n")}\nMETHOD M\nIMPLEMENTATION ST\n(* @volt-graphical: CFC *)\nEND_METHOD\n`,
    "nested, another case": fb("IMPLEMENTATION ST\n(* doc (*  @VOLT-implementation *) *)\nout := a;"),
    "in a declaration": "FUNCTION_BLOCK F\nVAR\n\ta : BOOL; (* @volt-implementation *)\nEND_VAR\nIMPLEMENTATION ST\na := TRUE;\nEND_FUNCTION_BLOCK\n",
    "above the header": "(* @volt-impl *)\nFUNCTION_BLOCK F\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := 1;\nEND_FUNCTION_BLOCK\n",
  }
  for (const [where, src] of Object.entries(clean)) expect({ where, errors: syntaxErrors(src) }).toEqual({ where, errors: [] })
})

test("the hint reads a (* @volt-… *) comment only: a comment of any depth and case, never text after // or in a string", () => {
  const found = (src: string): string | undefined => retiredCommentIn(lex(src, "codesys"))
  expect(found("(* @volt-implementation LD *)\nNETWORK")).toBe("(* @volt-implementation LD *)")
  expect(found("(* doc (*  @VOLT-implementation *) *)")).toBe("(*  @VOLT-implementation *)")
  expect(found("// (* @volt-implementation *)\nout := a;")).toBeUndefined()
  expect(found("txt := '(* @volt-implementation *)';")).toBeUndefined()
})

test("the hint is cut on the comment's OPENING LINE, as the push cuts it: at its `*)` there, or at the line's end", () => {
  // `ImplementationMarker.FindRetiredComment` reads one line: the text from `(*` to the first `*)` on that line, or to
  // its end — so the "states no language" finding quotes what the push's refusal quotes (review 5+6: the LSP took the
  // whole comment token, newlines and later lines included).
  const found = (src: string): string | undefined => retiredCommentIn(lex(src, "codesys"))
  expect(found("(* @volt-implementation\n LD *)\nout := a;")).toBe("(* @volt-implementation")
  expect(found("(* @volt-x *) more (* text\n*)")).toBe("(* @volt-x *)")
  // the tag stands on the opening's own line, as the push looks for it: one a line below it is not the retired tag
  expect(found("(*\n@volt-implementation *)")).toBeUndefined()
})
