/**
 * Lowering tests of `assign.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { describe, expect, test } from "bun:test"
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
// sameB=FALSE). A foreign target is not modelled, so the whole-value store is refused; a copy of an FB without a pointer
// field still lowers.
test("a whole-value store of an FB whose pointer field targets its own member is refused", () => {
  const codes = (fields: string, read: string) =>
    lowerSource(
      `FUNCTION_BLOCK FB_P\nVAR_INPUT set : INT; END_VAR\nVAR x : INT := 5; ${fields} seen : INT; END_VAR\nIF set <> 0 THEN x := set; END_IF\nseen := ${read};\nEND_FUNCTION_BLOCK\n` +
        "PROGRAM P\nVAR a : FB_P; b : FB_P; rb : INT; END_VAR\nb := a;\na(set := 7);\nb(set := 0);\nrb := b.seen;\nEND_PROGRAM\n",
      "P",
    ).diagnostics.map((d) => d.code)
  expect(codes("p : POINTER TO INT := ADR(x);", "p^")).toEqual(["copy-instance-pointer"])
  expect(codes("", "x")).toEqual([])
})
