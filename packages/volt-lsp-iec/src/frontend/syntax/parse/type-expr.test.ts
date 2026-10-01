/**
 * TYPE EXPRESSIONS, RULE BY RULE (openspec frontend-conformance 2.3.6, T1–T11) — each test is a recorded fixture's answer
 * (`test/conformance/fixtures/grammar/type-expressions.ts`, both vendors 2026-10-01) put to the parser alone. Only the
 * FIRST message of a refusal is the rule's; what the vendors say after it is their declaration recovery (task 2.8.2).
 */
import { test, expect } from "bun:test"
import { parseSource } from "./parser.js"
import type { EnumBody, FunctionBlock, TypeDecl, VarDecl } from "../ast/nodes.js"
import { renderTypeExpr } from "../print.js"

const parse = (src: string, vendor: "codesys" | "twincat" = "codesys") => parseSource(src, { networkText: true }, vendor)
const messages = (src: string, vendor: "codesys" | "twincat" = "codesys") => parse(src, vendor).errors.map((e) => e.message)
const inVar = (decl: string) => `FUNCTION_BLOCK F\nVAR\n\t${decl}\n\tout : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n`
const first = (decl: string) => messages(inVar(decl))[0]
const decl = (src: string): VarDecl => (parse(src).units[0] as FunctionBlock).varSections[0]!.decls[0]!
const enumType = (body: string) => `TYPE E :\n${body}\nEND_TYPE\n`
const enumBody = (src: string) => (parse(src).units[0] as TypeDecl).body as EnumBody

test("T1 — a punctuation mark where the type stands is 'Type definition expected instead of' it", () => {
  // `decl_type_missing` (`v : ;`), both vendors; a keyword there was already the vendors' form (`decl_type_keyword`)
  expect(first("v : ;")).toBe("Type definition expected instead of ';'")
  expect(first("v : END_IF;")).toBe("Type definition expected instead of 'END_IF'")
  // …and every other punctuation mark measured there (`decl_type_open_bracket`, `decl_type_missing_before_init`, both
  // vendors 2026-10-01 — the rule had been generalized from `;` alone)
  for (const vendor of ["codesys", "twincat"] as const) {
    expect(messages(inVar("v : [;"), vendor)[0]).toBe("Type definition expected instead of '['")
    expect(messages(inVar("v : := 5;"), vendor)[0]).toBe("Type definition expected instead of ':='")
  }
})

test("T2 — an integer or bit-string type's parentheses are a subrange: one value is \"'..' expected\"", () => {
  // `decl_subrange_one_bound` (`INT(5)`); `decl_subrange_unsigned`, `decl_subrange_on_byte` build
  expect(first("v : INT(5);")).toBe("'..' expected instead of ')'")
  expect(messages(inVar("v : UINT(1..5);"))).toEqual([])
  expect(messages(inVar("v : BYTE(0..5);"))).toEqual([])
  expect(decl(inVar("v : BYTE(0..5);")).type).toMatchObject({ subrange: { lo: { text: "0" }, hi: { text: "5" } } })
})

test("T2 — any other type's parentheses are an argument list: a `..` in them is \"',' or ')' expected\"", () => {
  // `decl_subrange_on_real`, `_on_bool`, `_on_alias`, both vendors; `REAL(5)` builds (`decl_subrange_one_bound_real`)
  expect(first("v : REAL(0..1);")).toBe("',' or ')' expected instead of '..'")
  expect(first("v : BOOL(0..1);")).toBe("',' or ')' expected instead of '..'")
  expect(first("v : MyAlias(0..5);")).toBe("',' or ')' expected instead of '..'")
  expect(messages(inVar("v : REAL(5);"))).toEqual([])
  expect(decl(inVar("v : REAL(0..1);")).type).not.toHaveProperty("subrange")
  // a duration and a date take no subrange either (`decl_subrange_on_time`, `_on_date`, both vendors 2026-10-01)
  expect(first("v : TIME(T#1S..T#2S);")).toBe("',' or ')' expected instead of '..'")
  expect(first("v : DATE(D#2020-01-01..D#2020-12-31);")).toBe("',' or ')' expected instead of '..'")
})

test("T2 — the platform integers take a subrange: `__XINT(0..5)`, `__UXINT(0..5)`, `__XWORD(0..5)` build", () => {
  // `decl_subrange_on_xint`, `_on_uxint`, `_on_xword`: both vendors build, CODESYS runs each
  for (const t of ["__XINT", "__UXINT", "__XWORD"]) {
    expect(messages(inVar(`v : ${t}(0..5);`))).toEqual([])
    expect(decl(inVar(`v : ${t}(0..5);`)).type).toMatchObject({ subrange: { lo: { text: "0" }, hi: { text: "5" } } })
  }
})

test("T4 — an ARRAY dimension without `..` is \"'..' expected\" where it was wanted", () => {
  // `decl_array_single_bound` (`[5]`), `decl_array_empty_dims` (`[]`), `decl_array_mixed_star` (`[0..1, *]`), both vendors
  expect(first("a : ARRAY[5] OF INT;")).toBe("'..' expected instead of ']'")
  expect(first("a : ARRAY[] OF INT;")).toBe("'..' expected instead of ']'")
  expect(first("a : ARRAY[0..1, *] OF INT;")).toBe("'..' expected instead of ']'")
  // …and the declaration is gone, as the vendors' "not defined" for its uses says: no half-read array stands
  expect((parse(inVar("a : ARRAY[5] OF INT;")).units[0] as FunctionBlock).varSections[0]!.decls.map((d) => d.names[0]!.text)).toEqual(["out"])
})

test("T4 — after a variable-length dimension every dimension is one: a bound there is \"'*' expected\"", () => {
  // `decl_array_star_then_fixed` (`[*, 0..1]`), both vendors; `[*, *]` is no grammar error (`decl_array_two_stars`)
  expect(first("a : ARRAY[*, 0..1] OF INT;")).toBe("'*' expected instead of '0'")
  expect((parse(inVar("a : ARRAY[*, 0..1] OF INT;")).units[0] as FunctionBlock).varSections[0]!.decls.map((d) => d.names[0]!.text)).toEqual(["out"])
  expect(messages(inVar("a : ARRAY[*, *] OF INT;"))).toEqual([])
  expect(decl(inVar("a : ARRAY[*, *] OF INT;")).type).toMatchObject({ dims: [{ dynamic: true }, { dynamic: true }] })
})

test("T9 — a STRING length is in `(…)` or `[…]`, and either closer ends either opener", () => {
  // `decl_string_brackets`, `decl_string_brackets_mismatched` (`STRING(5]`), `_other` (`STRING[5)`): all build, both vendors
  for (const t of ["STRING[5]", "STRING(5]", "STRING[5)"]) {
    expect(messages(inVar(`str : ${t};`))).toEqual([])
    expect(decl(inVar(`str : ${t};`)).type).toMatchObject({ kind: "string_type", wide: false, length: { text: "5" } })
  }
})

test("T9 — a WSTRING length is in `(…)` only: `[` after WSTRING is a bracket initializer, `]` no closer", () => {
  // `decl_wstring_brackets` (`WSTRING[3]` — "'(' expected instead of '3'", D16's words), `decl_wstring_brackets_mismatched`
  expect(first("w : WSTRING[3];")).toBe("'(' expected instead of '3'")
  expect(first("w : WSTRING(3];")).toBe("')' expected instead of ']'")
  expect(decl(inVar("w : WSTRING[3];")).type).toEqual(expect.objectContaining({ kind: "string_type", wide: true }))
  expect(decl(inVar("w : WSTRING[3];")).type).not.toHaveProperty("length")
})

test("T10 — a value followed by neither `,` nor `)`: what was wanted depends on whether the value had a `:=`", () => {
  // both vendors, a TYPE enum (2026-10-01): after a bare name `:=` could still come — "':=, , or )' expected instead of
  // 'tm_b'" (`decl_type_enum_missing_comma`); after a value's expression only the list goes on — "', or )' expected instead
  // of 'tv_b'" (`decl_type_enum_value_then_name`). One sentence for both said TwinCAT's second on CODESYS for the first.
  for (const vendor of ["codesys", "twincat"] as const) {
    expect(messages(enumType("(tm_a tm_b);"), vendor)[0]).toBe("':=, , or )' expected instead of 'tm_b'")
    expect(messages(enumType("(tv_a := 1 tv_b);"), vendor)[0]).toBe("', or )' expected instead of 'tv_b'")
  }
})

test("T10 — an implicit enum keeps its base type, and prints it back", () => {
  // `decl_implicit_enum_with_base` builds and runs (`ie_c` is 301): the base was consumed and dropped
  const t = decl(inVar("e : (ie_a, ie_b := 300, ie_c) INT;")).type
  expect(t).toMatchObject({ kind: "implicit_enum_type", baseType: { kind: "named_type", name: { text: "INT" } } })
  expect(renderTypeExpr(t)).toBe("(ie_a, ie_b := 300, ie_c) INT")
})

test("T10 — an implicit enum may end in a comma; a TYPE enum may not; neither may be empty", () => {
  // `decl_implicit_enum_trailing_comma` builds; `decl_type_enum_trailing_comma`, `decl_implicit_enum_empty`,
  // `decl_type_enum_empty` are "Identifier expected instead of ')'", both vendors
  expect(messages(inVar("e : (tc_a, tc_b,);"))).toEqual([])
  expect(decl(inVar("e : (tc_a, tc_b,);")).type).toMatchObject({ values: [{ name: { text: "tc_a" } }, { name: { text: "tc_b" } }] })
  expect(messages(enumType("(te_a, te_b,);"))).toEqual(["Identifier expected instead of ')'"])
  expect(first("e : ();")).toBe("Identifier expected instead of ')'")
  expect(messages(enumType("();"))).toEqual(["Identifier expected instead of ')'"])
})

test("T10 — one value parser: a value that is no name is 'Identifier expected' in either list", () => {
  // `decl_type_enum_number_name` (both vendors: "Identifier expected instead of '5'"); the implicit list said a Volt
  // sentence of its own ("expected enum value name in implicit enumeration") and four cascade messages besides
  expect(messages(enumType("(tn_a, 5);"))).toContain("Identifier expected instead of '5'")
  expect(first("e : (nn_a, 5);")).toBe("Identifier expected instead of '5'")
  expect(messages(inVar("e : (nn_a, 5);")).some((m) => m.includes("implicit enumeration"))).toBe(false)
  // a value followed by neither `,` nor `)` — TwinCAT's refused `CHAR#` after `A :=` (`lit_char_typed_in_enum_value`):
  // "', or )' expected instead of 'CHAR#'", and the list resyncs at its next `,` without leaving it (it ran to file scope)
  const refused = messages(enumType("(\n\tA := CHAR#'A',\n\tB\n);"), "twincat")
  expect(refused).toContain("', or )' expected instead of 'CHAR#'")
  expect(refused.some((m) => m.includes("file scope") || m.includes("END_TYPE"))).toBe(false)
  // …and a resync never runs past the declaration: an unclosed implicit list stops at its `;` (what it says there is
  // the LSP's own — the vendors say no such line in an implicit list, `IMPLICIT_ENUM_LIST_RECOVERY`)
  expect(decl(inVar("e : (mc_a, mc_b;")).names[0]!.text).toBe("e")
  expect(messages(inVar("e : (mc_a, mc_b;"))).toEqual(["':=, , or )' expected instead of ';'"])
  // the values both read: names, values, the TYPE enum's base and default unchanged
  const body = enumBody(enumType("(A, B := 5, C) DINT := B;"))
  expect(body.values.map((v) => v.name.text)).toEqual(["A", "B", "C"])
  expect(body.baseType).toMatchObject({ name: { text: "DINT" } })
  expect(body.init).toMatchObject({ kind: "ident_expr", name: "B" })
})
