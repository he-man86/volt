/**
 * THE STATEMENT PARSER against what CODESYS records (openspec frontend-conformance, task 2.1). One test per recorded
 * shape; the fixture that recorded it is named in the title.
 */
import { expect, test } from "bun:test"
import { lex } from "../lex/lexer.js"
import type { BodySpan } from "../ast/nodes.js"
import { parseStatements } from "./body-parse.js"

/** The errors a body snippet parses with — message, and the vendor-worded token where the message is its shape. */
function errors(body: string): string[] {
  const toks = lex(body, "codesys").filter((t) => t.kind !== "eof")
  const span = { start: 0, end: body.length, startLine: 1, startCol: 0, endLine: 1, endCol: 0 }
  return parseStatements({ kind: "body", tokens: toks, span } satisfies BodySpan).errors.map((e) => e.message)
}

const refusedAssignment = (name: string): string[] => [
  `Unexpected token '${name}' found`,
  "';' expected instead of ':='",
  "Unexpected token ':=' found",
  "';' expected instead of '1'",
  "Unexpected token '1' found",
]

test("a reserved word assigned to at statement start is refused on the word, then a pair per token to the `;` (lex_limit_as_variable, L14)", () => {
  for (const w of ["limit", "min", "sel", "mux", "max"]) expect(errors(`${w} := 1;\nn := 2;`)).toEqual(refusedAssignment(w))
})

test("so is every other keyword no statement starts with (lex_reserved_unused_keyword_as_name_*, lex_ini_keyword, L13/L15)", () => {
  for (const w of ["read_only", "read_write", "from", "params", "ini"]) expect(errors(`${w} := 1;`)).toEqual(refusedAssignment(w))
})

test("an access or inheritance modifier assigned to is refused the same way (lex_soft_keyword_name_public, L12)", () => {
  for (const w of ["public", "private", "protected", "internal", "final", "abstract"])
    expect(errors(`${w} := 1;`)).toEqual(refusedAssignment(w))
})

test("GET, SET and OVERRIDE are names a statement may assign (lex_soft_keyword_name_get/_set/_override, L12)", () => {
  for (const w of ["get", "set", "override"]) expect(errors(`${w} := 1;`)).toEqual([])
})

test("CAL starts no ST statement: the word is refused and the call after it parses on its own (lex_cal_keyword, L15)", () => {
  // the cascade stops at `t`, which can start a statement: "';' expected instead of 't'" and `t();` is read as a call
  expect(errors("CAL t();")).toEqual(["Unexpected token 'CAL' found", "';' expected instead of 't'"])
})

test("so is CAL assigned as a variable (cc_il_name_cal, L15)", () => {
  expect(errors("cal := 1;")).toEqual(refusedAssignment("cal"))
})

test("the words a statement does start with are not refused", () => {
  expect(errors("THIS^.n := 1;\nSUPER^();\nn := LIMIT(0, n, 10);\nNOT n;\nTRUE;\n")).toEqual([])
})

test("the cascade stops at GET/SET/OVERRIDE as it stops at any name (lex_cascade_meets_soft_name_get/_set/_override, L12)", () => {
  // Both vendors, `limit := set;` with `set` declared: the refused `limit`, a pair for `:=`, then "';' expected instead
  // of 'set'" and `set` is NOT echoed as an unexpected token — the statement resumes there, and its fifth message, "The
  // code 'set;' has no effect", is the resumed statement's (the no-op check), not this cascade's.
  for (const w of ["get", "set", "override"]) {
    const e = errors(`limit := ${w};`)
    expect(e).toEqual(["Unexpected token 'limit' found", "';' expected instead of ':='", "Unexpected token ':=' found", `';' expected instead of '${w}'`])
  }
})

test("a keyword that is no operand is refused where a value belongs, then the statement cascade (lex_keyword_operand_*, lex_cal_declared_operand, L9)", () => {
  // CODESYS, `n := cal;`: "Expression expected instead of 'cal'", then the pair a refused statement gets for the word
  for (const w of ["cal", "public", "string", "end_if", "then", "add", "params", "from", "__catch"])
    expect(errors(`n := ${w};`)).toEqual([
      `Expression expected instead of '${w}'`,
      `';' expected instead of '${w}'`,
      `Unexpected token '${w}' found`,
    ])
})

test("a modifier as a named argument is refused as an operand, and the cascade runs to the `;` (lex_soft_keyword_named_argument_*, L12)", () => {
  expect(errors("t(Public := TRUE);")).toEqual([
    "Expression expected instead of 'Public'",
    "';' expected instead of 'Public'",
    "Unexpected token 'Public' found",
    "';' expected instead of ':='",
    "Unexpected token ':=' found",
    "';' expected instead of 'TRUE'",
    "Unexpected token 'TRUE' found",
    "';' expected instead of ')'",
    "Unexpected token ')' found",
  ])
})

test("a binary operator word where an operand belongs is taken as the operator, and its missing right operand named (lex_keyword_operand_and …, L9)", () => {
  for (const w of ["and", "and_then", "or", "or_else", "xor", "mod"])
    expect(errors(`n := ${w};`)).toEqual([`Expression expected instead of '${w}'`, "Expression expected instead of ';'"])
})

test("NON_RETAIN is a NAME where a statement starts — CODESYS has no such keyword (lex_keyword_assigned_non_retain, L9)", () => {
  // the vendor answers "Identifier 'non_retain' not defined" and "'non_retain' is no valid assignment target": a name
  expect(errors("non_retain := 1;")).toEqual([])
})

test("the system operators that open a call are not refused as a word where a statement starts (lex_keyword_assigned_sys_delete …, L9)", () => {
  // CODESYS demands their `(` instead — "'(' expected instead of ':='" and an operand count — which is the call rule's
  // (task 2.5.6); what is measured HERE is that the word itself is not "Unexpected token".
  for (const w of ["__delete", "__queryinterface", "__querypointer", "__currenttask", "__pool"])
    for (const body of [`${w} := 1;`, `${w} n := 2;`]) expect(errors(body)).not.toContain(`Unexpected token '${w}' found`)
})

test("a call operator without its `(` takes the next token for it, and names its operand count (lex_keyword_operand_abs …, L9)", () => {
  // CODESYS, `n := abs;`: "'(' expected instead of ';'", "'ABS' needs exactly '1' operands", and — the `;` taken —
  // "';' expected instead of end of POU"
  const bare = (w: string, needs: string): void =>
    expect(errors(`n := ${w};`)).toEqual(["'(' expected instead of ';'", `'${w.toUpperCase()}' needs ${needs} operands`, "';' expected instead of end of POU"])
  bare("abs", "exactly '1'")
  bare("shl", "exactly '2'")
  bare("sel", "exactly '3'")
  bare("min", "at least '2'")
  bare("mux", "at least '3'")
  bare("__xadd", "exactly '2'")
})

test("so does one that opens a statement: `__QUERYINTERFACE := 1;` takes the `:=` (lex_keyword_assigned_sys_queryinterface, _before_name_, L9)", () => {
  expect(errors("__queryinterface := 1;")).toEqual([
    "'(' expected instead of ':='",
    "'__QUERYINTERFACE' needs exactly '2' operands",
    "';' expected instead of '1'",
    "Unexpected token '1' found",
  ])
  expect(errors("__queryinterface n := 2;")).toEqual(["'(' expected instead of 'n'", "'__QUERYINTERFACE' needs exactly '2' operands"])
})
