/**
 * DECLARATIONS, RULE BY RULE (openspec frontend-conformance 2.3, D1–D19 and U23) — each test is a recorded fixture's
 * answer (`test/conformance/fixtures/grammar/declarations.ts`, both vendors 2026-10-01) put to the parser alone.
 */
import { test, expect } from "bun:test"
import { parseSource } from "./parser.js"
import type { FunctionBlock, GlobalVarList, TypeDecl, VarDecl } from "../ast/nodes.js"

const parse = (src: string, vendor: "codesys" | "twincat" = "codesys") => parseSource(src, { networkText: true }, vendor)
const messages = (src: string) => parse(src).errors.map((e) => e.message)
const fb = (sections: string) => `FUNCTION_BLOCK F\n${sections}\nEND_FUNCTION_BLOCK\n`
const inVar = (decl: string) => fb(`VAR\n\t${decl}\nEND_VAR`)
const decls = (src: string): VarDecl[] => (parse(src).units[0] as FunctionBlock).varSections.flatMap((s) => s.decls)
const struct = (fields: string) => `TYPE T :\nSTRUCT\n${fields}\nEND_STRUCT\nEND_TYPE\n`
const fields = (src: string): VarDecl[] => {
  const body = (parse(src).units[0] as TypeDecl).body
  return body.kind === "struct" ? body.fields : []
}

test("D4 — a file-scope VAR_ACCESS list reads its access paths and binds nothing of its own", () => {
  // `decl_var_access`, `_read_only`, `_no_direction`, `_unknown_path`: all build
  const src = "VAR_ACCESS\n\taccW : PLC_PRG.x : INT READ_WRITE;\n\taccN : PLC_PRG.y : INT;\nEND_VAR\n"
  const r = parse(src)
  expect(r.errors).toEqual([])
  const [w, n] = (r.units[0] as GlobalVarList).varSections[0]!.decls
  expect(w?.access?.path.map((p) => p.text)).toEqual(["PLC_PRG", "x"])
  expect(w?.access?.direction).toBe("READ_WRITE")
  expect(w?.type).toMatchObject({ kind: "named_type", name: { text: "INT" } })
  expect(n?.access?.direction).toBeUndefined()
})

test("D4 — a VAR_ACCESS section in a POU is an unexpected token", () => {
  // `decl_var_access_in_fb`: the first of both vendors' messages (the rest is the declaration recovery's, 2.8.2)
  const src = fb("VAR\n\tout : INT;\nEND_VAR\nVAR_ACCESS\n\taccF : out : INT READ_ONLY;\nEND_VAR")
  expect(messages(src)).toEqual(["Unexpected token 'VAR_ACCESS' found"])
  expect(decls(src).map((d) => d.names[0]!.text)).toEqual(["out"])
})

test("D5 — a VAR_GENERIC section is CONSTANT or refused; an instance names its values in angle brackets", () => {
  // `decl_var_generic_no_constant`; `decl_var_generic` (`inst : FB<6>`)
  expect(messages(fb("VAR_GENERIC\n\tN : UDINT := 4;\nEND_VAR"))).toEqual(["Only CONSTANT generics are supported in VAR_GENERIC declaration"])
  expect(messages(fb("VAR_GENERIC CONSTANT\n\tN : UDINT := 4;\nEND_VAR"))).toEqual([])
  const [inst] = decls(inVar("inst : FB_G<6>;"))
  expect(inst?.type.kind).toBe("named_type")
  expect(inst?.type).toMatchObject({ genericArgs: [{ kind: "literal", text: "6" }] })
})

// No recording covers a malformed value list; what holds without one: no value is dropped quietly (the formatter
// reprinted `G<5 6>` as `G<>`), and an unclosed `<` ends with its declaration (it swallowed the POU after it).
test("D5 — a generic value list that is no expression list is refused where it breaks, never dropped", () => {
  for (const decl of ["inst : FB_G<5 6>;", "inst : FB_G<1, +>;"]) {
    const src = inVar(`${decl}\n\tn : INT;`)
    expect(messages(src).length).toBeGreaterThan(0)
    expect(decls(src).map((d) => d.names[0]!.text)).toEqual(["inst", "n"])
  }
  expect(decls(inVar("inst : FB_G<1, 2 + 3>;"))[0]?.type).toMatchObject({ genericArgs: [{ kind: "literal" }, { kind: "binary" }] })
})

test("D5 — an unclosed generic value list ends at its declaration's `;`", () => {
  const src = "PROGRAM P\nVAR\n\tx : G<6;\n\ty : INT;\nEND_VAR\ny := 1;\nEND_PROGRAM\n"
  const r = parse(src)
  expect(r.errors.map((e) => e.message)).toEqual(["'>' expected instead of ';'"])
  const prg = r.units[0] as FunctionBlock
  expect(prg.varSections.flatMap((s) => s.decls).map((d) => d.names[0]!.text)).toEqual(["x", "y"])
  expect(prg.body).toBeDefined()
})

// No recording holds a value with AND/OR/XOR or a comparison; only the list's own `>` closes it, so nothing the parser
// cannot tell from that `>` is refused — an LSP-only error on a value the compiler may take would be a false positive.
test("D5 — a generic value is any expression but one using `>`: AND, OR, XOR and `=` are read, not refused", () => {
  for (const [value, op] of [["6 AND 3", "AND"], ["A OR B", "OR"], ["A XOR B", "XOR"], ["X = 1", "="], ["(A > B)", undefined]] as const) {
    const src = inVar(`inst : FB_G<${value}>;\n\tn : INT;`)
    expect(messages(src)).toEqual([])
    const [inst] = decls(src)
    expect(inst?.type).toMatchObject({ genericArgs: [op === undefined ? { kind: "paren" } : { kind: "binary", op }] })
  }
})

test("D5 — TwinCAT has no generic value list: `F<6>` is refused at its `<` and the declaration stands as `F`", () => {
  // `decl_var_generic`, `decl_var_generic_two_values`, `_read`, `_no_constant` (TwinCAT 2026-10-01): the consumer's line
  // "';, :=, REF=, ( or [' expected instead of '<'", and no "not defined" for the instance
  for (const list of ["<6>", "<6, 7>"]) {
    const r = parse(`PROGRAM P\nVAR\n\tinst : F${list};\n\tn : INT;\nEND_VAR\nn := 1;\nEND_PROGRAM\n`, "twincat")
    expect(r.errors.map((e) => e.message)).toEqual(["';, :=, REF=, ( or [' expected instead of '<'"])
    const prg = r.units[0] as FunctionBlock
    const ds = prg.varSections.flatMap((s) => s.decls)
    expect(ds.map((d) => d.names[0]!.text)).toEqual(["inst", "n"])
    expect(ds[0]?.type).toMatchObject({ kind: "named_type", name: { text: "F" } })
    expect(ds[0]?.type).not.toHaveProperty("genericArgs")
    expect(prg.body).toBeDefined()
  }
})

test("D5 — VAR_GENERIC is a word on TwinCAT, not a section", () => {
  const r = parse(fb("VAR_GENERIC CONSTANT\n\tN : UDINT := 4;\nEND_VAR"), "twincat")
  expect((r.units[0] as FunctionBlock).varSections).toEqual([])
})

test("D6 — the qualifiers stand in any order, repeated", () => {
  // `decl_constant_retain`, `decl_retain_constant`, `decl_persistent_retain`, `decl_retain_twice` build on both vendors
  for (const q of ["CONSTANT RETAIN", "RETAIN CONSTANT", "PERSISTENT RETAIN", "RETAIN RETAIN"])
    expect(messages(fb(`VAR ${q}\n\tk : INT := 3;\nEND_VAR`))).toEqual([])
})

test("D7 — NON_RETAIN is a name, and a name after a name is refused with the declaration it opens", () => {
  // `decl_non_retain_as_name` builds; `var_non_retain`, `decl_non_retain_in_var_input`, `decl_retain_non_retain`
  expect(messages(inVar("NON_RETAIN : INT;"))).toEqual([])
  for (const header of ["VAR NON_RETAIN", "VAR_INPUT NON_RETAIN", "VAR RETAIN NON_RETAIN"]) {
    const src = fb(`${header}\n\tk : INT := 3;\nEND_VAR`)
    expect(messages(src)).toEqual(["',, AT or :' expected instead of 'k'"])
    expect(decls(src)).toEqual([])
  }
})

test("D8 — a name list ending in a comma wants an identifier", () => {
  // `decl_names_trailing_comma`
  expect(messages(inVar("a, : INT;"))).toEqual(["Identifier expected instead of ':'"])
})

test("D11 — an AT operand that is no address is refused, and the declaration marked lost", () => {
  // `cc5_at_address_not_direct`, `decl_at_not_an_address`, `_string`, `decl_at_empty`
  for (const [operand, echo] of [["ABC", "ABC"], ["16#10", "16#10"], ["'x'", "'x'"], ["", ":"]] as const) {
    const src = inVar(`v AT ${operand} : INT;`)
    expect(parse(src).errors.map((e) => [e.message, e.directAddressExpected])).toEqual([
      [`Direct address expected after AT instead of ${echo}`, echo],
    ])
    expect(decls(src)[0]?.atRefused).toBe(true)
  }
  expect(decls(inVar("a, b AT %MW40 : INT;"))[0]?.atRefused).toBeUndefined()
})

test("D10 — AT after the type is refused; the declaration stands with neither address nor initializer", () => {
  // `decl_at_after_type`, `_with_init`, `decl_at_twice`, `decl_at_not_an_address_after_type`
  for (const decl of ["v : INT AT %MW42;", "v : INT AT %MW44 := 6;", "v AT %MW46 : INT AT %MW48;", "v : INT AT abc;"]) {
    const src = inVar(decl)
    expect(messages(src)).toEqual(["';, :=, REF=, ( or [' expected instead of 'AT'"])
    expect(decls(src)[0]?.init).toBeUndefined()
  }
  // `decl_at_after_type_in_gvl`: in a GVL the same, on both vendors (where a missing `;` alone is no error)
  expect(parse("VAR_GLOBAL\n\tgAt : INT AT %MW50;\nEND_VAR\n").errors.map((e) => e.message)).toEqual(["';, :=, REF=, ( or [' expected instead of 'AT'"])
})

test("D12 — `:=` with no value is refused, the compiler's placeholder kept as the value", () => {
  // `decl_init_empty`
  const src = inVar("v : INT := ;")
  expect(messages(src)).toEqual(["Expression expected instead of ';'"])
  expect(decls(src)[0]?.refusedInit?.value).toMatchObject({ kind: "ident_expr", name: "!!!'ERROR'!!!" })
})

test("D15 — a repeat count with no value is refused", () => {
  // `decl_repeat_count_empty`; `decl_repeat_count*` build
  expect(messages(inVar("a : ARRAY[0..4] OF INT := [3()];"))).toEqual(["Expression expected instead of ')'"])
  for (const init of ["[5(7)]", "[1, 3(2), 9]", "[INT#2+INT#3(7)]"]) expect(messages(inVar(`a : ARRAY[0..4] OF INT := ${init};`))).toEqual([])
})

test("D16 — a bracket list without `:=` takes parenthesized elements only", () => {
  // `decl_bracket_init_no_assign`, `_scalar` refuse at the first element; `_fb` is the form the rule is for
  expect(messages(inVar("a : ARRAY[0..1] OF INT [1, 2];"))).toEqual(["'(' expected instead of '1'"])
  expect(messages(inVar("v : INT [1];"))).toEqual(["'(' expected instead of '1'"])
  const src = inVar("fbs : ARRAY[0..1] OF E [(x := 1), (x := 2)];")
  expect(messages(src)).toEqual([])
  expect(decls(src)[0]?.init?.kind).toBe("aggregate_init")
})

test("D14 — a parenthesized list without field names is an expression that wants its `)`", () => {
  // `decl_struct_init_positional_five`: the first value is kept, and type-checked against the declared type
  const src = inVar("rec : D := (5, 2);")
  expect(messages(src)).toEqual(["';' expected instead of ','", "')' expected instead of ','"])
  expect(decls(src)[0]?.init).toMatchObject({ kind: "literal", text: "5" })
  expect(messages(inVar("rec : D := (a := 1, b := 2);"))).toEqual([])
  // `decl_array_init_positional`: on an ARRAY the same two, on both vendors
  expect(messages(inVar("a : ARRAY[0..1] OF INT := (1, 2);"))).toEqual(["';' expected instead of ','", "')' expected instead of ','"])
})

test("D19 — a STRUCT field is a declaration: soft-keyword name, REF=, AT, a stray token, a name list", () => {
  // `decl_struct_field_soft_name`, `_ref_init`, `_at`, `_names` build; `_stray_token`, `_at_after_type` as in a VAR block
  expect(messages(struct("\tGET : INT := 4;"))).toEqual([])
  const [, ref] = fields(struct("\ta : INT := 4;\n\trf : REFERENCE TO INT REF= a;"))
  expect(ref?.initOp).toBe("REF=")
  expect(fields(struct("\ta AT %MW50 : INT;"))[0]?.at).toBeDefined()
  expect(fields(struct("\ta, b : INT := 4;"))[0]?.names.map((n) => n.text)).toEqual(["a", "b"])
  expect(messages(struct("\ta : INT := 5 abc;"))).toEqual(["';' expected instead of 'abc'"])
  expect(messages(struct("\ta : INT AT %MW52;"))).toEqual(["';, :=, REF=, ( or [' expected instead of 'AT'"])
})

test("U23 — a VAR section inside a STRUCT is refused whole, echoed as the compiler reads it back", () => {
  // `decl_var_inside_struct`, `_init`, `_names`, `decl_var_inst_inside_struct` (no keyword in the echo)
  // the echo is a FACT — the keyword as echoed and the declarations; `analysis` parse-errors writes its text
  const echo = (src: string) =>
    parse(src).errors.flatMap((e) => (e.sectionEcho === undefined ? [] : [[e.sectionEcho.keyword, e.sectionEcho.decls.flatMap((d) => d.names.map((n) => n.text))]]))
  expect(echo(struct("\tVAR\n\t\ta : INT;\n\tEND_VAR\n\tb : INT;"))).toEqual([["VAR", ["a"]]])
  expect(echo(struct("\tVAR\n\t\ta, c : BOOL;\n\tEND_VAR"))).toEqual([["VAR", ["a", "c"]]])
  expect(echo(struct("\tVAR_INST\n\t\ta : INT;\n\tEND_VAR"))).toEqual([["", ["a"]]])
  expect(echo(struct("\tVAR_CONFIG\n\t\ta : INT;\n\tEND_VAR"))).toEqual([["", ["a"]]])
  // the STRUCT goes on after it: `b` is its field
  expect(fields(struct("\tVAR\n\t\ta : INT;\n\tEND_VAR\n\tb : INT;")).map((f) => f.names[0]!.text)).toEqual(["b"])
  // the placement is a FACT for the analysis to word; VAR and VAR_EXTERNAL draw none
  const facts = (kw: string) => parse(struct(`\t${kw}\n\t\ta : INT;\n\tEND_VAR`)).errors.flatMap((e) => (e.sectionInStruct === undefined ? [] : [e.sectionInStruct]))
  expect(facts("VAR_INPUT")).toEqual(["VAR_INPUT"])
  expect(facts("VAR_TEMP")).toEqual(["VAR_TEMP"])
  expect(facts("VAR")).toEqual([])
  expect(facts("VAR_EXTERNAL")).toEqual([])
})

test("an operator's trailing comma in an initializer is refused at the `)`, as in a body; no value is kept", () => {
  // `expr_trailing_comma_operator_call_in_initializer` (both vendors 2026-10-02; the vendors' value
  // `MAX(MAX(SINT#1, 2), !!!'ERROR'!!!)` and its two type messages are a known divergence)
  const src = inVar("c : INT := MAX(1, 2,);\n\tx : INT;")
  expect(messages(src)).toEqual(["Expression expected instead of ')'"])
  expect(decls(src)[0]?.refusedInit?.value).toBeUndefined()
  expect(decls(src)[1]?.names[0]?.text).toBe("x")
  // a user function's list takes one, and an aggregate is not asked
  expect(messages(inVar("c : INT := F(1, 2,);"))).toEqual([])
  expect(messages(inVar("v : T := STRUCT(a := 1, b := 2);"))).toEqual([]) // not `s`: an IL operator, refused (`cc_reserved_name_s_string`)
})
