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

/**
 * transpile-review-2026-09-29 — root causes the review confirmed, each asked of CODESYS here before it is fixed. The
 * expected values are the recorder's; the LIVE numbers in the notes are what the review measured by hand, and are
 * leads, not the oracle.
 */
const transpileReview: LanguageTest[] = [
  // Task 24: a VAR_TEMP whose initializer is not constant is deferred to a run-once init and then reset to the type
  // default on every call, so it reads 0. Two calls per scan, each after the global moved, in an FB and in a PROGRAM
  // (the two ways a VAR_TEMP owner is entered); `u` is a computed initializer, not just a bare global read.
  {
    name: "var_temp_dynamic_init",
    deferred: { transpile: "transpile-review-2026-09-29 task 24: a VAR_TEMP with a non-constant initializer is re-initialized on every call in CODESYS (seen 9 then 10, expr 21); the lowering resets it to 0 (recorded 2026-09-29)" },
    pouName: "GVL_LANG_tr24",
    kind: "gvl",
    feature:
      "a VAR_TEMP initialized from a GLOBAL that changes between calls — re-evaluated on every call, in an FB and a PROGRAM (transpile-review task 24)",
    fromDoc: "02-variables.md",
    note: "LIVE (review): the initializer is evaluated on every call — first call sees 7, the next 8, in both the FB and the PROGRAM.",
    cycles: 2,
    source: `VAR_GLOBAL
	gLangTr24Fb : INT := 7;
	gLangTr24Prg : INT := 7;
END_VAR

FUNCTION_BLOCK FB_LANG_tr24
VAR_TEMP
	t : INT := gLangTr24Fb;
	u : INT := gLangTr24Fb * 2 + 1;
END_VAR
VAR
	seen : INT;
	seenExpr : INT;
END_VAR
seen := t;
seenExpr := u;
gLangTr24Fb := gLangTr24Fb + 1;
END_FUNCTION_BLOCK

PROGRAM PRG_LANG_tr24
VAR_TEMP
	t : INT := gLangTr24Prg;
	u : INT := gLangTr24Prg * 2 + 1;
END_VAR
VAR
	seen : INT;
	seenExpr : INT;
END_VAR
seen := t;
seenExpr := u;
gLangTr24Prg := gLangTr24Prg + 1;
END_PROGRAM
`,
    plcPrgVar:
      "inst : FB_LANG_tr24; fbSeen1 : INT; fbSeen2 : INT; fbExpr2 : INT; prgSeen1 : INT; prgSeen2 : INT; prgExpr2 : INT;",
    plcPrgBody: [
      "inst(); fbSeen1 := inst.seen;",
      "inst(); fbSeen2 := inst.seen; fbExpr2 := inst.seenExpr;",
      "PRG_LANG_tr24(); prgSeen1 := PRG_LANG_tr24.seen;",
      "PRG_LANG_tr24(); prgSeen2 := PRG_LANG_tr24.seen; prgExpr2 := PRG_LANG_tr24.seenExpr;",
    ].join("\n"),
  },
  // Task 25: an array element takes its ELEMENT type's default — an enum's first member, an alias's own initializer,
  // an alias-of-array's initializer per element — not the family zero. Edges: an enum whose first member is not the
  // smallest value, a non-zero lower bound, and a PARTIAL initializer whose tail stays at 0 (the half that is right
  // today and must stay right).
  {
    name: "array_element_type_default",
    deferred: { transpile: "transpile-review-2026-09-29 task 25: array elements take their element type's default in CODESYS (enum first member, alias initializer, alias array); the lowering zeroes them (recorded 2026-09-29)" },
    pouName: "FB_LANG_tr25",
    kind: "function_block",
    feature:
      "arrays of an enum, of an alias with an initializer and of an initialized alias-of-array — each element starts at its type's default (transpile-review task 25)",
    fromDoc: "06-data-types.md",
    note: "LIVE (review): r_ea0=r_ea1=3, r_eb1=1, r_ma0=r_ma1=5, r_aa1_0=8, r_aa1_1=9, r_sz1=5, r_alias_part2=0.",
    source: `TYPE DUT_LANG_tr25_E :
(
	A := 3,
	B := 4
);
END_TYPE

TYPE DUT_LANG_tr25_F :
(
	X := 1,
	Y := 0
);
END_TYPE

TYPE DUT_LANG_tr25_MyInt : INT := 5;
END_TYPE

TYPE DUT_LANG_tr25_MyArr : ARRAY[0..1] OF INT := [8, 9];
END_TYPE

FUNCTION_BLOCK FB_LANG_tr25
VAR
	ea : ARRAY[0..1] OF DUT_LANG_tr25_E;
	eb : ARRAY[0..1] OF DUT_LANG_tr25_F;
	ma : ARRAY[0..1] OF DUT_LANG_tr25_MyInt;
	aa : ARRAY[0..1] OF DUT_LANG_tr25_MyArr;
	sz : ARRAY[1..2] OF DUT_LANG_tr25_MyInt;
	part : ARRAY[0..2] OF DUT_LANG_tr25_MyInt := [7];
	r_ea0 : INT;
	r_ea1 : INT;
	r_eb1 : INT;
	r_ma0 : INT;
	r_ma1 : INT;
	r_aa1_0 : INT;
	r_aa1_1 : INT;
	r_sz1 : INT;
	r_alias_part0 : INT;
	r_alias_part2 : INT;
END_VAR
r_ea0 := ea[0];
r_ea1 := ea[1];
r_eb1 := eb[1];
r_ma0 := ma[0];
r_ma1 := ma[1];
r_aa1_0 := aa[1][0];
r_aa1_1 := aa[1][1];
r_sz1 := sz[1];
r_alias_part0 := part[0];
r_alias_part2 := part[2];
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_tr25;",
    plcPrgBody: "inst();",
  },
  // Task 30: a composite VAR_TEMP is reset on every call, but the Rust reset writes the type's zero instead of the
  // declared initializer. Each call reads, then overwrites the element it read — so the SECOND call of a scan only
  // reads the initializer again if the reset honours it.
  {
    ...probe(
      "decl_temp_array_init_resets",
      "VAR_TEMP",
      "arr : ARRAY[0..2] OF INT := [5, 6, 7];",
      "out := arr[1];\narr[1] := 0;",
      "an initialized ARRAY in VAR_TEMP, read then zeroed, called twice a scan — reset to its initializer each call (transpile-review task 30)",
    ),
    plcPrgVar: "inst : FB_LANG_decl_temp_array_init_resets; first : INT; second : INT;",
    plcPrgBody: "inst(); first := inst.out;\ninst(); second := inst.out;",
  },
  {
    name: "decl_temp_struct_init_resets",
    pouName: "FB_LANG_decl_temp_struct_init_resets",
    kind: "function_block",
    feature:
      "an initialized STRUCT in VAR_TEMP, read then zeroed, called twice a scan — reset to its initializer each call (transpile-review task 30)",
    fromDoc: "02-variables.md",
    cycles: 3,
    source: `TYPE DUT_LANG_tr30_P :
STRUCT
	a : INT;
	b : INT := 4;
END_STRUCT
END_TYPE

FUNCTION_BLOCK FB_LANG_decl_temp_struct_init_resets
VAR_TEMP
	tmp : DUT_LANG_tr30_P := (a := 9);
END_VAR
VAR
	out : INT;
	outB : INT;
END_VAR
out := tmp.a;
outB := tmp.b;
tmp.a := 0;
tmp.b := 0;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_decl_temp_struct_init_resets; first : INT; second : INT; secondB : INT;",
    plcPrgBody: "inst(); first := inst.out;\ninst(); second := inst.out; secondB := inst.outB;",
  },
]

export const SECTION_SEMANTICS_TESTS: readonly LanguageTest[] = [
  ...counters,
  ...constants,
  ...composites,
  ...transpileReview,
]
