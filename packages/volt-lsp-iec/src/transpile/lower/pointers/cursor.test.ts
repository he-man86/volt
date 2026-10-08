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

  const LIBS = [LEN, TAIL, FILL, WLEN, WHOLE, SHIFT, FROMBYTE, WHOLELEN, WHOLEFROMBYTE, STEPWHOLE, LENOR, DEREF]

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
