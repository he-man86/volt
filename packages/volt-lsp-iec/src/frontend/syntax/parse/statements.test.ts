/**
 * THE STATEMENT PARSER against what CODESYS records (openspec frontend-conformance, task 2.1). One test per recorded
 * shape; the fixture that recorded it is named in the title.
 */
import { expect, test } from "bun:test"
import { lex } from "../lex/lexer.js"
import type { BodySpan } from "../ast/nodes.js"
import type { Dialect } from "../lex/vocabulary.js"
import { bodyStatements } from "./body-parse.js"

/** The errors a body snippet parses with — message, and the vendor-worded token where the message is its shape. */
function errors(body: string, dialect: Dialect = "codesys"): string[] {
  const toks = lex(body, dialect).filter((t) => t.kind !== "eof")
  const span = { start: 0, end: body.length, startLine: 1, startCol: 0, endLine: 1, endCol: 0 }
  return bodyStatements({ kind: "body", tokens: toks, span } satisfies BodySpan).errors.map((e) => e.message)
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
  expect(errors("THIS^.n := 1;\nSUPER^();\nn := LIMIT(0, n, 10);\n.g := 1;\n")).toEqual([])
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

// ─── the dialect vocabulary (task 2.1.4, L10/L11) ──────────────────────────────────────────────────────────────────

test("__VECTOR is a CODESYS keyword: refused where a statement starts and where a value belongs (lex_keyword_*_sys_vector, L11)", () => {
  // CODESYS, 2026-09-30: the three statement positions answer exactly as every other reserved word does
  expect(errors("__vector := 1;\nn := 2;")).toEqual(refusedAssignment("__vector"))
  expect(errors("__vector n := 2;")).toEqual(["Unexpected token '__vector' found", "';' expected instead of 'n'"])
  expect(errors("n := __vector;")).toEqual([
    "Expression expected instead of '__vector'",
    "';' expected instead of '__vector'",
    "Unexpected token '__vector' found",
  ])
})

test("on TwinCAT the CODESYS-only words are names: no parse error in any statement position (lex_keyword_*_sys_{vector,position,pouname,compare_and_swap}, lex_codesys_only_keyword_twincat_names, L10)", () => {
  // TwinCAT, 2026-09-30: "Identifier '__vector' not defined" and the like — the binder's answer, not the parser's
  for (const w of ["__vector", "__position", "__pouname", "__compare_and_swap"]) {
    expect(errors(`${w} := 1;`, "twincat")).toEqual([])
    expect(errors(`n := ${w};`, "twincat")).toEqual([])
  }
})

// ─── a MALFORMED literal where an operand belongs (frontend-conformance 2.2) ─────────────────────────────────────────
// The token the lexer refused (`Token.malformed`) is refused as the keywords of `NOT_AN_OPERAND` are: "Expression
// expected instead of 'X'", then the statement's resync from it — a pair per token, a name ending it.

const refusedLiteral = (text: string): string[] => [
  `Expression expected instead of '${text}'`,
  `';' expected instead of '${text}'`,
  `Unexpected token '${text}' found`,
]

/** The statements of a body snippet. */
function statements(body: string) {
  const toks = lex(body, "codesys").filter((t) => t.kind !== "eof")
  const span = { start: 0, end: body.length, startLine: 1, startCol: 0, endLine: 1, endCol: 0 }
  return bodyStatements({ kind: "body", tokens: toks, span } satisfies BodySpan).statements
}

test("a malformed literal is refused whole, and the tokens after it resync as after a refused word (lit_*)", () => {
  // `lit_invalid_base_3`, `lit_int_typed_plus`, `lit_int_typed_negative_based`, `lit_real_no_fraction_digit`, `lit_bool_typed_2`
  expect(errors("v := 3#12;")).toEqual([...refusedLiteral("3#"), "';' expected instead of '12'", "Unexpected token '12' found"])
  expect(errors("v := INT#+5;")).toEqual([
    ...refusedLiteral("INT#"),
    "';' expected instead of '+'", "Unexpected token '+' found",
    "';' expected instead of '5'", "Unexpected token '5' found",
  ])
  expect(errors("v := INT#-16#10;")).toEqual([
    ...refusedLiteral("INT#-16"),
    "';' expected instead of '#'", "Unexpected token '#' found",
    "';' expected instead of '10'", "Unexpected token '10' found",
  ])
  expect(errors("v := 5.;")).toEqual(refusedLiteral("5."))
  expect(errors("v := BOOL#2;")).toEqual(refusedLiteral("BOOL#2"))
  // a WSTRING with a short hex escape, the same way
  expect(errors('v := "$41";')).toEqual(refusedLiteral('"$41"'))
})

test("a name after a refused literal ends its cascade and starts a statement of its own, marked resumed (cc_time_*, lit_*)", () => {
  // `cc_time_nanosecond_literal`: "';' expected instead of 'NS'", then `NS;` is a statement — the vendor warns it has
  // no effect, a name nothing declares or not (`flow/no-op-statement` reads the mark)
  expect(errors("t1 := T#5NS;")).toEqual([...refusedLiteral("T#5"), "';' expected instead of 'NS'"])
  expect(errors("v := BOOL#TRUE;")).toEqual([...refusedLiteral("BOOL#T"), "';' expected instead of 'RUE'"])
  expect(errors("v := T#-10ms;")).toEqual([
    ...refusedLiteral("T#"),
    "';' expected instead of '-'", "Unexpected token '-' found",
    "';' expected instead of '10'", "Unexpected token '10' found",
    "';' expected instead of 'ms'",
  ])
  expect(statements("v := BOOL#TRUE;")).toMatchObject([{ kind: "expr_stmt", resumed: true, expr: { kind: "ident_expr", name: "RUE" } }])
  // an ordinary bare statement is not resumed
  expect(statements("RUE;")[0]).not.toHaveProperty("resumed")
})

test("an address with a size and no position is no operand and no target in a body either (A2)", () => {
  // CODESYS 2026-10-01: `lit_address_no_position_in_body` (`out := %MW;`), `lit_address_sized_star_in_body`
  // (`out := %IW*2;` — `%IW`, then `*`), `lit_address_no_position_as_target` (`%MW := 1;`)
  // (the parser's order: the refusal, then the pair a refused statement gets for the word — as `n := cal;` above)
  expect(errors("out := %MW;")).toEqual(["Expression expected instead of '%MW'", "';' expected instead of '%MW'", "Unexpected token '%MW' found"])
  expect(errors("out := %IW*2;")).toEqual([
    "Expression expected instead of '%IW'", "';' expected instead of '%IW'", "Unexpected token '%IW' found",
    "';' expected instead of '*'", "Unexpected token '*' found", "';' expected instead of '2'", "Unexpected token '2' found",
  ])
  expect(errors("%MW := 1;")).toEqual(refusedAssignment("%MW"))
})

// ─── the statements, rule by rule (frontend-conformance 2.6, ST1–ST19; both vendors 2026-10-02) ──────────────────────

test("`S=`, `R=` and `REF=` are one operator in any case: `x s= y`, `x r= y`, `rn ref= m` (stmt_s_eq_lower_case, stmt_ref_eq_lower_case, ST2/ST3)", () => {
  expect(errors("x s= y;\nx r= y;\nrn ref= m;")).toEqual([])
  expect(statements("x s= y;\nx r= y;\nrn ref= m;").map((s) => (s.kind === "assign" ? s.op : s.kind))).toEqual(["S=", "R=", "REF="])
})

test("a token no statement starts with is refused where a statement starts, then the resync (stmt_assign_literal_target, stmt_bare_*, stmt_assign_paren_target, ST1/ST5)", () => {
  expect(errors("1 := a;")).toEqual(["Unexpected token '1' found", "';' expected instead of ':='", "Unexpected token ':=' found", "';' expected instead of 'a'"])
  expect(errors("5;")).toEqual(["Unexpected token '5' found"])
  expect(errors("TRUE;")).toEqual(["Unexpected token 'TRUE' found"])
  expect(errors("NOT x;")).toEqual(["Unexpected token 'NOT' found", "';' expected instead of 'x'"])
  expect(errors("-a;")).toEqual(["Unexpected token '-' found", "';' expected instead of 'a'"])
  // `(a);`: the `(` refused, `a` resumes a statement whose `;` is missing at the `)`
  expect(errors("(a);")).toEqual(["Unexpected token '(' found", "';' expected instead of 'a'", "';' expected instead of ')'", "Unexpected token ')' found"])
  expect(errors("(out) := a;")).toEqual([
    "Unexpected token '(' found", "';' expected instead of 'out'",
    "';' expected instead of ')'", "Unexpected token ')' found", "';' expected instead of ':='", "Unexpected token ':=' found",
    "';' expected instead of 'a'",
  ])
  // `out : = a;` is the label `out:`, then a statement opening with `=`
  expect(errors("out : = a;")).toEqual(["Unexpected token '=' found", "';' expected instead of 'a'"])
  expect(statements("out : = a;")[0]).toMatchObject({ kind: "label" })
})

test("a reserved word before `(` is refused where a statement starts: `LIMIT(0, a, 5);`, `INI(t, TRUE);` (stmt_limit_call_statement, stmt_ini_call, ST5/ST19)", () => {
  expect(errors("INI(t, TRUE);")).toEqual([
    "Unexpected token 'INI' found", "';' expected instead of '('", "Unexpected token '(' found", "';' expected instead of 't'",
    "';' expected instead of ','", "Unexpected token ',' found", "';' expected instead of 'TRUE'", "Unexpected token 'TRUE' found",
    "';' expected instead of ')'", "Unexpected token ')' found",
  ])
  expect(errors("LIMIT(0, a, 5);")).toContain("Unexpected token 'LIMIT' found")
  // …and in an operand it is the operator it names
  expect(errors("ok := INI(t, TRUE);\nn := LIMIT(0, a, 5);")).toEqual([])
})

test("RETURN, EXIT, CONTINUE and JMP without their `;` are the one line, and the next statement is read (stmt_*_no_semicolon, ST14/ST15)", () => {
  expect(errors("RETURN\nout := 2;")).toEqual(["';' expected instead of 'out'"])
  expect(errors("FOR i := 1 TO 3 DO\n\tEXIT\n\tout := i;\nEND_FOR")).toEqual(["';' expected instead of 'out'"])
  expect(errors("FOR i := 1 TO 3 DO\n\tCONTINUE\n\tout := i;\nEND_FOR")).toEqual(["';' expected instead of 'out'"])
  expect(errors("JMP lbl\nout := 1;\nlbl:\nout := 2;")).toEqual(["';' expected instead of 'out'"])
  expect(statements("RETURN\nout := 2;").map((s) => s.kind)).toEqual(["return", "assign"])
})

test("a statement without its `;` before its block's END is the one line (stmt_*_no_semicolon_before_end_*, stmt_assign_no_semicolon_before_end_if, ST14)", () => {
  expect(errors("IF x THEN\n\tRETURN\nEND_IF")).toEqual(["';' expected instead of 'END_IF'"])
  expect(errors("FOR i := 1 TO 3 DO\n\tout := i;\n\tEXIT\nEND_FOR")).toEqual(["';' expected instead of 'END_FOR'"])
  expect(errors("IF x THEN\n\tout := 1\nEND_IF")).toEqual(["';' expected instead of 'END_IF'"])
})

test("a CASE label list with a trailing comma wants an expression at the colon, and the arm is read (stmt_case_label_trailing_comma, ST7)", () => {
  expect(errors("CASE a OF\n1, 2,: out := 1;\nEND_CASE")).toEqual(["Expression expected instead of ':'"])
  expect(statements("CASE a OF\n1, 2,: out := 1;\nEND_CASE")[0]).toMatchObject({ kind: "case", arms: [{ labels: [{}, {}] }] })
})

test("`__CATCH` without its operand is a catch (stmt_try_catch_without_operand, ST18)", () => {
  for (const d of ["codesys", "twincat"] as const) expect(errors("__TRY\n\tout := 1;\n__CATCH\n\tout := 2;\n__ENDTRY", d)).toEqual([])
  expect(statements("__TRY\n\tout := 1;\n__CATCH\n\tout := 2;\n__ENDTRY")[0]).toMatchObject({ kind: "try", catchBody: [{ kind: "assign" }] })
})
