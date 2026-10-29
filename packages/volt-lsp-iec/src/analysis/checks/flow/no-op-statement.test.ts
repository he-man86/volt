/**
 * no-op-statement (C0139) — a WARNING for an expression statement with no side effect.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../../../test/support/test-uri.js"
import { diagnose } from "../../../../test/support/diagnose.js"

const noop = (body: string): string[] => {
  const src = `PROGRAM P\nVAR i:INT; inst:FB;\nEND_VAR\n${body}\nEND_PROGRAM\nFUNCTION_BLOCK FB\nEND_FUNCTION_BLOCK`
  return diagnose(src)
    .filter((d) => d.code === "no-op-statement")
    .map((d) => d.message)
}

test("a bare reference statement is warned; a call is not", () => {
  expect(noop(`i;`)).toEqual(["The code 'i;\n' has no effect. Is this the intent?"])
  expect(noop(`inst();`)).toEqual([]) // a call has effect
})

// openspec lsp-field-false-positives 8 (class 2): the quote carries its line's break in the document's own spelling — a
// lone CR is one, as the lexer reads it (it quoted nothing); the replay compares every line end as LF (`comparable`)
test("the no-op quote carries a lone-CR or CRLF line end as it carries an LF", () => {
  const lines = (br: string): string[] =>
    diagnose(`PROGRAM P${br}VAR i:INT;${br}END_VAR${br}i;${br}i + 1;${br}END_PROGRAM`)
      .filter((d) => d.code === "no-op-statement" || d.code === "no-valid-statement")
      .map((d) => d.message)
  expect(lines("\r")).toEqual(["The code 'i;\r' has no effect. Is this the intent?", "'(i + 1);\r' is no valid statement"])
  expect(lines("\r\n")).toEqual(["The code 'i;\r\n' has no effect. Is this the intent?", "'(i + 1);\r\n' is no valid statement"])
})

test("an unresolved bare name is NOT a no-op (gibberish / stripped {IF} branch — the IDE doesn't warn)", () => {
  // Mirrors the conditional-compilation conformance fixtures: code inside a non-taken {IF defined(…)} branch
  // is stripped by the IDE and never compiled, so it must not surface a 'no effect' warning.
  expect(noop(`broken_first_branch_xyz;`)).toEqual([])
})

test("a statement RESUMED after a refused token is a no-op even when its name is declared nowhere (cc_time_*, lit_*)", () => {
  // `cc_time_nanosecond_literal`, `lit_bool_typed_true`: the compiler never resolves names in a body it could not parse,
  // yet warns "The code 'NS;' has no effect" — the parser marks the statement it resumed at (`ExprStatement.resumed`)
  expect(noop(`i := T#5NS;`)).toEqual(["The code 'NS;\n' has no effect. Is this the intent?"])
  expect(noop(`i := BOOL#TRUE;`)).toEqual(["The code 'RUE;\n' has no effect. Is this the intent?"])
})

const bare = (body: string): string[] => {
  const src = `PROGRAM P\nVAR a:INT; out:INT; rn : REFERENCE TO INT;\nEND_VAR\n${body}\nEND_PROGRAM\n`
  return diagnose(src)
    .filter((d) => d.code === "no-op-statement" || d.code === "no-valid-statement")
    .map((d) => `[${d.severity}] ${d.message}`)
}

test("a binary operation as a statement is no valid statement, an ERROR echoed as the compiler does (stmt_bare_binary, stmt_bare_comparison, ST5)", () => {
  expect(bare("a + 1;")).toEqual(["[error] '(a + 1);\n' is no valid statement"])
  expect(bare("out = a;")).toEqual(["[error] '(out = a);\n' is no valid statement"])
})

test("in a body that did not parse, a statement without its `;` is a no-op, and a resumed binary operation no valid statement (stmt_ref_eq_spaced, ST3/ST5)", () => {
  // `rn REF = m;`: "';' expected instead of 'REF'", then `rn` without its `;` and `REF = m;` resumed
  expect(bare("rn REF = a;")).toEqual(["[warning] The code 'rn;\n' has no effect. Is this the intent?", "[error] '(REF = a);\n' is no valid statement"])
})

test("a FUNCTION's name alone as a statement is an error beside the no-op warning (stmt_bare_function_name, ST5)", () => {
  // both vendors 2026-10-02: "FUNCTION 'F' referenced without parentheses '()'" and "The code 'F;' has no effect"
  const src = `FUNCTION Fn : INT\nVAR_INPUT\n\tx : INT;\nEND_VAR\nFn := x;\nEND_FUNCTION\n\nPROGRAM P\nVAR\n\ta : INT;\nEND_VAR\nFn;\nEND_PROGRAM\n`
  const pr = parseSource(src, { networkText: true }, "codesys")
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }], [], "codesys")
  const got = computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "no-op-statement" || d.code === "function-without-parens")
    .map((d) => `[${d.severity}] ${d.message}`)
  expect(got).toEqual(["[error] FUNCTION 'Fn' referenced without parentheses '()'", "[warning] The code 'Fn;\n' has no effect. Is this the intent?"])
})

test("a FUNCTION's name alone INSIDE that FUNCTION is its return variable: the no-op warning alone (stmt_function_own_name_bare, ST5)", () => {
  // CODESYS 2026-10-02: only "The code 'F;' has no effect" — no "referenced without parentheses"
  const src = `FUNCTION Fn : INT\nVAR_INPUT\n\tx : INT;\nEND_VAR\nFn := x;\nFn;\nEND_FUNCTION\n`
  const pr = parseSource(src, { networkText: true }, "codesys")
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }], [], "codesys")
  const got = computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "no-op-statement" || d.code === "function-without-parens")
    .map((d) => `[${d.severity}] ${d.message}`)
  expect(got).toEqual(["[warning] The code 'Fn;\n' has no effect. Is this the intent?"])
})

test("a call operator that took the next token for its `(` is no name standing without its `;` (lex_keyword_assigned_sys_delete …)", () => {
  // both vendors: "'(' expected instead of ':='", the operand count and the resync — and no "no effect"
  expect(bare("__delete := 1;\n__queryinterface := 1;")).toEqual([])
})

test("an array element indexed by a CALL is a no-op all the same — the vendors warn it (qf_c0139_absent_call)", () => {
  // both vendors 2026-10-12: "The code 'list[F_…_idx()];' has no effect" — the call inside does not make it a statement
  const src = `FUNCTION F_idx : INT\nF_idx := 1;\nEND_FUNCTION\nPROGRAM P\nVAR list : ARRAY[1..3] OF INT;\nEND_VAR\nlist[F_idx()];\nEND_PROGRAM\n`
  const pr = parseSource(src, { networkText: true }, "codesys")
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }], [], "codesys")
  const found = computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "no-op-statement")
    .map((d) => d.message)
  expect(found).toEqual(["The code 'list[F_idx()];\n' has no effect. Is this the intent?"])
})

test("a NESTED array element is a no-op whichever subscript holds the call (qf_c0139_absent_call_nested)", () => {
  // both vendors 2026-10-12 warn `m[F()][1];` and `m[1][F()];` alike
  const src = `FUNCTION F_idx : INT\nF_idx := 1;\nEND_FUNCTION\nPROGRAM P\nVAR m : ARRAY[1..3] OF ARRAY[1..3] OF INT;\nEND_VAR\nm[F_idx()][1];\nm[1][F_idx()];\nEND_PROGRAM\n`
  const pr = parseSource(src, { networkText: true }, "codesys")
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }], [], "codesys")
  const found = computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "no-op-statement")
    .map((d) => d.message)
  expect(found).toEqual(["The code 'm[F_idx()][1];\n' has no effect. Is this the intent?", "The code 'm[1][F_idx()];\n' has no effect. Is this the intent?"])
})
