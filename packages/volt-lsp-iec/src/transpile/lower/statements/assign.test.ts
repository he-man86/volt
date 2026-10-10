/**
 * Lowering tests of `assign.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { describe, expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"

describe("lower — a STRING CURSOR (a character pointer a caller fills with a string's address)", () => {
  // transpile-review 38: STRING and WSTRING are isolated from each other and from every other type — CODESYS converts
  // neither way implicitly (`string_wstring_mixing`: "Cannot convert type 'STRING' to type 'WSTRING'", "Cannot compare
  // type 'STRING' with type 'WSTRING'"), and a number stored into a STRING is refused too (`uop_neg_real`: "Cannot
  // convert type 'REAL' to type 'STRING'", every `uop_*` probe). Only the explicit X_TO_Y conversion is legal.
  describe("an implicit string-kind conversion CODESYS refuses is refused while lowering", () => {
    const codes = (vars: string, body: string, extra = ""): { lowered: boolean; codes: string[] } => {
      const { pou, diagnostics } = lowerSource(`PROGRAM P\nVAR ${vars} END_VAR\n${body}\nEND_PROGRAM\n${extra}`, "P")
      return { lowered: pou !== undefined, codes: diagnostics.map((d) => d.code) }
    }
    const NW = "narrow : STRING := 'abc'; wide : WSTRING := \"abc\"; intoWide : WSTRING; intoNarrow : STRING; same : BOOL; rv : REAL; n : INT;"
    test("a STRING stored into a WSTRING", () => expect(codes(NW, "intoWide := narrow;")).toEqual({ lowered: false, codes: ["assign-string"] }))
    test("a WSTRING stored into a STRING", () => expect(codes(NW, "intoNarrow := wide;")).toEqual({ lowered: false, codes: ["assign-string"] }))
    test("a STRING compared with a WSTRING", () => expect(codes(NW, "same := narrow = wide;")).toEqual({ lowered: false, codes: ["string-op"] }))
    test("a REAL stored into a STRING (uop_neg_real)", () => expect(codes(NW, "intoNarrow := -rv;")).toEqual({ lowered: false, codes: ["assign-string"] }))
    test("an INT stored into a STRING", () => expect(codes(NW, "intoNarrow := n;")).toEqual({ lowered: false, codes: ["assign-string"] }))
    test("a chain link that would convert a STRING into a WSTRING", () =>
      expect(codes(NW, "intoWide := intoNarrow := narrow;")).toEqual({ lowered: false, codes: ["assign-string"] }))
    test("an INT argument for a STRING input", () =>
      expect(codes(NW, "intoNarrow := F(n);", "FUNCTION F : STRING\nVAR_INPUT sv : STRING; END_VAR\nF := sv;\nEND_FUNCTION\n")).toEqual({ lowered: false, codes: ["assign-string"] }))
    test("a WSTRING argument for an FB's STRING input", () =>
      expect(codes(`${NW} fb : FB;`, "fb(sv := wide);", "FUNCTION_BLOCK FB\nVAR_INPUT sv : STRING; END_VAR\nEND_FUNCTION_BLOCK\n")).toEqual({ lowered: false, codes: ["assign-string"] }))
    test("the explicit conversions stay legal", () =>
      expect(codes(NW, "intoWide := STRING_TO_WSTRING(narrow); intoNarrow := WSTRING_TO_STRING(wide); intoNarrow := INT_TO_STRING(n); same := narrow = 'abc';")).toEqual({ lowered: true, codes: [] }))
  })
})

// transpile-review 15: `b := a` copied an FB instance whose POINTER field holds ADR(its own member); the copy's pointer
// re-targeted to b's member, where CODESYS keeps a's address (`tr_15_fb_copy_keeps_pointer_address`: rb=7, sameA=TRUE,
// sameB=FALSE). Model 3 (design.md §3.3 step 4d, task 4.7) holds that address: the copy lowers and its pointer reads a's
// member. A pointer that keeps a TAG — at a string's characters, which the image does not hold — still re-targets, so
// that whole-value store stays refused; a copy of an FB without a pointer field lowers as it always did.
test("a whole-value store of an FB whose pointer field holds a TAG of its own member is refused; an address is copied", () => {
  const codes = (fields: string, read: string) =>
    lowerSource(
      `FUNCTION_BLOCK FB_P\nVAR_INPUT set : INT; END_VAR\nVAR x : INT := 5; ${fields} seen : INT; END_VAR\nIF set <> 0 THEN x := set; END_IF\nseen := ${read};\nEND_FUNCTION_BLOCK\n` +
        "PROGRAM P\nVAR a : FB_P; b : FB_P; rb : INT; END_VAR\nb := a;\na(set := 7);\nb(set := 0);\nrb := b.seen;\nEND_PROGRAM\n",
      "P",
    ).diagnostics.map((d) => d.code)
  expect(codes("p : POINTER TO INT := ADR(x);", "p^")).toEqual([])
  expect(codes("txt : STRING := 'abc'; pb : POINTER TO BYTE := ADR(txt);", "BYTE_TO_INT(pb^)")).toEqual(["copy-instance-pointer"])
  expect(codes("", "x")).toEqual([])
})

// transpile-restructure 6.13 (RC 38, the appendix line "a store through a REFERENCE skips the implicit STRING→number
// refusal"): `ri := str` with `ri : REFERENCE TO INT` is the same implicit store as `v := str`, which CODESYS refuses
// (`tr_38_ref_store_*`); it lowered to a conversion no vendor makes. The explicit STRING_TO_INT stays legal.
test("a store through a REFERENCE refuses an implicit STRING conversion as a plain store does", () => {
  const head =
    "PROGRAM P\nVAR\n\ti : INT := 5;\n\tv : INT;\n\tstr : STRING := '12';\n\tw : WSTRING;\n\tri : REFERENCE TO INT;\n\trs : REFERENCE TO STRING;\n\trw : REFERENCE TO WSTRING;\nEND_VAR\nri REF= v;\nrs REF= str;\nrw REF= w;\n"
  const codes = (body: string) => lowerSource(`${head}${body}\nEND_PROGRAM\n`, "P").diagnostics.map((d) => d.code)
  expect(codes("ri := str;")).toEqual(["assign-string"])
  expect(codes("rs := i;")).toEqual(["assign-string"])
  expect(codes("rw := str;")).toEqual(["assign-string"])
  expect(codes("ri := STRING_TO_INT(str);")).toEqual([])
})

// review of 7.6.1 (gate 7.5c+7.7a): a chain over a CONSTANT passes it through each link's conversion — a constant's
// conversion only retypes it, so the direct path (no temp) is taken only where that retyping IS the link's conversion:
// one type, or integers (wrapped as a load would be). A narrower STRING, a REAL and a REAL into an INT keep the temp,
// and each target receives the value as converted THROUGH the inner link (`sint := dint := int`, above).
test("a chain over a constant narrows through each link as a chain over a variable does", () => {
  const { pou, diagnostics } = lowerSource(
    "PROGRAM P\nVAR s10 : STRING(10); s3 : STRING(3); lr : LREAL; rr : REAL; lr2 : LREAL; ii : INT; a : SINT; b : INT; END_VAR\ns10 := s3 := 'abcdef';\nlr := rr := 0.1;\nlr2 := ii := 2.6;\nb := a := 300;\nEND_PROGRAM\n",
    "P",
  )
  expect(diagnostics).toEqual([])
  const runner = run(pou!)
  runner.scan()
  expect([runner.get("s10"), runner.get("s3")]).toEqual(["abc", "abc"])
  expect([runner.get("lr"), runner.get("rr")]).toEqual([Math.fround(0.1), Math.fround(0.1)])
  expect([runner.get("lr2"), runner.get("ii")]).toEqual([3, 3n])
  expect([runner.get("b"), runner.get("a")]).toEqual([44n, 44n])
})
