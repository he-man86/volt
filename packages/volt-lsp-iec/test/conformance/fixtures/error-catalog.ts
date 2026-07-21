/**
 * CODESYS error-catalog conformance fixtures — one per implemented/in-progress `Cnnnn` code.
 *
 * These plug the error-code catalog (`docs/codesys-reference/error-catalog.json`, `src/reference/error-codes.ts`)
 * into the LIVE-IDE conformance gate: the recorder pushes each to CODESYS + TwinCAT and
 * `replay.test.ts` requires the LSP's message set to equal the recorded compiler set, byte-for-byte, per vendor.
 * That is how each `Cnnnn` wording is locked (and any docs-vs-live drift settled).
 *
 * Each fixture is authored well-formed and harness-shaped (a `FB_LANG_`-prefixed POU + a PLC_PRG instantiation
 * so TwinCAT actually analyses it) — NOT the harvested draft repro, which is only a hint. Add one row here as a
 * code moves from `checkable` → `implemented` in the catalog. Until a recording exists the replay skips it.
 */
import type { LanguageTest } from "../types.js"

export const ERROR_CATALOG_TESTS: readonly LanguageTest[] = [
  // C0001 — a literal whose constant value exceeds its target type's range.
  {
    name: "err_c0001_const_too_large",
    pouName: "FB_LANG_c0001_const_too_large",
    kind: "function_block",
    feature: "C0001 constant too large for type",
    fromDoc: "13-error-messages.md#C0001",
    plcPrgVar: "fb_c0001 : FB_LANG_c0001_const_too_large;",
    plcPrgBody: "fb_c0001();",
    source: `FUNCTION_BLOCK FB_LANG_c0001_const_too_large
VAR
	x : INT;
END_VAR
x := INT#123456;
END_FUNCTION_BLOCK`,
    note: "A typed literal past its OWN prefix type is a provable C0001 → Constant 'INT#123456' too large for type 'INT'. (999 fits INT, so CODESYS would report it as C0032, not C0001.)",
  },

  // C0003 — a bit index past the width of the accessed variable's type.
  {
    name: "err_c0003_bad_bit_index",
    pouName: "FB_LANG_c0003_bad_bit_index",
    kind: "function_block",
    feature: "C0003 invalid bit number",
    fromDoc: "13-error-messages.md#C0003",
    plcPrgVar: "fb_c0003 : FB_LANG_c0003_bad_bit_index;",
    plcPrgBody: "fb_c0003();",
    source: `FUNCTION_BLOCK FB_LANG_c0003_bad_bit_index
VAR
	w : WORD;
	b : BOOL;
END_VAR
b := w.17;
END_FUNCTION_BLOCK`,
    note: "WORD is 16-bit; bit .17 is out of range.",
  },

  // C0116 — the same jump label declared twice in one POU.
  {
    name: "err_c0116_duplicate_label",
    pouName: "FB_LANG_c0116_duplicate_label",
    kind: "function_block",
    feature: "C0116 duplicate jump label",
    fromDoc: "13-error-messages.md#C0116",
    plcPrgVar: "fb_c0116 : FB_LANG_c0116_duplicate_label;",
    plcPrgBody: "fb_c0116();",
    source: `FUNCTION_BLOCK FB_LANG_c0116_duplicate_label
VAR
	i : INT;
END_VAR
lbl: i := 1;
lbl: i := 2;
END_FUNCTION_BLOCK`,
    note: "The label 'lbl' is declared twice.",
  },
]
