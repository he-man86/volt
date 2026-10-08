/**
 * Lowering tests of `cursor.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { describe, expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"

/** Lower and require success — most tests are about the SHAPE, not the failure path. */
function ir(src: string, name?: string) {
  const { pou, diagnostics } = lowerSource(src, name)
  expect(diagnostics).toEqual([])
  return pou!
}

describe("lower — a STRING CURSOR (a character pointer a caller fills with a string's address)", () => {
  /** A library function over a character pointer, as the library repo writes one — `uri` keeps it a library unit. */
  const lib = (name: string, source: string) => ({ uri: `Library Manager/Lib/${name}.pou`, source })

  const LEN = lib("CLEN", "FUNCTION CLEN : DINT\nVAR_INPUT\n\tP : POINTER TO BYTE;\nEND_VAR\nWHILE P^ <> 0 DO\n\tCLEN := CLEN + 1;\n\tP := P + 1;\nEND_WHILE\nEND_FUNCTION\n")

  // hands its cursor on, one byte in: the callee walks the same string from where this one stands
  const TAIL = lib("CTAIL", "FUNCTION CTAIL : DINT\nVAR_INPUT\n\tP : POINTER TO BYTE;\nEND_VAR\nP := P + 1;\nCTAIL := CLEN(P);\nEND_FUNCTION\n")

  const FILL = lib("CFILL", "FUNCTION CFILL : BOOL\nVAR_INPUT\n\tP : POINTER TO BYTE;\n\tN : DINT;\nEND_VAR\nVAR\n\ti : DINT;\nEND_VAR\nFOR i := 0 TO N - 1 DO\n\tP[i] := 16#78;\nEND_FOR\nP[N] := 0;\nEND_FUNCTION\n")

  const WLEN = lib("CWLEN", "FUNCTION CWLEN : DINT\nVAR_INPUT\n\tP : POINTER TO WORD;\nEND_VAR\nWHILE P^ <> 0 DO\n\tCWLEN := CWLEN + 1;\n\tP := P + 2;\nEND_WHILE\nEND_FUNCTION\n")

  const WHOLE = lib("CFIRST", "FUNCTION CFIRST : BYTE\nVAR_INPUT\n\tP : POINTER TO STRING(255);\nEND_VAR\nCFIRST := P^[0];\nEND_FUNCTION\n")

  // two cursors, possibly into ONE string: the characters of FROM from position K on, moved to the front of TO
  const SHIFT = lib("CSHIFT", "FUNCTION CSHIFT : BOOL\nVAR_INPUT\n\tFROM_ : POINTER TO BYTE;\n\tK : DINT;\n\tTO_ : POINTER TO BYTE;\nEND_VAR\nVAR\n\ti : DINT;\nEND_VAR\nWHILE FROM_[K + i] <> 0 DO\n\tTO_[i] := FROM_[K + i];\n\ti := i + 1;\nEND_WHILE\nTO_[i] := 0;\nEND_FUNCTION\n")

  // a byte cursor that walked, handed to a whole-string pointer: `p^` is the string FROM there (lib_prim_string_cursor_offset)
  const FROMBYTE = lib("CFROMBYTE", "FUNCTION CFROMBYTE : BYTE\nVAR_INPUT\n\tQ : POINTER TO BYTE;\nEND_VAR\nQ := Q + 1;\nCFROMBYTE := CFIRST(Q);\nEND_FUNCTION\n")

  const WHOLELEN = lib("CWHOLELEN", "FUNCTION CWHOLELEN : INT\nVAR_INPUT\n\tP : POINTER TO STRING;\nEND_VAR\nVAR\n\tt : STRING;\nEND_VAR\nt := P^;\nCWHOLELEN := BYTE_TO_INT(t[0]);\nEND_FUNCTION\n")

  const WHOLEFROMBYTE = lib("CWHOLEFROMBYTE", "FUNCTION CWHOLEFROMBYTE : INT\nVAR_INPUT\n\tQ : POINTER TO BYTE;\nEND_VAR\nCWHOLEFROMBYTE := CWHOLELEN(Q);\nEND_FUNCTION\n")

  const STEPWHOLE = lib("CSTEPWHOLE", "FUNCTION CSTEPWHOLE : BYTE\nVAR_INPUT\n\tP : POINTER TO STRING;\nEND_VAR\nP := P + 1;\nCSTEPWHOLE := P^[0];\nEND_FUNCTION\n")

  // every StringUtils function starts so — a null pointer answers, it does not fault (lib_prim_null_cursor)
  const LENOR = lib("CLENOR", "FUNCTION CLENOR : DINT\nVAR_INPUT\n\tP : POINTER TO BYTE;\nEND_VAR\nIF P = 0 THEN\n\tCLENOR := -1;\n\tRETURN;\nEND_IF\nCLENOR := CLEN(P);\nEND_FUNCTION\n")

  const DEREF = lib("CDEREF", "FUNCTION CDEREF : BYTE\nVAR_INPUT\n\tP : POINTER TO BYTE;\nEND_VAR\nCDEREF := P[1];\nEND_FUNCTION\n")

  // a whole-string store through a POINTER TO STRING(20) (`cursor_whole_store_capacity`)
  const STORE = lib("CSTORE", "FUNCTION CSTORE : BOOL\nVAR_INPUT\n\tP : POINTER TO STRING(20);\n\tSRC : STRING(10);\nEND_VAR\nP^ := SRC;\nCSTORE := TRUE;\nEND_FUNCTION\n")

  // the same store as a link of an assignment chain, either end (gate 3d review)
  const CHAIN_LEFT = lib("CSTORECL", "FUNCTION CSTORECL : BOOL\nVAR_INPUT\n\tP : POINTER TO STRING(20);\n\tSRC : STRING(10);\nEND_VAR\nVAR\n\tx : STRING(20);\nEND_VAR\nx := P^ := SRC;\nCSTORECL := TRUE;\nEND_FUNCTION\n")
  const CHAIN_RIGHT = lib("CSTORECR", "FUNCTION CSTORECR : BOOL\nVAR_INPUT\n\tP : POINTER TO STRING(20);\n\tSRC : STRING(10);\nEND_VAR\nVAR\n\tx : STRING(20);\nEND_VAR\nP^ := x := SRC;\nCSTORECR := TRUE;\nEND_FUNCTION\n")

  // the same write by a callee: P^ lent to a VAR_IN_OUT STRING(20) it stores into, and an FB output copied out into P^
  const CIO = lib("CIO", "FUNCTION CIO : BOOL\nVAR_IN_OUT\n\tio : STRING(20);\nEND_VAR\nio := 'abcdefghij';\nCIO := TRUE;\nEND_FUNCTION\n")
  const LEND = lib("CSTORELEND", "FUNCTION CSTORELEND : BOOL\nVAR_INPUT\n\tP : POINTER TO STRING(20);\nEND_VAR\nCIO(io := P^);\nCSTORELEND := TRUE;\nEND_FUNCTION\n")
  const FBO = lib("FBO", "FUNCTION_BLOCK FBO\nVAR_OUTPUT\n\to : STRING(10);\nEND_VAR\no := 'abcdefghij';\nEND_FUNCTION_BLOCK\n")
  const COPYOUT = lib("CSTORECOPYOUT", "FUNCTION CSTORECOPYOUT : BOOL\nVAR_INPUT\n\tP : POINTER TO STRING(20);\nEND_VAR\nVAR\n\tf : FBO;\nEND_VAR\nf(o => P^);\nCSTORECOPYOUT := TRUE;\nEND_FUNCTION\n")

  const LIBS = [LEN, TAIL, FILL, WLEN, WHOLE, SHIFT, FROMBYTE, WHOLELEN, WHOLEFROMBYTE, STEPWHOLE, LENOR, DEREF, STORE, CHAIN_LEFT, CHAIN_RIGHT, CIO, LEND, FBO, COPYOUT]

  const scanned = (vars: string, body: string) => {
    const { pou, diagnostics } = lowerSource(`PROGRAM P\nVAR ${vars} END_VAR\n${body}\nEND_PROGRAM\n`, "P", LIBS)
    if (pou === undefined) throw new Error(diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"))
    const p = run(pou)
    p.scan()
    return p
  }

  test("ADR(s) binds the caller's string, and the pointer steps it byte by byte", () => {
    expect(scanned("sv : STRING := 'hello'; n : DINT;", "n := CLEN(ADR(sv));").get("n")).toBe(5n)
  })

  test("a cursor handed on carries on from where it stands", () => {
    expect(scanned("sv : STRING := 'hello'; n : DINT;", "n := CTAIL(ADR(sv));").get("n")).toBe(4n)
  })

  test("a pointer VARIABLE given the string's address binds that string", () => {
    expect(scanned("sv : STRING := 'hello'; ps : POINTER TO STRING; n : DINT;", "ps := ADR(sv);\nn := CLEN(ps);").get("n")).toBe(5n)
  })

  test("a write goes through to the caller's string, cut at the CALLER's capacity", () => {
    expect(scanned("sv : STRING(8);", "CFILL(ADR(sv), 3);").get("sv")).toBe("xxx")
    // the routine is lowered for a STRING(3) here, so its capacity — not a default — is where a store faults
    expect(() => scanned("sv : STRING(3);", "CFILL(ADR(sv), 5);")).toThrow(RangeError)
  })

  test("a WORD cursor walks a WSTRING, and steps by the two bytes a WORD is", () => {
    expect(scanned('w : WSTRING := "h$00E9llo"; n : DINT;', "n := CWLEN(ADR(w));").get("n")).toBe(5n)
  })

  test("a POINTER TO STRING(255) takes a shorter string as it is, and p^ is that string", () => {
    expect(scanned("sv : STRING(20) := 'abc'; c : BYTE;", "c := CFIRST(ADR(sv));").get("c")).toBe(97n)
  })

  test("a whole-string pointer handed a byte cursor that walked: p^[i] counts from where it stands", () => {
    expect(scanned("sv : STRING := 'abc'; a : BYTE; b : BYTE;", "a := CFIRST(ADR(sv)); b := CFROMBYTE(ADR(sv));").get("b")).toBe(98n)
  })

  test("its whole p^ is the string from there, which the model holds no place for — refused, not read from the start", () => {
    const { diagnostics } = lowerSource("PROGRAM P\nVAR sv : STRING := 'abc'; n : INT; END_VAR\nn := CWHOLEFROMBYTE(ADR(sv));\nEND_PROGRAM\n", "P", LIBS)
    expect(diagnostics.map((d) => d.code)).toContain("pointer-value")
    // handed the string's address, it stands at the start: the whole string
    expect(scanned("sv : STRING := 'abc'; n : INT;", "n := CWHOLELEN(ADR(sv));").get("n")).toBe(97n)
  })

  test("a POINTER TO STRING cursor moved along its string is refused", () => {
    const { diagnostics } = lowerSource("PROGRAM P\nVAR sv : STRING := 'abc'; c : BYTE; END_VAR\nc := CSTEPWHOLE(ADR(sv));\nEND_PROGRAM\n", "P", LIBS)
    expect(diagnostics.map((d) => d.code)).toContain("pointer-value")
  })

  test("a NULL pointer variable reaches the callee as 0 — its `IF p = 0 THEN RETURN` answers, and a dereference faults", () => {
    expect(scanned("sv : STRING := 'abc'; ps : POINTER TO STRING; n : DINT; m : DINT;", "ps := ADR(sv);\nn := CLENOR(ps);\nps := 0;\nm := CLENOR(ps);").get("m")).toBe(-1n)
    expect(() => scanned("sv : STRING := 'abc'; ps : POINTER TO STRING; c : BYTE;", "ps := ADR(sv);\nps := 0;\nc := CDEREF(ps);")).toThrow("null pointer")
  })

  test("a STRING stored into a character is refused while lowering — CODESYS does not convert it", () => {
    const { pou, diagnostics } = lowerSource("PROGRAM P\nVAR sv : STRING := 'abc'; END_VAR\nsv[0] := 'X';\nEND_PROGRAM\n", "P")
    expect([pou, diagnostics.map((d) => d.code)]).toEqual([undefined, ["assign-string"]])
  })

  test("two pointers into ONE string share it, each at its own offset — StrMidA(pst := s, pstResult := s)", () => {
    expect(scanned("sv : STRING := 'Device.Main';", "CSHIFT(ADR(sv), 7, ADR(sv));").get("sv")).toBe("Main")
    // into two strings, each is its own
    const p = scanned("sv : STRING := 'Device.Main'; t : STRING(20);", "CSHIFT(ADR(sv), 7, ADR(t));")
    expect([p.get("sv"), p.get("t")]).toEqual(["Device.Main", "Main"])
  })

  // transpile-restructure 3.10: `p^ := src` through a POINTER TO STRING(20) writes min(n, 20) units and a 0 — past the
  // caller's variable when that is shorter. `cursor_whole_store_capacity` (CODESYS 3.5.21.40): a STRING(10) 'abcdefghij'
  // stored through it into a STRING(5) writes 'abcdef' over the 5 + 1 bytes and 'ghij' + 0 into the STRING(10) behind it.
  // Writing past the variable is no place the model holds, so it is refused by name where min(n, m_ptr) > m_caller; a store
  // that fits is the plain store, which keeps the units behind its 0 (M2).
  test("a whole-string store through a cursor that would write past the caller's string is refused; one that fits stores", () => {
    const over = lowerSource("PROGRAM P\nVAR sv : STRING(5); ten : STRING(10) := 'abcdefghij'; END_VAR\nCSTORE(ADR(sv), ten);\nEND_PROGRAM\n", "P", LIBS)
    expect([over.pou, over.diagnostics.map((d) => d.code)]).toEqual([undefined, ["cursor-overrun"]])
    // min(10, 20) = 10 fits a STRING(10) and a STRING(12): written whole, the 0 at [10], [11] kept
    const p = scanned("sv : STRING(12) := 'ZZZZZZZZZZZZ'; ten : STRING(10) := 'abc'; c : BYTE;", "CSTORE(ADR(sv), ten);\nc := sv[11];")
    expect([p.get("sv"), p.get("c")]).toEqual(["abc", 90n])
  })

  // gate 3d review: the store is the same one when it is a link of an assignment chain — `x := P^ := SRC` and
  // `P^ := x := SRC` write the STRING(10) through the POINTER TO STRING(20) as the plain `P^ := SRC` does
  // (`cursor_whole_store_capacity`), so they are refused by the same name.
  test("a whole-string cursor store inside an assignment chain is refused as the plain store is", () => {
    for (const fn of ["CSTORECL", "CSTORECR"]) {
      const over = lowerSource(`PROGRAM P\nVAR sv : STRING(5); ten : STRING(10) := 'abcdefghij'; END_VAR\n${fn}(ADR(sv), ten);\nEND_PROGRAM\n`, "P", LIBS)
      expect([fn, over.pou, over.diagnostics.map((d) => d.code)]).toEqual([fn, undefined, ["cursor-overrun"]])
    }
  })

  // gate 3d review: a callee writes through P^ as well — lent to a VAR_IN_OUT STRING(20) it stores 10 units into, or an
  // FB's STRING(10) output copied out into it. Into a STRING(5) both write past the variable as `P^ := SRC` does
  // (`cursor_whole_store_capacity`); the model would hold 10 units in a STRING(5), or cut them. Refused by the same name
  // (0 such bindings in the six corpora). Into a STRING(20) they fit and run.
  test("P^ lent to a wider VAR_IN_OUT or given a wider output is refused as the store is; one that fits runs", () => {
    for (const fn of ["CSTORELEND", "CSTORECOPYOUT"]) {
      const over = lowerSource(`PROGRAM P\nVAR sv : STRING(5); END_VAR\n${fn}(ADR(sv));\nEND_PROGRAM\n`, "P", LIBS)
      expect([fn, over.pou, over.diagnostics.map((d) => d.code)]).toEqual([fn, undefined, ["cursor-overrun"]])
      const p = scanned("sv : STRING(20);", `${fn}(ADR(sv));`)
      expect([fn, p.get("sv")]).toEqual([fn, "abcdefghij"])
    }
  })

  test("anything but a string's address, a cursor or a pointer to a string is refused, not guessed", () => {
    const { diagnostics } = lowerSource("PROGRAM P\nVAR b : BYTE; n : DINT; END_VAR\nn := CLEN(ADR(b));\nEND_PROGRAM\n", "P", LIBS)
    expect(diagnostics.map((d) => d.code)).toContain("pointer-order")
  })
})

// transpile-review 34: a STRING(n) is n + 1 bytes and `s[i]` a byte access, but the value model held only the characters up
// to the terminator — a store past it was dropped, a 0 forgot the tail, and a POINTER TO BYTE over a STRING was refused.
// CODESYS (`tr_34_lib_prim_char_behind`): the bytes behind the terminator survive and come back when it is overwritten.
test("the bytes behind a STRING's terminator survive, and a POINTER TO BYTE reaches them", () => {
  const source =
    "PROGRAM P\nVAR digits : STRING(10); t : STRING(10) := 'abcdef'; u : STRING(10) := 'abc'; p : POINTER TO BYTE;\n" +
    "copied : STRING(10); END_VAR\n" +
    "digits[4] := 0; digits[3] := 49; digits[2] := 50; digits[1] := 51; digits[0] := 52;\n" +
    "t[2] := 0; t[2] := 88;\n" +
    "p := ADR(u); p[4] := 67; p[3] := 66; copied := u;\nEND_PROGRAM\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  expect(["digits", "t", "u", "copied"].map((n) => runner.get(n))).toEqual(["4321", "abXdef", "abcBC", "abcBC"])
})
