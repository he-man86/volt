/**
 * implicit-conversion — the WARNINGs derived from `classifyConversion`: narrow (loss) + sign-change. Both
 * wordings confirmed live (only "Possible"/"possible" differs per vendor). Also pins that an ERROR kind
 * (integer narrowing) does NOT also produce a conversion warning — one site, one diagnostic.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig, type Vendor } from "../../index.js"

const conv = (decls: string, body: string, vendor: Vendor = "codesys") => {
  const src = `FUNCTION_BLOCK F\nVAR\n${decls}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src)
  const p = buildSymbolTable([{ uri: "F.fb", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project: p, config: resolveConfig({ vendor }) }).filter(
    (d) => d.code === "narrowing-conversion" || d.code === "sign-change-conversion",
  )
}

test("each `:=` link of a chained assignment is its own store — the inner narrowing warns", () => {
  // Why missed: the check paired only the outer target with the final value; chains arrived with the execution programs
  // (conformance `assign_chained_plain`: `outL := midR := srcL` warns LREAL → REAL once).
  const diags = conv("x : INT; y : INT; z : INT; srcL : LREAL; midR : REAL; outL : LREAL;", "x := y := z;\noutL := midR := srcL;")
  expect(diags.map((d) => d.message)).toEqual(["Implicit conversion from 'LREAL' to 'REAL': Possible loss of information"])
})

test("a same-width signed/unsigned pair warns on the operand the operation converts", () => {
  // Why missed: only assignments, conversion arguments and unary minus were walked — never an operator's operands. The
  // execution programs mixed signs inside expressions, and their builds warned where the LSP was silent (conformance
  // `cc_add_*`, `cc_bitwise_*`, `cc_not_*`, `cc_max_*`, `cc_*_udint_dint`, `cc_compare_uint_int`).
  const msgs = conv(
    "wv : WORD; si : INT; bv : BYTE; sn : SINT; un : UINT; ud : UDINT; di : DINT; res : DINT; ok : BOOL;",
    "res := wv + si;\nres := bv AND sn;\nres := NOT sn;\nres := MAX(ud, di);\nok := ud <= di;\nok := un > si;\nres := un XOR 1;\nres := sn AND 255;",
  ).map((d) => d.message)
  expect(msgs).toEqual([
    "Implicit conversion from unsigned Type 'WORD' to signed Type 'INT' : Possible change of sign",
    "Implicit conversion from signed Type 'SINT' to unsigned Type 'USINT' : Possible change of sign",
    "Implicit conversion from signed Type 'SINT' to unsigned Type 'USINT' : Possible change of sign",
    "Implicit conversion from unsigned Type 'UDINT' to signed Type 'DINT' : Possible change of sign",
    "Implicit conversion from unsigned Type 'UDINT' to signed Type 'DINT' : Possible change of sign",
    "Implicit conversion from signed Type 'SINT' to unsigned Type 'USINT' : Possible change of sign",
  ])
})

test("a REAL literal beyond REAL's range is an LREAL — the only real literal that warns into a REAL", () => {
  // Why missed: a literal's warning type was measured for integers only (conformance `cc_real_init_max`, `_tiny`,
  // `_sci_fraction`; `real_to_string_digits`).
  const msgs = conv("big : REAL := 3.4028235E38; mid : REAL := 1.5E8; tiny : REAL := 2.5E-10;", "").map((d) => d.message)
  // twice, because it is an FB DECLARATION's initializer — see `pushForDeclaration`
  expect(msgs).toEqual([
    "Implicit conversion from 'LREAL' to 'REAL': Possible loss of information",
    "Implicit conversion from 'LREAL' to 'REAL': Possible loss of information",
  ])
})

test("a typed literal sum folds into the narrowest type of its signedness that holds it", () => {
  // Why missed: inference typed `USINT#200 + USINT#100` as USINT, its operands' type (conformance `cc_typed_fold_*`).
  const msgs = conv("i : INT; d : DINT;", "i := USINT#200 + USINT#100;\ni := SINT#100 + SINT#100;\ni := USINT#1 + USINT#2;\nd := INT#30000 + INT#30000;")
  expect(msgs.map((d) => d.message)).toEqual(["Implicit conversion from unsigned Type 'UINT' to signed Type 'INT' : Possible change of sign"])
})

test("an enum value into an unsigned type warns change of sign as a signed INT would — it was never typed here", () => {
  // The warning typed the value by inference alone, which gives an enum VALUE no type (conformance `cc_enum_into_uint`,
  // `cc_enum_into_dword`; into DINT silent, `cc_enum_into_dint`).
  const src = `TYPE E_Mode :\n(\n\tIdle := 0,\n\tBusy := 1\n);\nEND_TYPE\n\nFUNCTION_BLOCK F\nVAR\n\tu : UINT;\n\tw : DWORD;\n\ti : DINT;\nEND_VAR\nu := E_Mode.Busy;\nw := E_Mode.Busy;\ni := E_Mode.Busy;\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src)
  const p = buildSymbolTable([{ uri: "F.fb", parseResult: pr, source: src }])
  const messages = computeSemanticDiagnostics({ parseResult: pr, source: src, project: p, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "sign-change-conversion")
    .map((d) => d.message)
  expect(messages).toEqual([
    "Implicit conversion from signed Type 'E_MODE' to unsigned Type 'UINT' : Possible change of sign",
    "Implicit conversion from signed Type 'E_MODE' to unsigned Type 'DWORD' : Possible change of sign",
  ])
})

test("a LIBRARY enum stays silent — real builds store one into a WORD without the warning", () => {
  // bakon-nano and pro2193 assign `L_IE1P_Error` variables to WORDs and their builds report no change of sign, while a
  // project enum's variable does warn (conformance `cc_enum_var_into_word`). Why is unrecorded, so no rule is guessed.
  const lib = `TYPE E_Lib :\n(\n\tIdle := 0,\n\tBusy := 1\n);\nEND_TYPE`
  const src = `FUNCTION_BLOCK F\nVAR\n\te : E_Lib;\n\tw : WORD;\nEND_VAR\nw := e;\nEND_FUNCTION_BLOCK`
  const libResult = parseSource(lib)
  const pr = parseSource(src)
  const p = buildSymbolTable([
    { uri: "Application/Library Manager/Lib/E_Lib.enum", parseResult: libResult, source: lib },
    { uri: "F.fb", parseResult: pr, source: src },
  ])
  const d = computeSemanticDiagnostics({ parseResult: pr, source: src, project: p, config: resolveConfig({ vendor: "codesys" }) })
  expect(d.filter((x) => x.code === "sign-change-conversion")).toEqual([])
})

test("narrowing (LREAL→REAL) warns 'possible loss of information'", () => {
  const d = conv("r : REAL; l : LREAL;", "r := l;")
  expect(d).toHaveLength(1)
  expect(d[0]).toMatchObject({ severity: "warning", code: "narrowing-conversion" })
  expect(d[0]?.message).toBe("Implicit conversion from 'LREAL' to 'REAL': Possible loss of information")
})

test("sign-change (WORD→INT) warns byte-identical; vendor differs only in caps", () => {
  const cs = conv("x : INT; w : WORD;", "x := w;")
  expect(cs[0]).toMatchObject({ severity: "warning", code: "sign-change-conversion" })
  expect(cs[0]?.message).toBe("Implicit conversion from unsigned Type 'WORD' to signed Type 'INT' : Possible change of sign")
  const tc = conv("x : INT; w : WORD;", "x := w;", "twincat")
  expect(tc[0]?.message).toBe("Implicit conversion from unsigned Type 'WORD' to signed Type 'INT' : possible change of sign")
})

test("an untyped integer literal the target cannot hold warns as its literal type (gap 13)", () => {
  // silent before: a bare integer literal typed UNKNOWN (conformance `cc_literal_*`, `overflow_*`)
  const msgs = (decls: string, body: string) => conv(decls, body).map((d) => d.message)
  expect(msgs("si : SINT;", "si := 128;")).toEqual(["Implicit conversion from unsigned Type 'USINT' to signed Type 'SINT' : Possible change of sign"])
  expect(msgs("i : INT;", "i := 40000;")).toEqual(["Implicit conversion from unsigned Type 'UINT' to signed Type 'INT' : Possible change of sign"])
  expect(msgs("d : DINT;", "d := 3000000000;")).toEqual(["Implicit conversion from unsigned Type 'UDINT' to signed Type 'DINT' : Possible change of sign"])
  expect(msgs("us : USINT;", "us := -1;")).toEqual(["Implicit conversion from signed Type 'SINT' to unsigned Type 'USINT' : Possible change of sign"])
  // a declaration's initializer too — and an FB's is reported TWICE, as the IDE does (`pushForDeclaration`)
  expect(msgs("u : UINT := -5;", "")).toEqual([
    "Implicit conversion from signed Type 'SINT' to unsigned Type 'UINT' : Possible change of sign",
    "Implicit conversion from signed Type 'SINT' to unsigned Type 'UINT' : Possible change of sign",
  ])
  // silent: the target holds the value (a small literal into an unsigned or a bit string warns nothing), or it is an error
  expect(msgs("us : USINT; w : WORD; b : BYTE; si : SINT; r : REAL;", "us := 5; w := 5; b := 0; si := 127; r := 5; b := 300;")).toEqual([])
})

test("sign-change fires both directions (signed→unsigned too)", () => {
  const d = conv("u : UINT; i : INT;", "u := i;")
  expect(d[0]?.message).toBe("Implicit conversion from signed Type 'INT' to unsigned Type 'UINT' : Possible change of sign")
})

test("an integer narrowing (DINT→INT) is an ERROR, not a conversion warning — no double diagnostic", () => {
  expect(conv("x : INT; d : DINT;", "x := d;")).toEqual([]) // the assignment-type-mismatch check owns it
})

test("a safe widening (SINT→INT) produces no conversion warning", () => {
  expect(conv("x : INT; s : SINT;", "x := s;")).toEqual([])
})

// ── conversion-function ARGUMENTS: `<SRC>_TO_<DST>(arg)` implicitly converts `arg` to `<SRC>` ──────────────
// Corpus-found (lenze): `REAL_TO_DINT(<LREAL>)` and `UINT_TO_WORD(<INT>)` — CODESYS warns on the argument
// exactly as an assignment to a `<SRC>` variable would. The assignment-only check missed this whole class.

test("conversion arg that narrows (REAL_TO_DINT of an LREAL) warns 'loss of information'", () => {
  const d = conv("d : DINT; l : LREAL;", "d := REAL_TO_DINT(l);")
  expect(d).toHaveLength(1)
  expect(d[0]?.message).toBe("Implicit conversion from 'LREAL' to 'REAL': Possible loss of information")
})

test("conversion arg that sign-changes (UINT_TO_WORD of an INT) warns 'change of sign'", () => {
  const d = conv("w : WORD; i : INT;", "w := UINT_TO_WORD(i);")
  expect(d).toHaveLength(1)
  expect(d[0]?.message).toBe("Implicit conversion from signed Type 'INT' to unsigned Type 'UINT' : Possible change of sign")
})

test("conversion arg already the source type does NOT warn (zero-FP)", () => {
  expect(conv("r : REAL; i : INT;", "r := INT_TO_REAL(i);")).toEqual([]) // arg INT = source INT
  expect(conv("i : INT; w : WORD;", "i := WORD_TO_INT(w);")).toEqual([]) // arg WORD = source WORD
  expect(conv("s : STRING; i : INT;", "s := TO_STRING(i);")).toEqual([]) // TO_STRING has no elementary source
})

// EXPT is modeled as returning LREAL, so a conversion whose arg is an EXPT result sees the narrowing.
// Corpus-found (lenze fc_DintToTime): `REAL_TO_DINT(EXPT(10, DecShift))` — LREAL result narrows into REAL.
test("a conversion arg that is an EXPT result (LREAL) narrows into a REAL source", () => {
  const d = conv("d : DINT; n : DINT;", "d := REAL_TO_DINT(EXPT(10, n));")
  expect(d).toHaveLength(1)
  expect(d[0]?.message).toBe("Implicit conversion from 'LREAL' to 'REAL': Possible loss of information")
})
