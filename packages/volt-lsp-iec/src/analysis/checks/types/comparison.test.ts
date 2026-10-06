/**
 * incompatible-comparison (C0066). A relational operator between two mutually-inconvertible scalar types.
 * Docs wording (#C0066).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const cmp = (body: string, vendor: "codesys" | "twincat" = "codesys"): string[] => {
  const src = `PROGRAM PLC_PRG\nVAR\n  i : INT; re : REAL; str : STRING; b : BOOL; w : WORD;\nEND_VAR\n${body}\nEND_PROGRAM`
  const pr = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult: pr, source: src }], [], vendor)
  return computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "incompatible-comparison")
    .map((d) => d.message)
}

test("comparing a number to a string names both, in source order", () => {
  expect(cmp(`b := i > str;`)).toEqual(["Cannot compare type 'INT' with type 'STRING'"])
  expect(cmp(`b := str < i;`)).toEqual(["Cannot compare type 'STRING' with type 'INT'"])
})

test("comparable pairs stay quiet (0-FP)", () => {
  expect(cmp(`b := i > re;`)).toEqual([]) // int vs real — numeric, convertible
  expect(cmp(`b := i > w;`)).toEqual([]) // int vs bit-string — numeric
  expect(cmp(`b := i = i;`)).toEqual([]) // same type
  expect(cmp(`b := str = str;`)).toEqual([]) // string vs string
})

test("all six relational operators are covered", () => {
  for (const op of ["<", ">", "<=", ">=", "=", "<>"]) expect(cmp(`b := i ${op} str;`)).toHaveLength(1)
})

test("C0068/C0069: comparing arrays is flagged (same type → one, different → two)", () => {
  const src = (d: string) => `PROGRAM PLC_PRG\nVAR\n  b : BOOL; a1 : ARRAY[1..2] OF INT; a2 : ARRAY[1..2] OF INT; a3 : ARRAY[1..3] OF INT;\nEND_VAR\n${d}\nEND_PROGRAM`
  const run = (d: string) => {
    const pr = parseSource(src(d), { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src(d) }], [], "codesys")
    return computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src(d), project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((x) => x.code.startsWith("compare-array"))
      .map((x) => x.message)
  }
  expect(run(`b := a1 > a2;`)).toEqual(["Compare not possible on objects of type 'ARRAY [1..2] OF INT'"])
  expect(run(`b := a1 > a3;`)).toEqual(["Compare not possible on objects of type 'ARRAY [1..2] OF INT' or 'ARRAY [1..3] OF INT'"])
})

test("byte-identical on both vendors", () => {
  expect(cmp(`b := i > str;`, "twincat")).toEqual(cmp(`b := i > str;`, "codesys"))
})

test("C0354: comparing two different enumeration types is flagged; same-enum and enum-vs-int are not", () => {
  const enums = `TYPE ENUM1 : (A, B); END_TYPE\nTYPE ENUM2 : (X, Y); END_TYPE\n`
  const run = (body: string) => {
    const src = `${enums}PROGRAM P\nVAR b : BOOL; e1 : ENUM1; ea : ENUM1; e2 : ENUM2; i : INT;\nEND_VAR\n${body}\nEND_PROGRAM`
    const pr = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult: pr, source: src }], [], "codesys")
    return computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "enum-comparison")
      .map((d) => d.message)
  }
  expect(run(`b := e1 = e2;`)).toEqual(["Comparison of one enumeration type (ENUM1) with another (ENUM2)"])
  expect(run(`b := e1 = ea;`)).toEqual([]) // same enum type
  expect(run(`b := e1 = i;`)).toEqual([]) // enum vs int — valid
})

test("C0354 upper-cases both names, skips two enum VALUES, and treats a re-cased name as the same enum", () => {
  // recorded: `cc_enum_compare_two_enums` upper-cases the names; `cc_enum_compare_two_enum_values` is silent; and
  // `cc_fp_enum_compare_same_enum_other_case` is silent — the check compared names case-sensitively, so it fired
  const enums = `TYPE E_Cmp_A : (A0, A1); END_TYPE\nTYPE E_Cmp_B : (B0, B1); END_TYPE\n`
  const run = (body: string) => {
    const src = `${enums}PROGRAM P\nVAR b : BOOL; ea : E_Cmp_A; eb : E_Cmp_B; ec : e_cmp_a;\nEND_VAR\n${body}\nEND_PROGRAM`
    const pr = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult: pr, source: src }], [], "codesys")
    return computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "enum-comparison")
      .map((d) => d.message)
  }
  expect(run(`b := ea = eb;`)).toEqual(["Comparison of one enumeration type (E_CMP_A) with another (E_CMP_B)"])
  expect(run(`b := E_Cmp_A.A1 = E_Cmp_B.B1;`)).toEqual([])
  expect(run(`b := ea = ec;`)).toEqual([])
})

/** Every error and warning `body` gives, on a 64-bit target, with arrays, structs, FBs, pointers and enums declared. */
const every = (body: string, vendor: "codesys" | "twincat" = "codesys"): string[] => {
  const src =
    `TYPE S_Cmp : STRUCT x : INT; END_STRUCT END_TYPE\nTYPE E_A : (A0, A1); END_TYPE\nTYPE E_B : (B0, B1); END_TYPE\n` +
    `FUNCTION_BLOCK FB_Cmp\nEND_FUNCTION_BLOCK\n` +
    `PROGRAM P\nVAR CONSTANT N : INT := 2; END_VAR\nVAR\n o : BOOL; i : INT; si : SINT; di : DINT; li : LINT; bt : BYTE; ui : UINT; ud : UDINT; x : INT;\n` +
    ` a1 : ARRAY[1..2] OF INT; m1 : ARRAY[1..2, 0..1] OF BYTE; m2 : ARRAY[1..2, 0..1] OF BYTE; n1 : ARRAY[0..N] OF INT; n2 : ARRAY[0..N] OF INT;\n` +
    ` s1 : S_Cmp; s2 : S_Cmp; f1 : FB_Cmp; f2 : FB_Cmp; p : POINTER TO INT; ea : E_A;\nEND_VAR\n${body}\nEND_PROGRAM`
  const pr = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult: pr, source: src }], [], vendor, { target: { pointerBits: 64 } })
  return computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.severity === "error" || d.severity === "warning")
    .map((d) => `${d.severity}: ${d.message}`)
}

test("an array against a scalar is the two-type C0066, the array named as written, either side (cmpop_array_vs_scalar, cmpop_scalar_vs_array)", () => {
  for (const vendor of ["codesys", "twincat"] as const) {
    expect(every("o := a1 = i;", vendor)).toEqual(["error: Cannot compare type 'ARRAY [1..2] OF INT' with type 'INT'"])
    expect(every("o := i > a1;", vendor)).toEqual(["error: Cannot compare type 'INT' with type 'ARRAY [1..2] OF INT'"])
  }
})

test("an array is named as its declaration writes it: dimensions after a comma and a space, a constant bound unfolded (cmpop_array_two_dims, cmpop_array_constant_bound)", () => {
  expect(every("o := m1 = m2;")).toEqual(["error: Compare not possible on objects of type 'ARRAY [1..2, 0..1] OF BYTE'"])
  expect(every("o := n1 = n2;")).toEqual(["error: Compare not possible on objects of type 'ARRAY [0..N] OF INT'"])
})

test("a struct or a function block instance is not comparable — against itself or a scalar (cmpop_struct_vs_struct, cmpop_struct_vs_int, cmpop_fb_vs_fb)", () => {
  expect(every("o := s1 = s2;")).toEqual(["error: Cannot compare type 'S_Cmp' with type 'S_Cmp'"])
  expect(every("o := s1 = i;")).toEqual(["error: Cannot compare type 'S_Cmp' with type 'INT'"])
  expect(every("o := f1 = f2;")).toEqual(["error: Cannot compare type 'FB_Cmp' with type 'FB_Cmp'"])
})

test("an enum variable against ANOTHER enum's value warns, as two variables do (cmpop_enum_var_vs_other_value)", () => {
  expect(every("o := ea = E_B.B1;")).toEqual(["warning: Comparison of one enumeration type (E_A) with another (E_B)"])
  expect(every("o := E_B.B1 = ea;")).toEqual(["warning: Comparison of one enumeration type (E_B) with another (E_A)"])
})

test("a pointer against an integer on the 64-bit target: 32 bits refused, a signed one meets at LINT with a change of sign, a narrow unsigned one is silent (cmpop_pointer_vs_*)", () => {
  expect(every("p := ADR(x);\no := p = di;")).toEqual(["error: Cannot compare type 'POINTER TO INT' with type 'DINT'"])
  expect(every("p := ADR(x);\no := p = ud;")).toEqual(["error: Cannot compare type 'POINTER TO INT' with type 'UDINT'"])
  const sign = "warning: Implicit conversion from unsigned Type 'POINTER TO INT' to signed Type 'LINT' : Possible change of sign"
  expect(every("p := ADR(x);\no := p = li;")).toEqual([sign])
  expect(every("p := ADR(x);\no := p <> si;")).toEqual([sign])
  expect(every("p := ADR(x);\no := i < p;")).toEqual([sign])
  expect(every("p := ADR(x);\no := p = bt;\no := p = ui;")).toEqual([])
  expect(every("p := ADR(x);\no := p = li;", "twincat")).toEqual([sign.replace("Possible", "possible")])
})

test("C0068: two arrays are one type by their FOLDED bounds, each named as the compiler echoes its bounds (cmpop_array_bound_*)", () => {
  const run = (decls: string, body: string) => {
    const src = `PROGRAM P\nVAR CONSTANT\n  N : INT := 2;\nEND_VAR\nVAR\n  b : BOOL;\n${decls}\nEND_VAR\n${body}\nEND_PROGRAM`
    const pr = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult: pr, source: src }], [], "codesys")
    return computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((x) => x.code.startsWith("compare-array"))
      .map((x) => x.message)
  }
  // one type written two ways: the one-type message, naming the LEFT operand as written (both vendors 2026-10-06)
  expect(run("  a1 : ARRAY[1..2] OF INT;\n  a2 : ARRAY[1..N] OF INT;", "b := a1 = a2;")).toEqual([
    "Compare not possible on objects of type 'ARRAY [1..2] OF INT'",
  ])
  // a bound written as an operation comes back parenthesized, as the compiler echoes an operation
  expect(run("  a1 : ARRAY[0..N-1] OF INT;\n  a2 : ARRAY[0..N-1] OF INT;", "b := a1 = a2;")).toEqual([
    "Compare not possible on objects of type 'ARRAY [0..(N - 1)] OF INT'",
  ])
  // two different folded bounds stay two types
  expect(run("  a1 : ARRAY[1..N] OF INT;\n  a3 : ARRAY[1..3] OF INT;", "b := a1 = a3;")).toEqual([
    "Compare not possible on objects of type 'ARRAY [1..N] OF INT' or 'ARRAY [1..3] OF INT'",
  ])
})
