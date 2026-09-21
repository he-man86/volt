/**
 * unknown-source — the IDE's error propagation: what a hole in the types broke. Wording recorded live on CODESYS SP21
 * (conformance `cc_unknown_member`, `deref_on_array_type`, `cc3_multiple_inheritance`, `fbcall_this_in_program`).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { Vendor } from "../../config.js"

// THE VENDOR HAS TO REACH ALL THREE. The dialect is read when LEXING (a CODESYS-only keyword is an ordinary
// identifier on TwinCAT), when RESOLVING (`project.dialect` is what makes `LDATE` unresolvable there) and when
// WORDING. Passing it to `resolveConfig` alone got the wording right and left the other two on CODESYS, which
// is a harness that cannot fail for the shapes this file is about.
function msgs(src: string, vendor: Vendor = "codesys"): string[] {
  const parseResult = parseSource(src, vendor)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }], [], vendor)
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "unknown-source")
    .map((d) => d.message)
}
const fb = (decls: string, body: string) => `FUNCTION_BLOCK F\nVAR\n${decls}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK`

test("an assignment whose source has no type names the hole and the destination", () => {
  expect(msgs(fb("y : INT;", "y := nope;"))).toEqual(["Cannot convert type 'Unknown type: 'nope'' to type 'INT'"])
  expect(msgs(fb("arr : ARRAY[0..1] OF INT; x : INT;", "x := arr^;"))).toEqual([
    "Cannot convert type 'Unknown type: 'arr^'' to type 'INT'",
  ])
})

test("an operator's operand that has no type is named on its own, and the operation is parenthesized", () => {
  // the compiler echoes every binary with parentheses it was not written with (`one + two` → `(one + two)`)
  expect(msgs(fb("one : INT; own : INT;", "own := one + two;"))).toEqual([
    "Cannot convert type 'Unknown type: '(one + two)'' to type 'INT'",
    "Unknown type: 'two'",
  ])
})

test("an inference GAP is not a hole — only a name that does not resolve is", () => {
  // Why this gate exists: reporting on any unknown type produced 30 false positives at once. A mixed-sign operation
  // and an untyped integer literal are types the LSP does not MEET yet; the compiler types both without trouble.
  expect(msgs(fb("si : INT; un : UINT; res : DINT;", "res := si AND un;"))).toEqual([])
  expect(msgs(fb("n : INT;", "n := 1;"))).toEqual([])
  // a wrong index COUNT is not a lost type either (conformance `cc2_indexing_and_arity`)
  expect(msgs(fb("grid : ARRAY[1..2, 1..2] OF INT; taken : INT;", "taken := grid[1];"))).toEqual([])
})

// TWINCAT MEASURED, 2026-09-20: `cc2_constant_and_external` records all ten of these messages on BOTH vendors,
// in the same order, and `cc_unknown_member` the same pair. The "unmeasured" note predates its recording.
test("TwinCAT loses a type the same way", () => {
  expect(msgs(fb("y : INT;", "y := nope;"), "twincat").length).toBeGreaterThan(0)
})

test("a hole on the LEFT is not a conversion — and a member read off one has no structure", () => {
  // `THIS^.x` in a PROGRAM: the LSP resolves it to that program's `x`, the compiler refuses the whole expression
  // (conformance `fbcall_this_in_program`).
  const prg = `PROGRAM P\nVAR\nx : INT;\nEND_VAR\nTHIS^.x := THIS^.x + 3;\nEND_PROGRAM`
  expect(msgs(prg).sort()).toEqual([
    "'THIS^' is no structured variable",
    "'THIS^' is no structured variable",
    "'THIS^.x' is no valid assignment target",
    "Unknown type: 'THIS^.x'",
  ])
})

test("a VAR_EXTERNAL with no global is DROPPED, so its uses carry the hole", () => {
  // Why missed: the dangling declaration was reported and then the name went on resolving, so six of the ten errors
  // CODESYS gives for one such name were missing (conformance `cc2_constant_and_external`).
  const src = `FUNCTION_BLOCK F\nVAR_EXTERNAL\ngNoSuch : INT;\nEND_VAR\nVAR\nn : INT;\nm : INT;\nEND_VAR\nn := gNoSuch + m;\nEND_FUNCTION_BLOCK`
  expect(msgs(src).sort()).toEqual([
    "Cannot convert type 'Unknown type: '(gNoSuch + m)'' to type 'INT'",
    "Unknown type: 'gNoSuch'",
  ])
})

// A TARGET THE VENDOR CANNOT RESOLVE EITHER STILL GETS THE CONVERSION ERROR — spelled with the name it could not
// resolve. `LDATE`/`LTOD`/`LDT` are CODESYS's 64-bit date types; TwinCAT has none of them, and it reports the
// declaration AND the assignment into it (conformance `xf_date_to_ldate` and eight siblings, twincat 2026-09-20).
//
// The skip this replaced was `target.kind !== "unknown"`, which is still right everywhere else: an unresolved type
// is normally a library the LSP cannot see, and there the LSP has nothing to say.
test("an unresolvable TARGET is named, but only where the vendor provably lacks it", () => {
  const xf = (t: string, fn: string) => fb(`v : DATE;
out : ${t};`, `out := ${fn}(v);`)

  expect(msgs(xf("LDATE", "DATE_TO_LDATE"), "twincat")).toEqual([
    "Cannot convert type 'Unknown type: 'DATE_TO_LDATE(v)'' to type 'LDATE'",
  ])
  // on CODESYS LDATE resolves, so there is no hole on either side and nothing to say
  expect(msgs(xf("LDATE", "DATE_TO_LDATE"), "codesys")).toEqual([])

  // THE LIBRARY FLOOR, unmoved: a type the LSP simply cannot see is not a type the VENDOR cannot see
  expect(msgs(fb("out : LCon.T_SomeLibType;", "out := SomeLibCall(1);"), "twincat")).toEqual([])

  // …and a project that SHIMS the name never reaches the fallback at all — `TYPE LDATE : ULINT;` is what a
  // TwinCAT project porting CODESYS code writes, the target resolves, and the message names what it resolved
  // TO. The call is still undefined, so there is still a conversion error; it just is not about `LDATE`.
  const shimmed = `TYPE LDATE : ULINT; END_TYPE
${xf("LDATE", "DATE_TO_LDATE")}`
  expect(msgs(shimmed, "twincat")).toEqual(["Cannot convert type 'Unknown type: 'DATE_TO_LDATE(v)'' to type 'ULINT'"])
})
