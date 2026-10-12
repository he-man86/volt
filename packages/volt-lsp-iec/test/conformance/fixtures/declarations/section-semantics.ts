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
import { probe } from "./section-semantics-shared.js"
import { transpileReview_A } from "./section-semantics-a.js"
import { initModel_B } from "./section-semantics-b.js"
import { tempScope_C } from "./section-semantics-c.js"
import { tempReview_D } from "./section-semantics-d.js"

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

/**
 * transpile-review-2026-09-29 — root causes the review confirmed, each asked of CODESYS here before it is fixed. The
 * expected values are the recorder's; the LIVE numbers in the notes are what the review measured by hand, and are
 * leads, not the oracle.
 */
const transpileReview: LanguageTest[] = [...transpileReview_A]

/**
 * openspec transpile-restructure task 5.1 (design.md §3.4, Measure items 6 and 7): RC 24's re-evaluated initializer asked
 * in the two routine kinds `var_temp_dynamic_init` did not cover — a METHOD and a FUNCTION, through their VAR, their
 * temporary section (CODESYS refuses VAR_TEMP in both: `type_var_temp_in_method`, and `type_var_temp_in_function`, "VAR_TEMP
 * declaration not allowed in this place" on both vendors, 2026-10-09) — and in a VAR_TEMP ARRAY
 * and STRUCT whose initializer is dynamic (an input, a FUNCTION call, a global that moves), which decides §3.4's reset form.
 */
const initModel: LanguageTest[] = [...initModel_B]

/**
 * openspec transpile-restructure task 7.6.4 (design.md §3.4, step 7.6b): WHO MAY NAME A VAR_TEMP besides the body that
 * declares it. The transpiler makes a VAR_TEMP a local of the run of its body, so a name reaching it from anywhere else —
 * the FB's METHOD or ACTION, a derived FB's body, `THIS^.` in its own body — has no storage to reach. Each asks the vendor
 * whether that name compiles at all; the body stores 5 into the temp before the other code reads it.
 */
const tempScope: LanguageTest[] = [...tempScope_C]

/**
 * GATE 7.6b's review of 7.6.4 (2026-10-10): what a VAR_TEMP made a local changed and no recording said. A base FB's
 * VAR_TEMP was an inherited FIELD before, so a derived FB declaring the same name was `var-duplicate`; a base's VAR_TEMP
 * run by `SUPER^()` had its dynamic initializer queued on the wrong frame; the address of a VAR_TEMP kept in a field was
 * read in the same run; and a VAR_TEMP's name read where the temp is not visible meets a global of that name. Each asks
 * the vendor; two scans, so a value kept across runs and one started over are different numbers.
 */
const tempReview: LanguageTest[] = [...tempReview_D]

export const SECTION_SEMANTICS_TESTS: readonly LanguageTest[] = [
  ...counters,
  ...constants,
  ...composites,
  ...transpileReview,
  ...initModel,
  ...tempScope,
  ...tempReview,
]
