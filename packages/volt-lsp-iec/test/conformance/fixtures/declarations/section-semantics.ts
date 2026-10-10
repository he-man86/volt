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
  // openspec transpile-restructure 5.3 (design.md §3.4 step 5c): the two element defaults `array_element_type_default`
  // does not record — a PARTIAL initializer on an ENUM array (its tail at the enum's default 3, or the family zero), and
  // an alias OF an alias (its element at the inner alias's 5, at its own 6, or 0) — asked before the IrInit's `rest` states them.
  {
    name: "array_element_enum_partial_tail",
    pouName: "FB_LANG_aeept",
    kind: "function_block",
    feature: "a partial initializer on an ARRAY OF an enum whose default is not 0 — the tail at the enum's default or the family zero",
    fromDoc: "06-data-types.md",
    source: `TYPE DUT_LANG_aeept_E :
(
	A := 3,
	B := 4
);
END_TYPE

FUNCTION_BLOCK FB_LANG_aeept
VAR
	ep : ARRAY[0..2] OF DUT_LANG_aeept_E := [DUT_LANG_aeept_E.B];
	r_ep0 : INT;
	r_ep1 : INT;
	r_ep2 : INT;
END_VAR
r_ep0 := ep[0];
r_ep1 := ep[1];
r_ep2 := ep[2];
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_aeept;",
    plcPrgBody: "inst();",
  },
  {
    name: "array_element_alias_of_alias",
    pouName: "FB_LANG_aeaa",
    kind: "function_block",
    feature: "an alias of an initialized alias, with and without its own initializer — as a variable and as an array element",
    fromDoc: "06-data-types.md",
    source: `TYPE DUT_LANG_aeaa_Base : INT := 5;
END_TYPE

TYPE DUT_LANG_aeaa_Plain : DUT_LANG_aeaa_Base;
END_TYPE

TYPE DUT_LANG_aeaa_Own : DUT_LANG_aeaa_Base := 6;
END_TYPE

FUNCTION_BLOCK FB_LANG_aeaa
VAR
	ps : DUT_LANG_aeaa_Plain;
	os : DUT_LANG_aeaa_Own;
	pa : ARRAY[0..1] OF DUT_LANG_aeaa_Plain;
	oa : ARRAY[0..1] OF DUT_LANG_aeaa_Own;
	r_ps : INT;
	r_os : INT;
	r_pa1 : INT;
	r_oa1 : INT;
END_VAR
r_ps := ps;
r_os := os;
r_pa1 := pa[1];
r_oa1 := oa[1];
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_aeaa;",
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

/**
 * openspec transpile-restructure task 5.1 (design.md §3.4, Measure items 6 and 7): RC 24's re-evaluated initializer asked
 * in the two routine kinds `var_temp_dynamic_init` did not cover — a METHOD and a FUNCTION, through their VAR, their
 * temporary section (CODESYS refuses VAR_TEMP in both: `type_var_temp_in_method`, and `type_var_temp_in_function`, "VAR_TEMP
 * declaration not allowed in this place" on both vendors, 2026-10-09) — and in a VAR_TEMP ARRAY
 * and STRUCT whose initializer is dynamic (an input, a FUNCTION call, a global that moves), which decides §3.4's reset form.
 */
const initModel: LanguageTest[] = [
  {
    name: "var_temp_dynamic_init_method",
    pouName: "GVL_LANG_vtdm",
    kind: "gvl",
    feature: "a METHOD's VAR initialized from a GLOBAL that changes between calls — re-evaluated on every call? (RC 24 in a METHOD)",
    fromDoc: "02-variables.md",
    cycles: 2,
    source: `VAR_GLOBAL
	gLangVtdm : INT := 7;
END_VAR

FUNCTION_BLOCK FB_LANG_vtdm
VAR
	seen : INT;
	seenExpr : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Probe
VAR
	t : INT := gLangVtdm;
	u : INT := gLangVtdm * 2 + 1;
END_VAR
seen := t;
seenExpr := u;
t := 0;
u := 0;
gLangVtdm := gLangVtdm + 1;
END_METHOD
`,
    plcPrgVar: "inst : FB_LANG_vtdm; seen1 : INT; expr1 : INT; seen2 : INT; expr2 : INT;",
    plcPrgBody: "inst.Probe(); seen1 := inst.seen; expr1 := inst.seenExpr;\ninst.Probe(); seen2 := inst.seen; expr2 := inst.seenExpr;",
  },
  {
    name: "var_temp_dynamic_init_function",
    pouName: "GVL_LANG_vtdf",
    kind: "gvl",
    feature: "a FUNCTION's VAR initialized from a GLOBAL that changes between calls, and from an input — re-evaluated on every call? (RC 24 in a FUNCTION)",
    fromDoc: "02-variables.md",
    cycles: 2,
    source: `VAR_GLOBAL
	gLangVtdf : INT := 7;
END_VAR

FUNCTION F_LANG_vtdf : INT
VAR_INPUT
	k : INT;
END_VAR
VAR_OUTPUT
	outU : INT;
	outIn : INT;
END_VAR
VAR
	t : INT := gLangVtdf;
	u : INT := gLangVtdf * 2 + 1;
	viaInput : INT := k * 3;
END_VAR
F_LANG_vtdf := t;
outU := u;
outIn := viaInput;
gLangVtdf := gLangVtdf + 1;
END_FUNCTION
`,
    plcPrgVar: "t1 : INT; u1 : INT; in1 : INT; t2 : INT; u2 : INT; in2 : INT;",
    plcPrgBody: "t1 := F_LANG_vtdf(k := 2, outU => u1, outIn => in1);\nt2 := F_LANG_vtdf(k := 5, outU => u2, outIn => in2);",
  },
  {
    name: "var_temp_dynamic_aggregate_init",
    pouName: "GVL_LANG_vtda",
    kind: "gvl",
    feature: "a VAR_TEMP ARRAY and STRUCT whose initializers read an input, call a FUNCTION and read a moving global — re-evaluated on every call?",
    fromDoc: "02-variables.md",
    cycles: 2,
    source: `VAR_GLOBAL
	gLangVtda : INT := 7;
END_VAR

TYPE DUT_LANG_vtda :
STRUCT
	a : INT;
	b : INT := 4;
	c : INT;
END_STRUCT
END_TYPE

FUNCTION F_LANG_vtda_twice : INT
VAR_INPUT
	n : INT;
END_VAR
F_LANG_vtda_twice := n * 2;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_vtda
VAR_INPUT
	k : INT;
END_VAR
VAR_TEMP
	arr : ARRAY[0..2] OF INT := [k, 0 + F_LANG_vtda_twice(k), gLangVtda];
	rec : DUT_LANG_vtda := (a := k, c := F_LANG_vtda_twice(gLangVtda));
END_VAR
VAR
	r0 : INT;
	r1 : INT;
	r2 : INT;
	sa : INT;
	sb : INT;
	sc : INT;
END_VAR
r0 := arr[0];
r1 := arr[1];
r2 := arr[2];
sa := rec.a;
sb := rec.b;
sc := rec.c;
arr[0] := 0;
arr[1] := 0;
arr[2] := 0;
rec.a := 0;
rec.b := 0;
rec.c := 0;
gLangVtda := gLangVtda + 1;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_vtda; first0 : INT; first1 : INT; first2 : INT; firstA : INT; firstB : INT; firstC : INT;",
    plcPrgBody:
      "inst(k := 3); first0 := inst.r0; first1 := inst.r1; first2 := inst.r2; firstA := inst.sa; firstB := inst.sb; firstC := inst.sc;\ninst(k := 5);",
  },
]

/**
 * openspec transpile-restructure task 7.6.4 (design.md §3.4, step 7.6b): WHO MAY NAME A VAR_TEMP besides the body that
 * declares it. The transpiler makes a VAR_TEMP a local of the run of its body, so a name reaching it from anywhere else —
 * the FB's METHOD or ACTION, a derived FB's body, `THIS^.` in its own body — has no storage to reach. Each asks the vendor
 * whether that name compiles at all; the body stores 5 into the temp before the other code reads it.
 */
const tempScope: LanguageTest[] = [
  {
    name: "var_temp_named_in_method",
    pouName: "FB_LANG_vtsm",
    kind: "function_block",
    feature: "an FB's VAR_TEMP named in its METHOD — visible there, or not declared?",
    fromDoc: "02-variables.md",
    source: `FUNCTION_BLOCK FB_LANG_vtsm
VAR_TEMP
	scratch : INT;
END_VAR
VAR
	seen : INT;
END_VAR
scratch := 5;
Probe();
END_FUNCTION_BLOCK

METHOD Probe
seen := scratch + 1;
END_METHOD
`,
    plcPrgVar: "inst : FB_LANG_vtsm; out : INT;",
    plcPrgBody: "inst(); out := inst.seen;",
  },
  {
    name: "var_temp_named_in_action",
    pouName: "FB_LANG_vtsa",
    kind: "function_block",
    feature: "an FB's VAR_TEMP named in its ACTION — visible there, or not declared?",
    fromDoc: "02-variables.md",
    source: `FUNCTION_BLOCK FB_LANG_vtsa
VAR_TEMP
	scratch : INT;
END_VAR
VAR
	seen : INT;
END_VAR
scratch := 5;
Probe();
END_FUNCTION_BLOCK

ACTION Probe
seen := scratch + 1;
END_ACTION
`,
    plcPrgVar: "inst : FB_LANG_vtsa; out : INT;",
    plcPrgBody: "inst(); out := inst.seen;",
    deferred: {
      transpile:
        "2026-10-10 (transpile-restructure 7.6.4): both vendors compile it, and CODESYS runs it to seen = 1 — the ACTION reads 0 where the body stored 5, so it does not reach the body's run's VAR_TEMP; which storage it reads is not modelled, refused `var-temp-outside-body`; niche: accepted loss (0 occurrences in the corpora: no ACTION names its FB's VAR_TEMP)",
    },
  },
  {
    name: "var_temp_named_in_derived_body",
    pouName: "FB_LANG_vtsd",
    kind: "function_block",
    feature: "a base FB's VAR_TEMP named in the derived FB's body — inherited, or not declared?",
    fromDoc: "02-variables.md",
    source: `FUNCTION_BLOCK FB_LANG_vtsd_base
VAR_TEMP
	scratch : INT;
END_VAR
VAR
	seen : INT;
END_VAR
scratch := 1;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_vtsd EXTENDS FB_LANG_vtsd_base
scratch := 5;
seen := scratch + 1;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_vtsd; out : INT;",
    plcPrgBody: "inst(); out := inst.seen;",
  },
  {
    name: "var_temp_named_through_this",
    pouName: "FB_LANG_vtst",
    kind: "function_block",
    feature: "an FB's VAR_TEMP named as THIS^.scratch in its own body — a member of the instance, or not?",
    fromDoc: "02-variables.md",
    source: `FUNCTION_BLOCK FB_LANG_vtst
VAR_TEMP
	scratch : INT;
END_VAR
VAR
	seen : INT;
END_VAR
scratch := 5;
seen := THIS^.scratch + 1;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_vtst; out : INT;",
    plcPrgBody: "inst(); out := inst.seen;",
    deferred: {
      transpile:
        "2026-10-10 (transpile-restructure 7.6.4): both vendors compile it, and CODESYS runs it to seen = 1 — `THIS^.scratch` reads 0 where the body stored 5 into `scratch`, so the path is no name of the run's VAR_TEMP; which storage it reads is not modelled, refused `var-temp-outside-body`; niche: accepted loss (0 occurrences in the corpora: no `THIS^.` names a VAR_TEMP)",
    },
  },
]

/**
 * GATE 7.6b's review of 7.6.4 (2026-10-10): what a VAR_TEMP made a local changed and no recording said. A base FB's
 * VAR_TEMP was an inherited FIELD before, so a derived FB declaring the same name was `var-duplicate`; a base's VAR_TEMP
 * run by `SUPER^()` had its dynamic initializer queued on the wrong frame; the address of a VAR_TEMP kept in a field was
 * read in the same run; and a VAR_TEMP's name read where the temp is not visible meets a global of that name. Each asks
 * the vendor; two scans, so a value kept across runs and one started over are different numbers.
 */
const tempReview: LanguageTest[] = [
  {
    name: "var_temp_base_redeclared_as_var",
    pouName: "FB_LANG_vtrv",
    kind: "function_block",
    feature: "a derived FB declares a VAR named like its base's VAR_TEMP — a duplicate, or two variables?",
    fromDoc: "02-variables.md",
    source: `FUNCTION_BLOCK FB_LANG_vtrv_base
VAR_TEMP
	sv : INT := 3;
END_VAR
VAR
	bs : INT;
END_VAR
sv := sv + 1;
bs := sv;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_vtrv EXTENDS FB_LANG_vtrv_base
VAR
	sv : INT;
END_VAR
sv := sv + 10;
SUPER^();
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_vtrv; outSv : INT; outBs : INT;",
    plcPrgBody: "inst(); outSv := inst.sv; outBs := inst.bs;",
    cycles: 2,
  },
  {
    name: "var_temp_base_redeclared_as_temp",
    pouName: "FB_LANG_vtrt",
    kind: "function_block",
    feature: "a derived FB declares a VAR_TEMP named like its base's VAR_TEMP — a duplicate, or two temps?",
    fromDoc: "02-variables.md",
    source: `FUNCTION_BLOCK FB_LANG_vtrt_base
VAR_TEMP
	sv : INT := 3;
END_VAR
VAR
	bs : INT;
END_VAR
sv := sv + 1;
bs := sv;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_vtrt EXTENDS FB_LANG_vtrt_base
VAR_TEMP
	sv : INT := 100;
END_VAR
VAR
	ds : INT;
END_VAR
sv := sv + 10;
ds := sv;
SUPER^();
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_vtrt; outDs : INT; outBs : INT;",
    plcPrgBody: "inst(); outDs := inst.ds; outBs := inst.bs;",
    cycles: 2,
  },
  {
    name: "var_temp_base_run_by_super_constant_init",
    pouName: "FB_LANG_vtsc",
    kind: "function_block",
    feature: "a base FB's VAR_TEMP with a constant initializer, its body run by SUPER^() — started over each run?",
    fromDoc: "02-variables.md",
    source: `FUNCTION_BLOCK FB_LANG_vtsc_base
VAR_TEMP
	a : INT := 7;
END_VAR
VAR
	g : INT;
	bo : INT;
END_VAR
a := a + g;
bo := a;
g := g + 1;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_vtsc EXTENDS FB_LANG_vtsc_base
SUPER^();
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_vtsc; out : INT;",
    plcPrgBody: "inst(); out := inst.bo;",
    cycles: 2,
  },
  {
    name: "var_temp_base_run_by_super_dynamic_init",
    pouName: "FB_LANG_vtsy",
    kind: "function_block",
    feature: "a base FB's VAR_TEMP initialized from a field, its body run by SUPER^() — evaluated each run?",
    fromDoc: "02-variables.md",
    source: `FUNCTION_BLOCK FB_LANG_vtsy_base
VAR
	g : INT := 3;
	bo : INT;
END_VAR
VAR_TEMP
	a : INT := g * 10;
END_VAR
bo := a;
g := g + 1;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_vtsy EXTENDS FB_LANG_vtsy_base
SUPER^();
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_vtsy; out : INT;",
    plcPrgBody: "inst(); out := inst.bo;",
    cycles: 2,
  },
  {
    name: "var_temp_address_kept_in_pointer_field",
    pouName: "FB_LANG_vtap",
    kind: "function_block",
    feature: "the address of a VAR_TEMP stored into a POINTER field and dereferenced in the same run",
    fromDoc: "02-variables.md",
    source: `FUNCTION_BLOCK FB_LANG_vtap
VAR
	p : POINTER TO INT;
	seen : INT;
END_VAR
VAR_TEMP
	t : INT;
END_VAR
t := 3;
p := ADR(t);
seen := p^;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_vtap; out : INT;",
    plcPrgBody: "inst(); out := inst.seen;",
  },
  {
    name: "var_temp_reference_kept_in_field",
    pouName: "FB_LANG_vtar",
    kind: "function_block",
    feature: "a REFERENCE field bound to a VAR_TEMP and read in the same run",
    fromDoc: "02-variables.md",
    source: `FUNCTION_BLOCK FB_LANG_vtar
VAR
	rf : REFERENCE TO INT;
	seen : INT;
END_VAR
VAR_TEMP
	t : INT;
END_VAR
t := 3;
rf REF= t;
seen := rf;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_vtar; out : INT;",
    plcPrgBody: "inst(); out := inst.seen;",
  },
  {
    name: "var_temp_named_in_method_beside_global",
    pouName: "FB_LANG_vtgm",
    kind: "function_block",
    feature: "an FB's VAR_TEMP named in its METHOD, a VAR_GLOBAL of the same name declared — the global, or not declared?",
    fromDoc: "02-variables.md",
    source: `VAR_GLOBAL
	vtgm : INT := 40;
END_VAR

FUNCTION_BLOCK FB_LANG_vtgm
VAR_TEMP
	vtgm : INT;
END_VAR
VAR
	seen : INT;
END_VAR
vtgm := 5;
Probe();
END_FUNCTION_BLOCK

METHOD Probe
seen := vtgm + 1;
END_METHOD
`,
    gvlNames: ["GVL_LANG_var_temp_named_in_method_beside_global"],
    plcPrgVar: "inst : FB_LANG_vtgm; out : INT; g : INT;",
    plcPrgBody: "inst(); out := inst.seen; g := vtgm;",
  },
  {
    name: "var_temp_named_in_derived_body_beside_global",
    pouName: "FB_LANG_vtgd",
    kind: "function_block",
    feature: "a base FB's VAR_TEMP named in the derived FB's body, a VAR_GLOBAL of the same name declared — the global, or not declared?",
    fromDoc: "02-variables.md",
    source: `VAR_GLOBAL
	vtgd : INT := 40;
END_VAR

FUNCTION_BLOCK FB_LANG_vtgd_base
VAR_TEMP
	vtgd : INT;
END_VAR
VAR
	seen : INT;
END_VAR
vtgd := 1;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_vtgd EXTENDS FB_LANG_vtgd_base
seen := vtgd + 1;
END_FUNCTION_BLOCK
`,
    gvlNames: ["GVL_LANG_var_temp_named_in_derived_body_beside_global"],
    plcPrgVar: "inst : FB_LANG_vtgd; out : INT; g : INT;",
    plcPrgBody: "inst(); out := inst.seen; g := vtgd;",
  },
]

export const SECTION_SEMANTICS_TESTS: readonly LanguageTest[] = [
  ...counters,
  ...constants,
  ...composites,
  ...transpileReview,
  ...initModel,
  ...tempScope,
  ...tempReview,
]
