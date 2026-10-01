import { test, expect } from "bun:test"
import { lex } from "./lexer.js"
import { isTrivia, type Token } from "./tokens.js"

// Non-trivia tokens, the stream the parser actually consumes.
const code = (src: string): Token[] => lex(src, "codesys").filter((t) => !isTrivia(t.kind))

test("keywords are canonicalized case-insensitively", () => {
  const [t] = code("function_block")
  expect(t.kind).toBe("keyword")
  expect(t.keyword).toBe("FUNCTION_BLOCK")
  expect(t.text).toBe("function_block") // original casing preserved
})

test("multi-char punct beats single-char (`:=` not `:` `=`)", () => {
  const toks = code("x := 1")
  expect(toks.map((t) => t.text)).toEqual(["x", ":=", "1", ""]) // last is eof
})

test("range `..` does not eat the number's dot", () => {
  const toks = code("1..5")
  expect(toks.map((t) => t.kind).slice(0, 3)).toEqual(["int_lit", "punct", "int_lit"])
  expect(toks[1].text).toBe("..")
})

test("a TIME literal has no microsecond or nanosecond unit — it ends there; an LTIME literal keeps it (gap 7)", () => {
  // CODESYS lexes `T#1500US` as `T#1500` then `US` (conformance `cc_time_*`); the LSP read it as one literal and accepted it.
  expect(code("T#1500US").slice(0, 2).map((t) => [t.kind, t.text])).toEqual([["time_lit", "T#1500"], ["identifier", "US"]])
  expect(code("TIME#1s500ns").slice(0, 2).map((t) => [t.kind, t.text])).toEqual([["time_lit", "TIME#1s500"], ["identifier", "ns"]])
  expect(code("LTIME#1500US")[0]).toMatchObject({ kind: "time_lit", text: "LTIME#1500US" })
  expect(code("T#1d2h3m4s5ms")[0]).toMatchObject({ kind: "time_lit", text: "T#1d2h3m4s5ms" })
})

test("literal families", () => {
  expect(code("T#10ms")[0].kind).toBe("time_lit")
  expect(code("DT#2020-01-01-00:00:00")[0].kind).toBe("datetime_lit")
  expect(code("INT#42")[0].kind).toBe("typed_lit")
  expect(code("16#FF")[0].kind).toBe("int_lit")
  expect(code("1.5e3")[0].kind).toBe("real_lit")
  expect(code("%IX0.0")[0].kind).toBe("address_lit")
  expect(code("'hi'")[0].kind).toBe("string_lit")
})

// Gap found via a re-harvested corpus (IODrvEtherCAT enum): a typed BASED literal carries a SECOND `#`.
test("a typed based literal (`WORD#16#1`) lexes as one whole typed_lit token", () => {
  const toks = code("WORD#16#1").filter((t) => t.kind !== "eof")
  expect(toks).toHaveLength(1)
  expect(toks[0].kind).toBe("typed_lit")
  expect(toks[0].text).toBe("WORD#16#1")
  // As it appears in library enums: `START := WORD#16#1, DONE := DWORD#2#1010`
  expect(code("DWORD#2#1010")[0].text).toBe("DWORD#2#1010")
})

test("ExST set/reset assignment operators lex as one punct", () => {
  const toks = code("x S= 1")
  expect(toks[1].kind).toBe("punct")
  expect(toks[1].text).toBe("S=")
})

test("nestable block comments are trivia", () => {
  const all = lex("(* outer (* inner *) still *) x", "codesys")
  expect(all.find((t) => t.kind === "block_comment")).toBeDefined()
  expect(code("(* outer (* inner *) still *) x").map((t) => t.text)).toEqual(["x", ""])
})

test("eof always terminates the stream", () => {
  const toks = lex("", "codesys")
  expect(toks.at(-1)?.kind).toBe("eof")
})

// ─── the vocabulary, as CODESYS records it (frontend-conformance 2.1.2, L13) ─────────────────────────────────────────

test("USING and WITH are names, not keywords — CODESYS accepts both as a variable name (L13)", () => {
  // `lex_reserved_unused_keyword_as_name_using` builds with the C0543 warning only, `_with` builds clean (2026-09-30);
  // a keyword here made both a parse error the vendor never reports.
  expect(code("using")[0]).toMatchObject({ kind: "identifier", text: "using" })
  expect(code("WITH")[0]).toMatchObject({ kind: "identifier", text: "WITH" })
})

test("READ_ONLY, READ_WRITE, FROM and PARAMS stay reserved — CODESYS refuses each as a name (L13)", () => {
  // `lex_reserved_unused_keyword_as_name_{read_only,read_write,from,params}`: "Unexpected token '<name>' found"
  for (const w of ["read_only", "READ_WRITE", "From", "params"]) expect(code(w)[0].kind).toBe("keyword")
})

// ─── the dialect vocabulary (task 2.1.4, L10/L11) ────────────────────────────────────────────────────────────────────

test("the CODESYS-only words are keywords on CODESYS and identifiers on TwinCAT — `__VECTOR` among them (L10, L11)", () => {
  // `lex_keyword_*_sys_vector` (2026-09-30): CODESYS refuses `__vector` as every reserved word is refused; TwinCAT calls
  // it an undefined identifier, as it does `__position`, `__pouname` and `__compare_and_swap`
  for (const w of ["__VECTOR", "__position", "__PouName", "__compare_and_swap"]) {
    expect(code(w)[0].kind).toBe("keyword")
    expect(lex(w, "twincat")[0]).toMatchObject({ kind: "identifier", text: w })
  }
})

// ─── the literals, as CODESYS and TwinCAT record them (frontend-conformance 2.2, N1–N25, S1–S9) ────────────────────
// A MALFORMED literal is one token the vendor refuses whole — "Expression expected instead of 'X'" names it — and it
// ends where the vendor's lexer stopped, which is what the rest of each recorded cascade is made of.

/** `[kind, text, malformed?]` for each code token before eof. */
const shape = (src: string, dialect: "codesys" | "twincat" = "codesys"): (string | boolean)[][] =>
  lex(src, dialect)
    .filter((t) => !isTrivia(t.kind) && t.kind !== "eof")
    .map((t) => (t.malformed ? [t.kind, t.text, true] : [t.kind, t.text]))

test("a based integer takes only its base's digits; a base other than 2, 8, 10 or 16 is refused at the `#` (N3–N6)", () => {
  // `lit_invalid_digit_binary`, `_octal`, `_hex`: the literal ends at the first digit its base does not have
  expect(shape("2#102")).toEqual([["int_lit", "2#10"], ["int_lit", "2"]])
  expect(shape("8#78")).toEqual([["int_lit", "8#7"], ["int_lit", "8"]])
  expect(shape("16#FG")).toEqual([["int_lit", "16#F"], ["identifier", "G"]])
  // `lit_invalid_base_3`, `_4`, `_12`: "Expression expected instead of '3#'", then the digits on their own
  for (const b of ["3", "4", "12"]) expect(shape(`${b}#12`)).toEqual([["int_lit", `${b}#`, true], ["int_lit", "12"]])
  // `lit_invalid_base_10`: base ten written out is a literal (its value is 12)
  expect(shape("10#12")).toEqual([["int_lit", "10#12"]])
})

test("`_` separates digits anywhere in an integer — doubled, trailing, after the base's `#` (N2)", () => {
  // `lit_int_underscore*` all build, and the run recording reads the values with the separators dropped
  for (const t of ["1_000_000", "16#FFFF_FFFF", "2#1010_1010", "1__000", "1000_", "16#_FF"]) expect(shape(t)).toEqual([["int_lit", t]])
})

test("a typed integer or bit string takes an optional `-`, then digits, then — unsigned only — a base (N8–N10)", () => {
  for (const t of ["BYTE#200", "LWORD#10000000000000000000", "WORD#16#FF", "BYTE#2#1010_0101", "DWORD#8#777", "INT#16#7FFF", "INT#-5", "UINT#-5"])
    expect(shape(t)).toEqual([["typed_lit", t]])
  // `lit_int_typed_plus`: no `+` — the prefix alone is the refused token
  expect(shape("INT#+5")).toEqual([["typed_lit", "INT#", true], ["punct", "+"], ["int_lit", "5"]])
  // `lit_int_typed_negative_based`: a signed number takes no base — the token ends at the second `#`
  expect(shape("INT#-16#10")).toEqual([["typed_lit", "INT#-16", true], ["unknown", "#"], ["int_lit", "10"]])
})

test("a typed BOOL is one character, and only 0 or 1 is a value (N15)", () => {
  expect(shape("BOOL#1")).toEqual([["typed_lit", "BOOL#1"]])
  expect(shape("BOOL#0")).toEqual([["typed_lit", "BOOL#0"]])
  // `lit_bool_typed_true`/`_false`: "Expression expected instead of 'BOOL#T'", then `RUE` is a name
  expect(shape("BOOL#TRUE")).toEqual([["typed_lit", "BOOL#T", true], ["identifier", "RUE"]])
  expect(shape("BOOL#FALSE")).toEqual([["typed_lit", "BOOL#F", true], ["identifier", "ALSE"]])
  expect(shape("BOOL#2")).toEqual([["typed_lit", "BOOL#2", true]])
})

test("a REAL needs a digit after its point; its exponent may be capital, signed, or stand without a point (N12a, N12b)", () => {
  for (const t of ["1.5E3", "1.5E+3", "2E3", "1_000.25", "1.5e-3"]) expect(shape(t)).toEqual([["real_lit", t]])
  // `lit_real_no_fraction_digit`: "Expression expected instead of '5.'"
  expect(shape("5.;")).toEqual([["real_lit", "5.", true], ["punct", ";"]])
  // …and a range is still no fraction
  expect(shape("1..5")).toEqual([["int_lit", "1"], ["punct", ".."], ["int_lit", "5"]])
})

test("a duration is components of number and unit; a fraction may not stand on the smallest unit (N19, N20)", () => {
  for (const t of ["T#1_000ms", "T#1.5s", "T#1.5m", "T#1.5s100ms", "LTIME#1.5us", "LTIME#1.5ms", "T#1d2h3m4s5ms", "LTIME#1500US"])
    expect(shape(t)).toEqual([["time_lit", t]])
  // `lit_time_underscore`: a `_` after a unit ends the literal, and what follows is a name
  expect(shape("T#1h_30m")).toEqual([["time_lit", "T#1h"], ["identifier", "_30m"]])
  // `lit_time_fraction_ms`: after a fraction `ms` is no unit, so `m` is taken and the `s` left over refuses the token
  expect(shape("T#1.5ms")).toEqual([["time_lit", "T#1.5m", true], ["identifier", "s"]])
  // `lit_ltime_fraction_ns`: nor is `ns` in an LTIME — the number has no unit
  expect(shape("LTIME#1.5ns")).toEqual([["time_lit", "LTIME#1.5", true], ["identifier", "ns"]])
  // `lit_time_negative`: no sign — the prefix alone is refused
  expect(shape("T#-10ms")).toEqual([["time_lit", "T#", true], ["punct", "-"], ["int_lit", "10"], ["identifier", "ms"]])
  // `cc_time_*`: a TIME has no us or ns, so the number before them has no unit either (gap 7)
  expect(shape("T#1500US")).toEqual([["time_lit", "T#1500", true], ["identifier", "US"]])
  expect(shape("T#1S500US")).toEqual([["time_lit", "T#1S500", true], ["identifier", "US"]])
  expect(shape("TIME#1s500ns")).toEqual([["time_lit", "TIME#1s500", true], ["identifier", "ns"]])
})

test("a WSTRING hex escape is four digits: CODESYS refuses the whole literal, TwinCAT stops at the escape (S6)", () => {
  // `esc_wstring_hex_41`, `_ff`, `_pair`, `hex3` on both vendors (2026-09-21)
  expect(shape('"$41";')).toEqual([["wstring_lit", '"$41"', true], ["punct", ";"]])
  expect(shape('"$C3$A9"')).toEqual([["wstring_lit", '"$C3$A9"', true]])
  expect(shape('"$41"', "twincat")[0]).toEqual(["wstring_lit", '"$41', true])
  expect(shape('"$C3$A9"', "twincat")[0]).toEqual(["wstring_lit", '"$C3', true])
  // four digits, five (four and a `1`), the named escapes, and a STRING's two-digit form are all literals
  for (const t of ['"$0041"', '"$00041"', '"$N$L$R$P$T$$$\'$""', '"a\'b"', "'$41'", "'$C3$A9'", "'a\"b'"])
    expect(shape(t)).toEqual([[t.startsWith("'") ? "string_lit" : "wstring_lit", t]])
})

test("`_` is as free in a typed integer and a duration's number as in a bare integer (N2, N20)", () => {
  // `lit_int_typed_underscore_trailing`, `_leading`, `lit_time_underscore_before_unit` build (CODESYS 2026-10-01) and
  // run as INT#1000, INT#5 and TIME#1ms — the digit rule is the integer's, not one that wants a digit after each `_`
  expect(shape("INT#1000_")).toEqual([["typed_lit", "INT#1000_"]])
  expect(shape("INT#_5")).toEqual([["typed_lit", "INT#_5"]])
  expect(shape("T#1_ms")).toEqual([["time_lit", "T#1_ms"]])
})

test("a duration's components are strictly largest first, each unit once (N20)", () => {
  // `lit_time_components_out_of_order`, `lit_time_component_repeated`: refused whole, "Expression expected instead of
  // 'T#5s1h'" (CODESYS 2026-10-01)
  expect(shape("T#5s1h;")).toEqual([["time_lit", "T#5s1h", true], ["punct", ";"]])
  expect(shape("T#1s1s;")).toEqual([["time_lit", "T#1s1s", true], ["punct", ";"]])
})

test("`<word>#<operand>` on CODESYS: UCHAR#'…' and UTF8#'…' are literals, STRING#/WSTRING# are refused words, any other word takes one operand (S10–S13)", () => {
  // `lit_uchar_*`, `lit_utf8_*`: the prefix in either case, a SINGLE quote — `uchar#'A'` and `utf8#'a'` build too
  for (const t of ["UCHAR#'A'", "uchar#'A'", "UCHAR#'$41$42'", "UCHAR#''", "UTF8#'abc'", "utf8#'a'"]) expect(shape(t)).toEqual([["typed_lit", t]])
  // `lit_string_typed*`: "Unexpected token 'STRING#' found" — the word and its `#` are one token, the string another
  expect(shape("STRING#'abc'")).toEqual([["typed_lit", "STRING#", true], ["string_lit", "'abc'"]])
  expect(shape('WSTRING#"abc"')).toEqual([["typed_lit", "WSTRING#", true], ["wstring_lit", '"abc"']])
  // `lit_char_typed*`, `lit_unknown_prefix_quoted`, `lit_uchar_double_quote`, `lit_utf8_double_quote`, `lit_enum_typed_*`:
  // "'<operand>' is no component of '<word>'" — one token, whatever the word, the quote or the operand
  for (const t of ["CHAR#'A'", "char#'A'", 'WCHAR#"A"', "CHAR#65", "XYZ#'abc'", 'UCHAR#"A"', 'UTF8#"a"', "E_Mode#Running"])
    expect(shape(`${t};`)).toEqual([["typed_lit", t], ["punct", ";"]])
})

test("`<word>#` on TwinCAT is one token unless the word is a literal prefix TwinCAT has (S10–S13, N25)", () => {
  // `lit_*` on TwinCAT 2026-10-01: "Unexpected Token 'CHAR#' found", then the operand on its own
  expect(shape("CHAR#'A'", "twincat")).toEqual([["typed_lit", "CHAR#", true], ["string_lit", "'A'"]])
  expect(shape("CHAR#65", "twincat")).toEqual([["typed_lit", "CHAR#", true], ["int_lit", "65"]])
  expect(shape("STRING#'abc'", "twincat")).toEqual([["typed_lit", "STRING#", true], ["string_lit", "'abc'"]])
  expect(shape("UTF8#'a'", "twincat")).toEqual([["typed_lit", "UTF8#", true], ["string_lit", "'a'"]])
  expect(shape("E_Mode#Running", "twincat")).toEqual([["typed_lit", "E_Mode#", true], ["identifier", "Running"]])
  for (const t of ["INT#5", "BOOL#1", "REAL#1.5", "T#1s", "LTIME#1s", "D#2024-01-01", "TOD#12:00:00", "DT#2024-01-01-00:00:00"])
    expect(shape(t, "twincat")).toHaveLength(1)
})

test("an address's `*` stands right after its area letter, nowhere else (A1, A2)", () => {
  // `lit_address_incomplete*` build; `lit_address_incomplete_sized` is "Direct address expected after AT instead of %IW"
  for (const t of ["%I*", "%Q*", "%M*"]) expect(shape(t)).toEqual([["address_lit", t]])
  expect(shape("%IW*")).toEqual([["address_lit", "%IW"], ["punct", "*"]])
  expect(shape("%MW0*2")).toEqual([["address_lit", "%MW0"], ["punct", "*"], ["int_lit", "2"]])
})
