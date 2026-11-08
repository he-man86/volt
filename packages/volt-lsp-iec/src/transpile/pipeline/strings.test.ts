import { describe, expect, test } from "bun:test"
import { load, lowerAndEmit, lowerSource } from "../index.js"

// End to end, ST -> lower -> interpreter: STRING and WSTRING stores and conversions.
describe("interp — STRING (design §18; every expectation recorded in conformance `string_*`)", () => {
  const scanned = (vars: string, body: string) => {
    const pou = load(`PROGRAM P\nVAR\n${vars}\nEND_VAR\n${body}\nEND_PROGRAM\n`)
    pou.scan()
    return pou
  }

  test("a store keeps the target's capacity — STRING(5) := 'abcdefgh' is 'abcde'", () => {
    expect(scanned("five : STRING(5);", "five := 'abcdefgh';").get("five")).toBe("abcde")
  })

  test("a WSTRING counts UTF-16 units — \"héllo\" into a WSTRING(3) is \"hél\"", () => {
    expect(scanned('short3 : WSTRING(3); wide : WSTRING := "héllo";', "short3 := wide;").get("short3")).toBe("hél")
  })

  test("a literal with an embedded $00 ends at the NUL; its bytes are stored, compared and copied as CODESYS holds them", () => {
    // tr_45_string_embedded_nul (CODESYS-recorded): txt reads 'ab', equals both 'ab' and 'ab$00c', txt[2] = txt[3] = 0,
    // and the copy u is 'ab' with u[3] = 0. (LEN/CONCAT run from the library repo, so the fixture covers those rows.)
    const pou = scanned(
      "txt : STRING(3) := 'ab$00c'; u : STRING(10); c2 : BYTE; c3 : BYTE; uc3 : BYTE; eqAb : BOOL; eqFull : BOOL;",
      "eqAb := txt = 'ab'; eqFull := txt = 'ab$00c'; c2 := txt[2]; c3 := txt[3]; u := txt; uc3 := u[3];",
    )
    expect(["txt", "eqAb", "eqFull", "c2", "c3", "u", "uc3"].map((n) => pou.get(n))).toEqual([
      "ab", true, true, 0n, 0n, "ab", 0n,
    ])
  })

  // Model 2's store (design §3.2, `storeString`): min(n, m) units of the SOURCE's buffer and a 0, the destination's units
  // behind them kept. The units are read back through `s[i]`, which reaches the whole buffer.
  test("a store into a wider string keeps the destination's units behind the source's (string_assign_tail_wide)", () => {
    // recorded: 97 98 99 0 101…106 0, then 90 at [11..19] and 0 at [20]
    const pou = scanned(
      "src : STRING(10); dst : STRING(20); u4 : BYTE; u10 : BYTE; u11 : BYTE; u19 : BYTE; u20 : BYTE;",
      "src := 'abcdefghij'; src[3] := 0; dst := 'ZZZZZZZZZZZZZZZZZZZZ'; dst := src; u4 := dst[4]; u10 := dst[10]; u11 := dst[11]; u19 := dst[19]; u20 := dst[20];",
    )
    expect(["dst", "u4", "u10", "u11", "u19", "u20"].map((n) => pou.get(n))).toEqual(["abc", 101n, 0n, 90n, 90n, 0n])
  })

  test("a literal is a source of its own units, the ones behind its $00 too (string_literal_nul_tail)", () => {
    // recorded: 'ab$00cd' over 'ZZZZZZZZZZ' is 97 98 0 99 100 0 90 90 90 90 0
    const pou = scanned("a : STRING(10); u3 : BYTE; u5 : BYTE; u6 : BYTE; u9 : BYTE;", "a := 'ZZZZZZZZZZ'; a := 'ab$00cd'; u3 := a[3]; u5 := a[5]; u6 := a[6]; u9 := a[9];")
    expect(["a", "u3", "u5", "u6", "u9"].map((n) => pou.get(n))).toEqual(["ab", 99n, 0n, 90n, 90n])
  })

  test("an FB's VAR_INPUT is stored into by the call's pass, keeping its own units behind (string_store_destination_kinds_tail)", () => {
    const pou = load(
      "FUNCTION_BLOCK FB_In\nVAR_INPUT\n\tp : STRING(20);\nEND_VAR\nEND_FUNCTION_BLOCK\n\n" +
        "PROGRAM P\nVAR\n\tsrc : STRING(10);\n\tfb : FB_In;\n\tu4 : BYTE;\n\tu11 : BYTE;\nEND_VAR\n" +
        "src := 'abcdefghij';\nsrc[3] := 0;\nfb.p := 'ZZZZZZZZZZZZZZZZZZZZ';\nfb(p := src);\nu4 := fb.p[4];\nu11 := fb.p[11];\nEND_PROGRAM\n",
      "P",
    )
    pou.scan()
    expect([pou.get("u4"), pou.get("u11")]).toEqual([101n, 90n])
  })

  test("an FB's VAR_OUTPUT copied out by => is a store: the wider target keeps its units behind (string_store_destination_kinds_tail)", () => {
    // recorded (gate 3c): out = 97 98 99 0 101…106 0 at [0..10], then 90 at [11..19] and 0 at [20]
    const pou = load(
      "FUNCTION_BLOCK FB_Out\nVAR_OUTPUT\n\to : STRING(10);\nEND_VAR\no := 'abcdefghij';\no[3] := 0;\nEND_FUNCTION_BLOCK\n\n" +
        "PROGRAM P\nVAR\n\tfb : FB_Out;\n\tt : STRING(20) := 'ZZZZZZZZZZZZZZZZZZZZ';\n\tu4 : BYTE;\n\tu10 : BYTE;\n\tu11 : BYTE;\n\tu19 : BYTE;\nEND_VAR\n" +
        "fb(o => t);\nu4 := t[4];\nu10 := t[10];\nu11 := t[11];\nu19 := t[19];\nEND_PROGRAM\n",
      "P",
    )
    pou.scan()
    expect(["t", "u4", "u10", "u11", "u19"].map((n) => pou.get(n))).toEqual(["abc", 101n, 0n, 90n, 90n])
  })

  test("s[i] reaches behind the terminator: a right-to-left fill and a 0 overwritten (tr_34_lib_prim_char_behind)", () => {
    const pou = scanned(
      "digits : STRING(10); t : STRING(10) := 'abcdef';",
      "digits := ''; digits[4] := 0; digits[3] := 49; digits[2] := 50; digits[1] := 51; digits[0] := 52; t := 'abcdef'; t[2] := 0; t[2] := 88;",
    )
    expect([pou.get("digits"), pou.get("t")]).toEqual(["4321", "abXdef"])
  })

  test("STRING_TO_REAL reads a decimal prefix after spaces and tabs — and nothing numeric is 0", () => {
    const pou = scanned(
      "dotFirst : STRING := '.5'; bareExp : STRING := '$T1.5E'; wrd : STRING := 'abc'; x : REAL; y : REAL; z : REAL;",
      "x := STRING_TO_REAL(dotFirst); y := STRING_TO_REAL(bareExp); z := STRING_TO_REAL(wrd);",
    )
    expect([pou.get("x"), pou.get("y"), pou.get("z")]).toEqual([0.5, 1.5, 0])
  })

  test("STRING_TO_INT skips leading spaces, takes a sign, stops at a non-digit — and wraps", () => {
    const pou = scanned("spaced : STRING := ' +12abc'; huge : STRING := '99999'; x : INT; y : INT;", "x := STRING_TO_INT(spaced); y := STRING_TO_INT(huge);")
    expect([pou.get("x"), pou.get("y")]).toEqual([12n, -31073n])
  })
})

/**
 * THE PROJECT'S "UTF-8 Encoding for STRING" IS AN INPUT (handed as its `.projectsettings`): CODESYS 3.5.21.40, commit
 * 1d71f12416 — on (the exec oracle's project, `slit_*` / `wsu_*` recorded) a STRING past ASCII is UTF-8; off (the
 * build-recording project) a literal is Latin-1 with '?' per UTF-16 unit past it, WSTRING_TO_STRING keeps each unit's low
 * byte and STRING_TO_WSTRING widens byte for byte. Unstated, neither is guessed: each is refused by name.
 */
describe("interp — a STRING past ASCII as the project's \"UTF-8 Encoding for STRING\" makes it", () => {
  const settings = (row: string) => [{ uri: "Project Settings.projectsettings", source: `Replace constants:     on\n${row}Max compiler warnings: 100\n` }]
  const ON = settings("UTF-8 encoding:        on\n")
  const OFF = settings("UTF-8 encoding:        off\n")
  const program = (vars: string, body: string) => `PROGRAM P\nVAR\n${vars}\nEND_VAR\n${body}\nEND_PROGRAM\n`
  const bytes = (n: number) => Array.from({ length: n }, (_, i) => `u${i} : WORD;`).join(" ")
  const reads = (of: string, n: number) => Array.from({ length: n }, (_, i) => `u${i} := ${of}[${i}];`).join(" ")
  /** `body` run once on `files`' settings: `n` (the units before the terminator, counted as LEN counts them — LEN is a
   *  library's) and the first `count` units of `of`. */
  const units = (files: typeof ON, vars: string, body: string, of: string, count: number) => {
    const pou = load(program(`n : INT; ${vars} ${bytes(count)}`, `${body} ${reads(of, count)}`), "P", files)
    pou.scan()
    return [pou.get("n"), ...Array.from({ length: count }, (_, i) => pou.get(`u${i}`))]
  }
  const literal = (files: typeof ON, text: string, count: number) => units(files, "txt : STRING;", `txt := '${text}'; n := 0; WHILE txt[n] <> 0 DO n := n + 1; END_WHILE`, "txt", count)

  test("off: a literal is Latin-1, '?' for each UTF-16 unit past U+00FF", () => {
    expect(literal(OFF, "größe", 6)).toEqual([5n, 103n, 114n, 246n, 223n, 101n, 0n])
    expect(literal(OFF, "a计b", 4)).toEqual([3n, 97n, 63n, 98n, 0n])
    expect(literal(OFF, "a😀b", 5)).toEqual([4n, 97n, 63n, 63n, 98n, 0n])
  })

  test("on: a literal is its UTF-8 bytes (slit_two_byte, slit_four_byte)", () => {
    expect(literal(ON, "größe", 8)).toEqual([7n, 103n, 114n, 195n, 182n, 195n, 159n, 101n, 0n])
    expect(literal(ON, "a😀b", 7)).toEqual([6n, 97n, 240n, 159n, 152n, 128n, 98n, 0n])
  })

  test("off: WSTRING_TO_STRING keeps each unit's low byte — a surrogate pair's 16#3D then 0 ends it", () => {
    const narrow = (text: string) => units(OFF, "w : WSTRING; txt : STRING;", `w := "${text}"; txt := WSTRING_TO_STRING(w); n := 0; WHILE txt[n] <> 0 DO n := n + 1; END_WHILE`, "txt", 4)
    expect(narrow("a计b")).toEqual([3n, 97n, 0xa1n, 98n, 0n])
    expect(narrow("a$D83D$DE00b")).toEqual([2n, 97n, 0x3dn, 0n, 98n])
  })

  test("off: STRING_TO_WSTRING widens byte for byte — the Latin-1 literal back to its characters", () => {
    expect(units(OFF, "w : WSTRING;", "w := STRING_TO_WSTRING('größe');", "w", 6)).toEqual([0n, 103n, 114n, 246n, 223n, 101n, 0n])
  })

  test("on: the same conversions as UTF-8 (wsu_narrow_three_byte, slit_widen_two_byte)", () => {
    expect(units(ON, "w : WSTRING; txt : STRING;", `w := "a计b"; txt := WSTRING_TO_STRING(w); n := 0; WHILE txt[n] <> 0 DO n := n + 1; END_WHILE`, "txt", 5)).toEqual([5n, 97n, 232n, 174n, 161n, 98n])
    expect(units(ON, "w : WSTRING;", "w := STRING_TO_WSTRING('größe');", "w", 6)).toEqual([0n, 103n, 114n, 246n, 223n, 101n, 0n])
  })

  test("unstated, a literal past ASCII and every STRING <-> WSTRING conversion are refused by name; ASCII needs no setting", () => {
    const refused = (vars: string, body: string) => lowerSource(program(vars, body), "P").diagnostics.map((d) => [d.code, d.message])
    expect(refused("txt : STRING;", "txt := 'größe';")).toEqual([
      ["string-encoding-unstated", `'größe' holds a character past ASCII, whose bytes the project's "UTF-8 Encoding for STRING" decides — no .projectsettings states it`],
    ])
    expect(refused("w : WSTRING; txt : STRING;", "txt := WSTRING_TO_STRING(w);")).toEqual([
      ["string-encoding-unstated", `WSTRING_TO_STRING crosses as the project's "UTF-8 Encoding for STRING" decides — no .projectsettings states it`],
    ])
    expect(refused("w : WSTRING; txt : STRING;", "w := TO_WSTRING(txt);").map(([code]) => code)).toEqual(["string-encoding-unstated"])
    // a TwinCAT descriptor states no such row: still unstated
    const twincat = [{ uri: "Project Settings.projectsettings", source: "Replace constants:     on\n" }]
    expect(lowerSource(program("txt : STRING;", "txt := 'é';"), "P", twincat).diagnostics.map((d) => d.code)).toEqual(["string-encoding-unstated"])
    expect(refused("txt : STRING;", "txt := 'plain';")).toEqual([])
  })

  test("a .projectsettings the reader refuses, or a second one, is refused as the descriptor it is", () => {
    const bad = settings("UTF-8 encoding:        yes\n")
    expect(lowerSource(program("x : INT;", "x := 1;"), "P", bad).diagnostics.map((d) => [d.code, d.uri, d.message])).toEqual([
      ["project-settings", "Project Settings.projectsettings", `.projectsettings: "UTF-8 encoding" is 'yes', neither 'on' nor 'off'`],
    ])
    const two = [...ON, { uri: "Other/Project Settings.projectsettings", source: "UTF-8 encoding:        off\n" }]
    expect(lowerSource(program("x : INT;", "x := 1;"), "P", two).diagnostics.map((d) => d.code)).toEqual(["project-settings"])
  })

  test("the emitted Rust crosses as the node's encoding says", () => {
    const body = program("w : WSTRING; txt : STRING;", "txt := WSTRING_TO_STRING(w); w := STRING_TO_WSTRING(txt);")
    expect(lowerAndEmit(body, "P", OFF).emitted.code).toContain(".narrow_low_byte::<255>()")
    expect(lowerAndEmit(body, "P", OFF).emitted.code).toContain(".widen_bytes::<255>()")
    expect(lowerAndEmit(body, "P", ON).emitted.code).toContain(".narrow::<255>()")
    expect(lowerAndEmit(body, "P", ON).emitted.code).toContain(".widen::<255>()")
  })
})
