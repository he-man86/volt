/**
 * THE STRING BUFFER'S CASES (model 2, design.md P3 and §3.2; `cases.ts`). Each case is a STRING(m) / WSTRING(m) variable,
 * started as a declaration starts it — all zeros — and taken through the operations its fixture runs on it: a store of
 * a source buffer (`storeString`, the source's capacity `n`) and the `s[i] := c` character stores (`setChar`). Its answer
 * is the whole buffer, the units behind the terminator included. `string.test.ts` runs the table against
 * `semantics/string.ts`; the twin harness (`test/conformance/runtime-twins.test.ts`) runs it through rustc against
 * `IecStr::store` / `with_char`, and holds every case's `seen` to its recording — each unit a fixture dumped through `s[i]`,
 * each string and length it recorded — so the table cannot drift from the oracle.
 */

/** One operation on the buffer: a store of a source of capacity `n` holding `src`, or a character store `s[at] := unit`. */
export type StringOp = { readonly store: string; readonly n: number } | { readonly at: number; readonly unit: number }

/** A variable of capacity `m` (a WSTRING when `wide`), started at zeros and taken through `ops`. */
export interface StringInput {
  readonly m: number
  readonly wide?: true
  readonly ops: readonly StringOp[]
}

/** What a recording shows of the final buffer: one unit (dumped through `s[i]`), the string, or its length. */
export type Seen =
  | { readonly path: string; readonly unit: number }
  | { readonly path: string; readonly text: true }
  | { readonly path: string; readonly length: true }

/** One case: the buffer it ends as (held, trailing zeros trimmed), and what of it the fixture recorded. */
export interface StringCase {
  readonly name: string
  readonly input: StringInput
  readonly expected: string
  readonly fixture: string
  readonly seen: readonly Seen[]
}

const Z = (count: number): string => "Z".repeat(count)
const store = (src: string, n: number): StringOp => ({ store: src, n })
const set = (at: number, unit: number): StringOp => ({ at, unit })
/** Units [from..to] dumped into `<array>[i]`. */
const units = (array: string, from: number, to: number): Seen[] =>
  Array.from({ length: to - from + 1 }, (_, k) => ({ path: `inst.${array}[${from + k}]`, unit: from + k }))
/** Units [0..20] dumped into `<p>Lo[0..15]` and `<p>Hi[16..20]` (string-edges.ts `dumpArrays`). */
const dump20 = (p: string): Seen[] => [...units(`${p}Lo`, 0, 15), ...units(`${p}Hi`, 16, 20)]
const text = (path: string): Seen => ({ path: `inst.${path}`, text: true })
const length = (path: string): Seen => ({ path: `inst.${path}`, length: true })

/** 'abcdefghij' with a 0 stored at [3]: 'abc', and 'efghij' behind its terminator. */
const TAIL10 = "abc\0efghij"
const TWENTY = "abcdefghijklmnopqrst"

/** The cases, keyed by the rule they show. */
export const STRING_CASES: Readonly<Record<string, readonly StringCase[]>> = {
  "a store writes min(n, m) units of the source's buffer and a 0, and keeps the destination behind (M2)": [
    { name: "STRING(10) := STRING(20) 'abc'+0+'efgh…t' over 'Z'", fixture: "string_assign_tail_narrow",
      input: { m: 10, ops: [store(Z(10), 10), store(`abc\0${TWENTY.slice(4)}`, 20)] }, expected: TAIL10,
      seen: [...units("dstBytes", 0, 10), text("dst"), length("lenDst")] },
    { name: "STRING(10) := STRING(20) 'abc…t', cut at the capacity", fixture: "string_assign_tail_narrow",
      input: { m: 10, ops: [store(Z(10), 10), store(TWENTY, 20)] }, expected: TWENTY.slice(0, 10),
      seen: [...units("dstFullBytes", 0, 10), text("dstFull"), length("lenDstFull")] },
    { name: "STRING(20) := STRING(10) 'abc'+0+'efghij' over 'Z' keeps 'Z' at [11..19]", fixture: "string_assign_tail_wide",
      input: { m: 20, ops: [store(Z(20), 20), store(TAIL10, 10)] }, expected: `${TAIL10}\0${Z(9)}`,
      seen: [...units("lo", 0, 15), ...units("hi", 16, 20), text("dst"), length("lenDst")] },
    { name: "WSTRING(10) := WSTRING(20) 'abc'+0+'efgh…t' over 'Z'", fixture: "wstring_assign_tail_narrow",
      input: { m: 10, wide: true, ops: [store(Z(10), 10), store(`abc\0${TWENTY.slice(4)}`, 20)] }, expected: TAIL10,
      seen: [...units("dstUnits", 0, 10), text("dst")] },
    { name: "WSTRING(10) := WSTRING(20) 'abc…t', cut at the capacity", fixture: "wstring_assign_tail_narrow",
      input: { m: 10, wide: true, ops: [store(Z(10), 10), store(TWENTY, 20)] }, expected: TWENTY.slice(0, 10),
      seen: [...units("dstFullUnits", 0, 10), text("dstFull")] },
    { name: "WSTRING(20) := WSTRING(10) 'abc'+0+'efghij' over 'Z' keeps 'Z' at [11..19]", fixture: "wstring_assign_tail_wide",
      input: { m: 20, wide: true, ops: [store(Z(20), 20), store(TAIL10, 10)] }, expected: `${TAIL10}\0${Z(9)}`,
      seen: [...units("lo", 0, 15), ...units("hi", 16, 20), text("dst")] },
  ],
  "every source and destination kind measured follows the same store (gate 3a)": [
    { name: "a user FUNCTION's STRING(10) result into a 'Z'-filled STRING(20)", fixture: "string_store_function_result_tail",
      input: { m: 20, ops: [store(Z(20), 20), store(TAIL10, 10)] }, expected: `${TAIL10}\0${Z(9)}`,
      seen: [...dump20("user"), text("dUser")] },
    ...(["arr", "rec", "inOut", "input"] as const).map((p) => ({
      name: `a STRING(10) into a 'Z'-filled STRING(20) ${{ arr: "ARRAY element", rec: "STRUCT member", inOut: "VAR_IN_OUT", input: "FB VAR_INPUT" }[p]}`,
      fixture: "string_store_destination_kinds_tail",
      input: { m: 20, ops: [store(Z(20), 20), store(TAIL10, 10)] },
      expected: `${TAIL10}\0${Z(9)}`,
      seen: dump20(p),
    })),
  ],
  "a literal is a source of its own unit count, the units behind its $00 among them (M1, M3)": [
    { name: "STRING(3) := 'ab$00c' (declared) cuts the 'c' at the terminator", fixture: "string_literal_nul_tail",
      input: { m: 3, ops: [store("ab\0c", 4)] }, expected: "ab", seen: [...units("threeBytes", 0, 3), text("three")] },
    { name: "STRING(10) := 'ab$00cd' (declared) holds 'cd' behind the 0", fixture: "string_literal_nul_tail",
      input: { m: 10, ops: [store("ab\0cd", 5)] }, expected: "ab\0cd", seen: [...units("litBytes", 0, 10), text("lit"), length("lenLit")] },
    { name: "a sizeless STRING := 'ab$00cd' (declared)", fixture: "string_literal_nul_tail",
      input: { m: 80, ops: [store("ab\0cd", 5)] }, expected: "ab\0cd", seen: [...units("bareBytes", 0, 10), text("bare")] },
    { name: "'ab$00cd' stored over 'ZZZZZZZZZZ' writes six units and keeps 'ZZZZ'", fixture: "string_literal_nul_tail",
      input: { m: 10, ops: [store(Z(10), 10), store("ab\0cd", 5)] }, expected: `ab\0cd\0${Z(4)}`,
      seen: [...units("assignedBytes", 0, 10), text("assigned"), length("lenAssigned")] },
    { name: "a STRING(10) holding 'ab'+0+'cd' copied over 'Z' carries 'cd'", fixture: "string_literal_nul_tail",
      input: { m: 10, ops: [store(Z(10), 10), store("ab\0cd", 10)] }, expected: "ab\0cd",
      seen: [...units("copyBytes", 0, 10), text("copy"), length("lenCopy")] },
    { name: "a STRING(3) holding 'ab' copied into a 'Z'-filled STRING(10) writes four units", fixture: "string_literal_nul_tail",
      input: { m: 10, ops: [store(Z(10), 10), store("ab", 3)] }, expected: `ab\0\0${Z(6)}`,
      seen: [...units("wideCopyBytes", 0, 10), text("wideCopy")] },
    { name: 'WSTRING(3) := "ab$0000c" (declared)', fixture: "wstring_literal_nul_tail",
      input: { m: 3, wide: true, ops: [store("ab\0c", 4)] }, expected: "ab", seen: [...units("threeUnits", 0, 3), text("three")] },
    { name: 'WSTRING(10) := "ab$0000cd" (declared)', fixture: "wstring_literal_nul_tail",
      input: { m: 10, wide: true, ops: [store("ab\0cd", 5)] }, expected: "ab\0cd", seen: [...units("litUnits", 0, 10), text("lit"), length("lenLit")] },
    { name: 'a sizeless WSTRING := "ab$0000cd" (declared)', fixture: "wstring_literal_nul_tail",
      input: { m: 80, wide: true, ops: [store("ab\0cd", 5)] }, expected: "ab\0cd", seen: [...units("bareUnits", 0, 10), text("bare")] },
    { name: '"ab$0000cd" stored over "ZZZZZZZZZZ" keeps "ZZZZ"', fixture: "wstring_literal_nul_tail",
      input: { m: 10, wide: true, ops: [store(Z(10), 10), store("ab\0cd", 5)] }, expected: `ab\0cd\0${Z(4)}`,
      seen: [...units("assignedUnits", 0, 10), text("assigned"), length("lenAssigned")] },
    { name: "a WSTRING(10) holding 'ab'+0+'cd' copied over 'Z'", fixture: "wstring_literal_nul_tail",
      input: { m: 10, wide: true, ops: [store(Z(10), 10), store("ab\0cd", 10)] }, expected: "ab\0cd",
      seen: [...units("copyUnits", 0, 10), text("copy"), length("lenCopy")] },
    { name: "a WSTRING(3) holding 'ab' copied into a 'Z'-filled WSTRING(10)", fixture: "wstring_literal_nul_tail",
      input: { m: 10, wide: true, ops: [store(Z(10), 10), store("ab", 3)] }, expected: `ab\0\0${Z(6)}`,
      seen: [...units("wideCopyUnits", 0, 10), text("wideCopy")] },
    { name: "STRING(3) := 'ab$00c', then copied into STRING(10) and back into STRING(3) (tr_45)", fixture: "tr_45_string_embedded_nul",
      input: { m: 3, ops: [store("ab\0c", 4)] }, expected: "ab",
      seen: [text("txt"), length("lenS"), { path: "inst.c2", unit: 2 }, { path: "inst.c3", unit: 3 }] },
    { name: "u : STRING(10) := txt (STRING(3) 'ab') (tr_45)", fixture: "tr_45_string_embedded_nul",
      input: { m: 10, ops: [store("ab", 3)] }, expected: "ab", seen: [text("u"), length("lenU"), { path: "inst.uc3", unit: 3 }] },
    { name: "small : STRING(3) := u (STRING(10) 'ab') (tr_45)", fixture: "tr_45_string_embedded_nul",
      input: { m: 3, ops: [store("ab", 10)] }, expected: "ab", seen: [text("small"), length("lenS3")] },
    { name: 'w : WSTRING := "ab$0000c" (tr_45)', fixture: "tr_45_string_embedded_nul",
      input: { m: 80, wide: true, ops: [store("ab\0c", 4)] }, expected: "ab\0c", seen: [text("w"), length("lenW")] },
  ],
  "s[i] reaches every unit of the variable: a 0 cuts the string and keeps its tail (RC 34)": [
    { name: "a right-to-left digit fill gives '4321' (tr_34)", fixture: "tr_34_lib_prim_char_behind",
      input: { m: 10, ops: [store("", 0), set(4, 0), set(3, 49), set(2, 50), set(1, 51), set(0, 52)] }, expected: "4321",
      seen: [text("digits"), length("lenDigits")] },
    { name: "'abcdef' with t[2] := 0; t[2] := 88 gives 'abXdef' (tr_34)", fixture: "tr_34_lib_prim_char_behind",
      input: { m: 10, ops: [store("abcdef", 6), store("abcdef", 6), set(2, 0), set(2, 88)] }, expected: "abXdef",
      seen: [text("t"), length("lenT")] },
    { name: "bytes stored past 'abc' at [4] then [3] give 'abcBC' (tr_34)", fixture: "tr_34_lib_prim_char_behind",
      input: { m: 10, ops: [store("abc", 3), store("abc", 3), set(4, 67), set(3, 66)] }, expected: "abcBC",
      seen: [text("u"), length("lenU")] },
    { name: "copied := u carries 'abcBC' (tr_34)", fixture: "tr_34_lib_prim_char_behind",
      input: { m: 10, ops: [store("abcBC", 10)] }, expected: "abcBC", seen: [text("copied"), length("lenCopied")] },
    { name: "past the length and at the capacity: buf[10] := 0, buf[6] := 88 leave 'ab' (lib_prim_char_past_length)",
      fixture: "lib_prim_char_past_length",
      input: { m: 10, ops: [store("ab", 2), set(10, 0), set(6, 88)] }, expected: "ab\0\0\0\0X",
      seen: [text("buf"), length("lenAfterStore"), { path: "inst.readPast", unit: 4 }, { path: "inst.atCapacity", unit: 10 }] },
  ],
}
