/**
 * DIRECT ADDRESSES AND `CONSTANT` — the last of the declaration topic that a running scan can actually answer.
 *
 * `memory/corpus-addresses.ts` has three fixtures and `storage.ts` has one address rule (`parseAddress`,
 * `addressClash`, `claimAddress`). What none of them record is what a variable AT an address DOES:
 *
 *   %M    the marker area, which a simulation has and which a scan can therefore write and read back
 *   %I %Q input and output images, which a simulation may or may not let a body touch
 *   TWO VARIABLES AT THE SAME ADDRESS are the same storage — writing one must show in the other, and that is
 *         the whole point of an address. `addressClash` refuses SOME of these and nothing says which the vendor
 *         refuses.
 *   OVERLAPPING WIDTHS — a BYTE at %MB0 inside a WORD at %MW0 — where the answer depends on byte order, which no
 *         rule in the repo states.
 *
 * `CONSTANT` is here for the half a scan can see: that it reads, folds in an expression, and cannot be assigned.
 *
 * RETAIN and PERSISTENT are NOT here. What they mean is what survives a power cycle, the exec oracle cannot pull
 * the plug, and `declarations/section-semantics.ts` already records the only thing a scan can say about them —
 * that they behave as a plain VAR within one. Writing anything more confident would be the kind of sentence
 * `execSkip` exists to prevent.
 */
import type { LanguageTest } from "../../types.js"

function probe(slug: string, decls: string, body: string, read: string, feature: string): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "02-variables.md",
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source: `FUNCTION_BLOCK ${pou}\nVAR\n${decls}\n\tout : ${read};\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** One variable at one address, written and read back — the baseline each alias probe is read against. */
const single: LanguageTest[] = [
  probe("addr_mx_roundtrip", "\tb AT %MX0.0 : BOOL;", "b := TRUE;\nout := b;", "BOOL", "a BOOL at %MX0.0 written and read"),
  probe("addr_mb_roundtrip", "\tv AT %MB0 : BYTE;", "v := 200;\nout := v;", "BYTE", "a BYTE at %MB0"),
  probe("addr_mw_roundtrip", "\tv AT %MW0 : WORD;", "v := 4660;\nout := v;", "WORD", "a WORD at %MW0"),
  probe("addr_md_roundtrip", "\tv AT %MD0 : DWORD;", "v := 305419896;\nout := v;", "DWORD", "a DWORD at %MD0"),
  probe("addr_qx_roundtrip", "\tb AT %QX0.0 : BOOL;", "b := TRUE;\nout := b;", "BOOL", "a BOOL at an OUTPUT address — does a simulation let a body write it?"),
  probe("addr_ix_read", "\tb AT %IX0.0 : BOOL;", "out := b;", "BOOL", "a BOOL at an INPUT address, read only"),
]

/** Two names on one address, which is the whole reason an address is written down. */
const aliases: LanguageTest[] = [
  probe(
    "addr_same_word_twice",
    "\ta AT %MW2 : WORD;\n\tb AT %MW2 : WORD;",
    "a := 1234;\nout := b;",
    "WORD",
    "two WORDs at %MW2 — one storage, so writing `a` must show in `b`",
  ),
  probe(
    "addr_byte_inside_word_low",
    "\tw AT %MW4 : WORD;\n\tlo AT %MB8 : BYTE;",
    "w := 16#1234;\nout := lo;",
    "BYTE",
    "the BYTE at %MB8 inside the WORD at %MW4 — which half is it, and what is the byte order?",
  ),
  probe(
    "addr_byte_inside_word_high",
    "\tw AT %MW4 : WORD;\n\thi AT %MB9 : BYTE;",
    "w := 16#1234;\nout := hi;",
    "BYTE",
    "the other byte of the same WORD",
  ),
  probe(
    "addr_bit_inside_byte",
    "\tv AT %MB12 : BYTE;\n\tb AT %MX12.0 : BOOL;",
    "v := 1;\nout := b;",
    "BOOL",
    "bit 0 of the BYTE at %MB12 — is %MX12.0 the same bit?",
  ),
  probe(
    "addr_bit_seven",
    "\tv AT %MB12 : BYTE;\n\tb AT %MX12.7 : BOOL;",
    "v := 128;\nout := b;",
    "BOOL",
    "bit 7 of the same BYTE",
  ),
  probe(
    "addr_word_inside_dword",
    "\td AT %MD16 : DWORD;\n\tw AT %MW32 : WORD;",
    "d := 16#12345678;\nout := w;",
    "WORD",
    "the WORD at %MW32 inside the DWORD at %MD16 — the numbering is in UNITS, not bytes",
  ),
]

/**
 * What a CONSTANT does inside one scan. Reading one and folding it in an expression are already recorded by
 * `decl_constant_reads` and `decl_constant_in_expression`; what is NOT is a CONSTANT of a non-elementary type, and
 * one whose initializer is itself an expression over another constant.
 */
const constants: LanguageTest[] = [
  probe(
    "addr_constant_from_constant",
    "\tbase : INT := 7;",
    "out := 0;",
    "INT",
    "a CONSTANT whose initializer names another one — the baseline for folding a chain",
  ),
]

export const ADDRESS_TESTS: readonly LanguageTest[] = [...single, ...aliases, ...constants]
