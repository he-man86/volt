/**
 * WHAT EACH VAR SECTION DOES — which ones keep a value between calls, which take an initializer, and what each
 * holds on the scan after the first.
 *
 * `variable-section.ts` has twelve fixtures about how sections PARSE. Almost nothing records what they MEAN at run
 * time, and the difference only shows on the second scan: a `VAR` keeps its value, a `VAR_TEMP` is supposed to start
 * fresh, a `VAR_STAT` is shared by every instance. One scan cannot tell any of them apart.
 *
 * So every probe here runs THREE scans and increments, which makes the three behaviours three different numbers:
 *
 *   keeps its value   3      incremented once per scan
 *   starts fresh      1      reinitialized each call
 *   shared            3      or more, if another instance also ran
 *
 * Asked of every section that can hold an ordinary variable, each with and without an initializer — because "does
 * this section accept an initializer at all" is itself unrecorded for half of them, and a section that silently
 * ignores one is worse than a section that refuses it.
 *
 * RETAIN and PERSISTENT are here for what they do to a plain scan, not for what they do across a power cycle — the
 * exec oracle cannot pull the plug, and pretending otherwise would be the kind of confident sentence `execSkip`
 * exists to prevent.
 */
import type { LanguageTest } from "../../types.js"

/** Three scans, so a value that persists and a value that resets are different numbers. */
function probe(slug: string, section: string, decl: string, body: string, feature: string): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "02-variables.md",
    cycles: 3,
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source: `FUNCTION_BLOCK ${pou}\n${section}\n\t${decl}\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** The sections that can hold a plain counter, with and without an initial value. */
const SECTIONS: readonly [string, string][] = [
  ["VAR", "plain"],
  ["VAR_TEMP", "temp"],
  ["VAR_STAT", "stat"],
  ["VAR_INPUT", "input"],
  ["VAR_OUTPUT", "output"],
  ["VAR RETAIN", "retain"],
  ["VAR PERSISTENT", "persistent"],
  ["VAR RETAIN PERSISTENT", "retain_persistent"],
]

const counters: LanguageTest[] = SECTIONS.flatMap(([section, slug]) => [
  probe(
    `decl_${slug}_counts`,
    section,
    "n : INT;",
    "n := n + 1;\nout := n;",
    `a counter in ${section} after three scans — does it keep its value?`,
  ),
  probe(
    `decl_${slug}_initialized`,
    section,
    "n : INT := 10;",
    "n := n + 1;\nout := n;",
    `a counter in ${section} declared at 10 — is the initializer honoured, and applied once or every call?`,
  ),
])

/** A CONSTANT is its own question: readable, and refused as a target. */
const constants: LanguageTest[] = [
  probe("decl_constant_reads", "VAR CONSTANT", "k : INT := 7;", "out := k;", "a VAR CONSTANT read back"),
  probe(
    "decl_constant_in_expression",
    "VAR CONSTANT",
    "k : INT := 7;",
    "out := k * 2;",
    "a VAR CONSTANT used in an expression",
  ),
]

/** Each type CATEGORY in a VAR_TEMP, where "starts fresh" has to mean something for a composite too. */
const composites: LanguageTest[] = [
  probe(
    "decl_temp_string_counts",
    "VAR_TEMP",
    "t : STRING := 'ab';",
    "t := CONCAT(t, 'c');\nout := LEN(t);",
    "a STRING in VAR_TEMP, appended to each scan — fresh, or growing?",
  ),
  probe(
    "decl_var_string_counts",
    "VAR",
    "t : STRING := 'ab';",
    "t := CONCAT(t, 'c');\nout := LEN(t);",
    "the same STRING in VAR — the control",
  ),
  probe(
    "decl_temp_array_counts",
    "VAR_TEMP",
    "a : ARRAY[0..2] OF INT;",
    "a[0] := a[0] + 1;\nout := a[0];",
    "an ARRAY element in VAR_TEMP",
  ),
  probe(
    "decl_var_array_counts",
    "VAR",
    "a : ARRAY[0..2] OF INT;",
    "a[0] := a[0] + 1;\nout := a[0];",
    "the same ARRAY element in VAR — the control",
  ),
]

export const SECTION_SEMANTICS_TESTS: readonly LanguageTest[] = [...counters, ...constants, ...composites]
