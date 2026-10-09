/**
 * Instance-initialization measurements — openspec transpile-restructure task 5.1 (design.md §3.4, Measure items 1, 2, 4
 * and 5): the orders the init model has to reproduce and no recording showed yet, asked of CODESYS BEFORE §3.4 decides
 * the one ordered walk.
 *
 * Most cells read a STAMP: a FUNCTION that bumps a fixture-own global counter and returns it, called from field
 * initializers, FB_Init bodies and `call_after_global_init_slot` methods. The stamps put every initialization event of a
 * fixture on one line, so "fields first", "FB_Init first" and "interleaved" are different numbers rather than a guess
 * from one value.
 *
 * Measure item 3 (a structured initializer applies after FB_Init) is NOT asked again: `fb_init_and_structured_initializer`
 * (`oop/lifecycle.ts`) records it — FB_Init saw 0 and the structured 9 stayed.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec transpile-restructure design.md §3.4 (task 5.1)"

/** The FB_Init header every probe here declares. */
const FB_INIT = "METHOD FB_Init : BOOL\nVAR_INPUT\n\tbInitRetains : BOOL;\n\tbInCopyCode : BOOL;\nEND_VAR\n"
/** The same with one argument `v`. */
const FB_INIT_V = "METHOD FB_Init : BOOL\nVAR_INPUT\n\tbInitRetains : BOOL;\n\tbInCopyCode : BOOL;\n\tv : INT;\nEND_VAR\n"

/** A global counter and the FUNCTION that bumps and returns it — the stamp clock of one fixture. */
function clock(counter: string, fn: string): string {
  return `FUNCTION ${fn} : INT\n${counter} := ${counter} + 1;\n${fn} := ${counter};\nEND_FUNCTION\n`
}

/** A target FB whose FB_Init stores its argument in `got` — and stamps itself, given a clock. */
function target(name: string, fn?: string): string {
  const field = fn === undefined ? "" : "\n\tinitStamp : INT;"
  const stamp = fn === undefined ? "" : `\ninitStamp := ${fn}();`
  return `FUNCTION_BLOCK ${name}\nVAR\n\tgot : INT;${field}\nEND_VAR\nEND_FUNCTION_BLOCK\n\n${FB_INIT_V}got := v;${stamp}\nEND_METHOD\n`
}

export const INIT_MODEL_TESTS: readonly LanguageTest[] = [
  // Measure item 1: the EXTENDS interleaving. A base and a derived FB, each with a stamped field initializer and a stamped
  // FB_Init, and a derived FB without an FB_Init of its own. "Per class" is base field 1, base FB_Init 2, derived field
  // 3, derived FB_Init 4; "fields first" is 1, 3, 2, 4. The second instance's stamps say whether one instance completes
  // before the next starts (5, 6, 7) or every instance's fields run before any FB_Init.
  {
    name: "init_extends_interleaving",
    pouName: "GVL_LANG_initext",
    kind: "gvl",
    feature: "the order of base field initializers, base FB_Init, derived field initializers and derived FB_Init of one instance",
    fromDoc: doc,
    source: `VAR_GLOBAL
	gLangInitExtSeq : INT;
END_VAR

${clock("gLangInitExtSeq", "F_LANG_initext_next")}
FUNCTION_BLOCK FB_LANG_initext_base
VAR
	baseField : INT := F_LANG_initext_next();
	baseInit : INT;
END_VAR
END_FUNCTION_BLOCK

${FB_INIT}baseInit := F_LANG_initext_next();
END_METHOD

FUNCTION_BLOCK FB_LANG_initext_derived EXTENDS FB_LANG_initext_base
VAR
	derivedField : INT := F_LANG_initext_next();
	derivedInit : INT;
END_VAR
END_FUNCTION_BLOCK

${FB_INIT}derivedInit := F_LANG_initext_next();
END_METHOD

FUNCTION_BLOCK FB_LANG_initext_plain EXTENDS FB_LANG_initext_base
VAR
	plainField : INT := F_LANG_initext_next();
END_VAR
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_initext_derived; plain : FB_LANG_initext_plain; seqAtScan : INT;",
    plcPrgBody: "inst();\nplain();\nseqAtScan := gLangInitExtSeq;",
  },
  // Measure item 2: an FB instance inside a STRUCT field — where its FB_Init runs among the struct's other field
  // initializers, and the scope its FB_Init arguments resolve in (appendix: "a STRUCT field's FB_Init arguments folded
  // in the declaring POU's scope"). Here: a global and a literal argument; the struct both in PLC_PRG and inside an FB.
  {
    name: "init_struct_field_fb_init_scope",
    pouName: "GVL_LANG_sfs",
    kind: "gvl",
    feature: "an FB instance as a STRUCT field: its FB_Init's place among the struct's field initializers, with a global and a literal argument",
    fromDoc: doc,
    source: `VAR_GLOBAL
	gLangSfsSeq : INT;
	gLangSfsSeed : INT := 6;
END_VAR

${clock("gLangSfsSeq", "F_LANG_sfs_next")}
${target("FB_LANG_sfs_target", "F_LANG_sfs_next")}
TYPE DUT_LANG_sfs :
STRUCT
	before : INT := F_LANG_sfs_next();
	viaGlobal : FB_LANG_sfs_target(v := gLangSfsSeed);
	viaLiteral : FB_LANG_sfs_target(v := 3);
	after : INT := F_LANG_sfs_next();
END_STRUCT
END_TYPE

FUNCTION_BLOCK FB_LANG_sfs_holder
VAR
	h : DUT_LANG_sfs;
END_VAR
END_FUNCTION_BLOCK
`,
    plcPrgVar: "rec : DUT_LANG_sfs; holder : FB_LANG_sfs_holder; seqAtScan : INT;",
    plcPrgBody: "holder();\nseqAtScan := gLangSfsSeq;",
  },
  // ...the same field's argument naming a variable of the POU that DECLARES the struct variable: the struct type cannot
  // see it, unless CODESYS resolves the argument where the struct is instantiated.
  {
    name: "init_struct_field_fb_init_scope_local",
    pouName: "FB_LANG_sfsl_holder",
    kind: "function_block",
    feature: "an FB instance as a STRUCT field whose FB_Init argument names a local of the POU declaring the struct variable",
    fromDoc: doc,
    source: `${target("FB_LANG_sfsl_target")}
TYPE DUT_LANG_sfsl :
STRUCT
	held : FB_LANG_sfsl_target(v := sfslSeed);
END_STRUCT
END_TYPE

FUNCTION_BLOCK FB_LANG_sfsl_holder
VAR
	sfslSeed : INT := 4;
	h : DUT_LANG_sfsl;
END_VAR
END_FUNCTION_BLOCK
`,
    plcPrgVar: "holder : FB_LANG_sfsl_holder;",
    plcPrgBody: "holder();",
    deferred: {
      lsp: "2026-10-09 (transpile-restructure 5.1): both vendors refuse the argument (\"Identifier 'sfslSeed' not defined\" — a STRUCT field's FB_Init argument resolves in the struct's scope, not the declaring POU's); the LSP does not check a STRUCT field's FB_Init arguments. niche: accepted loss (0 occurrences in the corpora: no STRUCT field declares FB_Init arguments)",
    },
  },
  // ...and naming a SIBLING field of the struct, declared before it.
  {
    name: "init_struct_field_fb_init_scope_sibling",
    pouName: "FB_LANG_sfss_target",
    kind: "function_block",
    feature: "an FB instance as a STRUCT field whose FB_Init argument names an earlier field of the same struct",
    fromDoc: doc,
    source: `${target("FB_LANG_sfss_target")}
TYPE DUT_LANG_sfss :
STRUCT
	first : INT := 4;
	held : FB_LANG_sfss_target(v := first);
END_STRUCT
END_TYPE
`,
    plcPrgVar: "rec : DUT_LANG_sfss;",
    plcPrgBody: "rec.first := rec.first;",
  },
  // ...a field named like a GLOBAL holding a different value: the field (4) or the global (11) — the precedence "the
  // struct's fields, then globals" (gate 5a review).
  {
    name: "init_struct_field_fb_init_scope_shadow",
    pouName: "GVL_LANG_sfsg",
    kind: "gvl",
    feature: "an FB instance as a STRUCT field whose FB_Init argument names an earlier field that shares its name with a global",
    fromDoc: doc,
    source: `VAR_GLOBAL
	sfsgFirst : INT := 11;
END_VAR

${target("FB_LANG_sfsg_target")}
TYPE DUT_LANG_sfsg :
STRUCT
	sfsgFirst : INT := 4;
	held : FB_LANG_sfsg_target(v := sfsgFirst);
END_STRUCT
END_TYPE
`,
    plcPrgVar: "rec : DUT_LANG_sfsg;",
    plcPrgBody: "rec.sfsgFirst := rec.sfsgFirst;",
  },
  // ...an earlier field whose initializer is DYNAMIC (a stamp): the argument reads the field's value (1, the clock once)
  // or re-evaluates its initializer (2) — a static fold of the type's initializer cannot tell (gate 5a review).
  {
    name: "init_struct_field_fb_init_scope_dynamic",
    pouName: "GVL_LANG_sfsd",
    kind: "gvl",
    feature: "an FB instance as a STRUCT field whose FB_Init argument names an earlier field with a dynamic (FUNCTION call) initializer",
    fromDoc: doc,
    source: `VAR_GLOBAL
	gLangSfsdSeq : INT;
END_VAR

${clock("gLangSfsdSeq", "F_LANG_sfsd_next")}
${target("FB_LANG_sfsd_target")}
TYPE DUT_LANG_sfsd :
STRUCT
	first : INT := F_LANG_sfsd_next();
	held : FB_LANG_sfsd_target(v := first);
END_STRUCT
END_TYPE
`,
    plcPrgVar: "rec : DUT_LANG_sfsd; seqAtScan : INT;",
    plcPrgBody: "seqAtScan := gLangSfsdSeq;",
  },
  // Measure item 4: the order across a GVL's scalar initializers and FB instance, a PROGRAM's own initializers and FB
  // instance, PLC_PRG's, and every instance's `call_after_global_init_slot` method. Each event stamps itself; PLC_PRG
  // copies the stamps it cannot expand (the GVL's and the PROGRAM's) into its own variables.
  {
    name: "init_gvl_program_slot_order",
    pouName: "GVL_LANG_gps",
    kind: "gvl",
    feature: "the initialization order across GVL initializers and instances, PROGRAM initializers and instances, and call_after_global_init_slot methods",
    fromDoc: doc,
    source: `VAR_GLOBAL
	gLangGpsSeq : INT;
	gLangGpsBefore : INT := F_LANG_gps_next();
	gLangGpsInst : FB_LANG_gps_probe;
	gLangGpsAfter : INT := F_LANG_gps_next();
END_VAR

${clock("gLangGpsSeq", "F_LANG_gps_next")}
FUNCTION_BLOCK FB_LANG_gps_probe
VAR
	fieldStamp : INT := F_LANG_gps_next();
	initStamp : INT;
	slotStamp : INT;
END_VAR
END_FUNCTION_BLOCK

${FB_INIT}initStamp := F_LANG_gps_next();
END_METHOD

{attribute 'call_after_global_init_slot' := '50000'}
METHOD AfterGlobalInit
slotStamp := F_LANG_gps_next();
END_METHOD

PROGRAM PRG_LANG_gps
VAR
	ownBefore : INT := F_LANG_gps_next();
	inst : FB_LANG_gps_probe;
	ownAfter : INT := F_LANG_gps_next();
END_VAR
;
END_PROGRAM
`,
    plcPrgVar: [
      "plcBefore : INT := F_LANG_gps_next(); local : FB_LANG_gps_probe; plcAfter : INT := F_LANG_gps_next();",
      "gBefore : INT; gField : INT; gInit : INT; gSlot : INT; gAfter : INT;",
      "pBefore : INT; pField : INT; pInit : INT; pSlot : INT; pAfter : INT; seqAtScan : INT;",
    ].join(" "),
    plcPrgBody: [
      "PRG_LANG_gps();",
      "gBefore := gLangGpsBefore; gField := gLangGpsInst.fieldStamp; gInit := gLangGpsInst.initStamp; gSlot := gLangGpsInst.slotStamp; gAfter := gLangGpsAfter;",
      "pBefore := PRG_LANG_gps.ownBefore; pField := PRG_LANG_gps.inst.fieldStamp; pInit := PRG_LANG_gps.inst.initStamp; pSlot := PRG_LANG_gps.inst.slotStamp; pAfter := PRG_LANG_gps.ownAfter;",
      "seqAtScan := gLangGpsSeq;",
    ].join("\n"),
  },
  // ...the same events with the names reordered (gate 5a review): the called PROGRAM sorts BEFORE PLC_PRG and the GVL
  // AFTER it, so a frame order that is alphabetical or object-tree order gives other stamps than "the GVL, then
  // PLC_PRG, then the PROGRAM it calls" — which the names of `init_gvl_program_slot_order` cannot tell apart.
  {
    name: "init_gvl_program_slot_order_renamed",
    pouName: "Z_GVL_LANG_gpsn",
    kind: "gvl",
    feature: "the initialization order across frames with the GVL named after PLC_PRG and the called PROGRAM before it",
    fromDoc: doc,
    source: `VAR_GLOBAL
	gLangGpsnSeq : INT;
	gLangGpsnBefore : INT := F_LANG_gpsn_next();
	gLangGpsnInst : FB_LANG_gpsn_probe;
	gLangGpsnAfter : INT := F_LANG_gpsn_next();
END_VAR

${clock("gLangGpsnSeq", "F_LANG_gpsn_next")}
FUNCTION_BLOCK FB_LANG_gpsn_probe
VAR
	fieldStamp : INT := F_LANG_gpsn_next();
	initStamp : INT;
	slotStamp : INT;
END_VAR
END_FUNCTION_BLOCK

${FB_INIT}initStamp := F_LANG_gpsn_next();
END_METHOD

{attribute 'call_after_global_init_slot' := '50000'}
METHOD AfterGlobalInit
slotStamp := F_LANG_gpsn_next();
END_METHOD

PROGRAM A_PRG_LANG_gpsn
VAR
	ownBefore : INT := F_LANG_gpsn_next();
	inst : FB_LANG_gpsn_probe;
	ownAfter : INT := F_LANG_gpsn_next();
END_VAR
;
END_PROGRAM
`,
    plcPrgVar: [
      "plcBefore : INT := F_LANG_gpsn_next(); local : FB_LANG_gpsn_probe; plcAfter : INT := F_LANG_gpsn_next();",
      "gBefore : INT; gField : INT; gInit : INT; gSlot : INT; gAfter : INT;",
      "pBefore : INT; pField : INT; pInit : INT; pSlot : INT; pAfter : INT; seqAtScan : INT;",
    ].join(" "),
    plcPrgBody: [
      "A_PRG_LANG_gpsn();",
      "gBefore := gLangGpsnBefore; gField := gLangGpsnInst.fieldStamp; gInit := gLangGpsnInst.initStamp; gSlot := gLangGpsnInst.slotStamp; gAfter := gLangGpsnAfter;",
      "pBefore := A_PRG_LANG_gpsn.ownBefore; pField := A_PRG_LANG_gpsn.inst.fieldStamp; pInit := A_PRG_LANG_gpsn.inst.initStamp; pSlot := A_PRG_LANG_gpsn.inst.slotStamp; pAfter := A_PRG_LANG_gpsn.ownAfter;",
      "seqAtScan := gLangGpsnSeq;",
    ].join("\n"),
  },
  // Measure item 5: THIS inside a scalar initializer, reading a field declared before it and one declared after it.
  // (`initseq_this` stores THIS in a pointer and reads it in the body; `tr_22_fb_init_reads_this_field` in FB_Init.)
  {
    name: "init_this_in_initializer",
    pouName: "FB_LANG_initthis",
    kind: "function_block",
    feature: "THIS^.field in a field initializer — a field declared before it, and one declared after it",
    fromDoc: doc,
    source: `FUNCTION_BLOCK FB_LANG_initthis
VAR
	n : INT := 7;
	viaThisEarlier : INT := THIS^.n;
	viaThisLater : INT := THIS^.m;
	m : INT := 9;
END_VAR
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_initthis;",
    plcPrgBody: "inst();",
  },
  // ...and THIS as an FB_Init argument of an instance inside the FB: THIS^.n by value, and THIS itself as a pointer the
  // inner FB_Init reads through.
  {
    name: "init_this_in_initializer_argument",
    pouName: "FB_LANG_initthisa",
    kind: "function_block",
    feature: "THIS^.field and THIS as FB_Init arguments of an instance declared inside the FB",
    fromDoc: doc,
    source: `FUNCTION_BLOCK FB_LANG_initthisa_byvalue
VAR
	got : INT;
END_VAR
END_FUNCTION_BLOCK

${FB_INIT_V}got := v;
END_METHOD

FUNCTION_BLOCK FB_LANG_initthisa_bypointer
VAR
	got : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD FB_Init : BOOL
VAR_INPUT
	bInitRetains : BOOL;
	bInCopyCode : BOOL;
	owner : POINTER TO FB_LANG_initthisa;
END_VAR
got := owner^.n;
END_METHOD

FUNCTION_BLOCK FB_LANG_initthisa
VAR
	n : INT := 7;
	byValue : FB_LANG_initthisa_byvalue(v := THIS^.n);
	byPointer : FB_LANG_initthisa_bypointer(owner := THIS);
END_VAR
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_initthisa;",
    plcPrgBody: "inst();",
  },
  // transpile-restructure 5.6 (design.md §3.4): an EXTENDS chain holding a field INSTANCE that runs FB_Init — where that
  // FB_Init falls against the base's FB_Init and the derived class's field initializers and FB_Init. `inst`: the field
  // instance in the DERIVED class, with a derived FB_Init; `plain`: the same without a derived FB_Init. Per class, the
  // derived fields in declaration order: base field, base FB_Init, `before`, the inner FB_Init, `after`, derived FB_Init.
  {
    name: "init_extends_field_instance",
    pouName: "GVL_LANG_ief",
    kind: "gvl",
    feature: "an EXTENDS chain whose derived class holds a field instance running FB_Init — with and without the derived FB_Init",
    fromDoc: doc,
    source: `VAR_GLOBAL
	gLangIefSeq : INT;
END_VAR

${clock("gLangIefSeq", "F_LANG_ief_next")}
FUNCTION_BLOCK FB_LANG_ief_inner
VAR
	innerInit : INT;
END_VAR
END_FUNCTION_BLOCK

${FB_INIT}innerInit := F_LANG_ief_next();
END_METHOD

FUNCTION_BLOCK FB_LANG_ief_base
VAR
	baseField : INT := F_LANG_ief_next();
	baseInit : INT;
END_VAR
END_FUNCTION_BLOCK

${FB_INIT}baseInit := F_LANG_ief_next();
END_METHOD

FUNCTION_BLOCK FB_LANG_ief_derived EXTENDS FB_LANG_ief_base
VAR
	before : INT := F_LANG_ief_next();
	inner : FB_LANG_ief_inner;
	after : INT := F_LANG_ief_next();
	derivedInit : INT;
END_VAR
END_FUNCTION_BLOCK

${FB_INIT}derivedInit := F_LANG_ief_next();
END_METHOD

FUNCTION_BLOCK FB_LANG_ief_plain EXTENDS FB_LANG_ief_base
VAR
	before : INT := F_LANG_ief_next();
	inner : FB_LANG_ief_inner;
	after : INT := F_LANG_ief_next();
END_VAR
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_ief_derived; plain : FB_LANG_ief_plain; seqAtScan : INT;",
    plcPrgBody: "inst();\nplain();\nseqAtScan := gLangIefSeq;",
  },
  // ...the field instance in the BASE class, between two stamped base fields, under a derived class with its own field
  // and FB_Init.
  {
    name: "init_extends_field_instance_in_base",
    pouName: "GVL_LANG_iefb",
    kind: "gvl",
    feature: "an EXTENDS chain whose BASE class holds a field instance running FB_Init, under a derived class with its own field and FB_Init",
    fromDoc: doc,
    source: `VAR_GLOBAL
	gLangIefbSeq : INT;
END_VAR

${clock("gLangIefbSeq", "F_LANG_iefb_next")}
FUNCTION_BLOCK FB_LANG_iefb_inner
VAR
	innerInit : INT;
END_VAR
END_FUNCTION_BLOCK

${FB_INIT}innerInit := F_LANG_iefb_next();
END_METHOD

FUNCTION_BLOCK FB_LANG_iefb_base
VAR
	baseBefore : INT := F_LANG_iefb_next();
	inner : FB_LANG_iefb_inner;
	baseAfter : INT := F_LANG_iefb_next();
	baseInit : INT;
END_VAR
END_FUNCTION_BLOCK

${FB_INIT}baseInit := F_LANG_iefb_next();
END_METHOD

FUNCTION_BLOCK FB_LANG_iefb_derived EXTENDS FB_LANG_iefb_base
VAR
	derivedField : INT := F_LANG_iefb_next();
	derivedInit : INT;
END_VAR
END_FUNCTION_BLOCK

${FB_INIT}derivedInit := F_LANG_iefb_next();
END_METHOD
`,
    plcPrgVar: "inst : FB_LANG_iefb_derived; seqAtScan : INT;",
    plcPrgBody: "inst();\nseqAtScan := gLangIefbSeq;",
  },
  // transpile-restructure 5.7 (design.md §3.4): the frame order among SEVERAL GVLs and several called PROGRAMs. Two GVLs
  // (declared a, b) and two PROGRAMs (declared a, b, CALLED b then a), each frame stamping one initializer. The renamed
  // twin declares Z before A and calls A before Z, so declaration order, name order and call order give three different
  // answers across the pair.
  {
    name: "init_frame_order_several",
    pouName: "GVL_LANG_ifo_a",
    kind: "gvl",
    gvlNames: ["GVL_LANG_ifo_a", "GVL_LANG_ifo_b"],
    feature: "the initialization order of two GVLs and two called PROGRAMs, each stamping one initializer",
    fromDoc: doc,
    source: `VAR_GLOBAL
	gLangIfoSeq : INT;
	gLangIfoA : INT := F_LANG_ifo_next();
END_VAR

VAR_GLOBAL
	gLangIfoB : INT := F_LANG_ifo_next();
END_VAR

${clock("gLangIfoSeq", "F_LANG_ifo_next")}
PROGRAM PRG_LANG_ifo_a
VAR
	own : INT := F_LANG_ifo_next();
END_VAR
;
END_PROGRAM

PROGRAM PRG_LANG_ifo_b
VAR
	own : INT := F_LANG_ifo_next();
END_VAR
;
END_PROGRAM
`,
    plcPrgVar: "plcOwn : INT := F_LANG_ifo_next(); gA : INT; gB : INT; pA : INT; pB : INT; seqAtScan : INT;",
    plcPrgBody: [
      "PRG_LANG_ifo_b();",
      "PRG_LANG_ifo_a();",
      "gA := gLangIfoA; gB := gLangIfoB; pA := PRG_LANG_ifo_a.own; pB := PRG_LANG_ifo_b.own;",
      "seqAtScan := gLangIfoSeq;",
    ].join("\n"),
  },
  {
    name: "init_frame_order_several_renamed",
    pouName: "Z_GVL_LANG_ifon",
    kind: "gvl",
    gvlNames: ["Z_GVL_LANG_ifon", "A_GVL_LANG_ifon"],
    feature: "the initialization order of two GVLs and two called PROGRAMs, declared Z before A and called A before Z",
    fromDoc: doc,
    source: `VAR_GLOBAL
	gLangIfonSeq : INT;
	gLangIfonZ : INT := F_LANG_ifon_next();
END_VAR

VAR_GLOBAL
	gLangIfonA : INT := F_LANG_ifon_next();
END_VAR

${clock("gLangIfonSeq", "F_LANG_ifon_next")}
PROGRAM Z_PRG_LANG_ifon
VAR
	own : INT := F_LANG_ifon_next();
END_VAR
;
END_PROGRAM

PROGRAM A_PRG_LANG_ifon
VAR
	own : INT := F_LANG_ifon_next();
END_VAR
;
END_PROGRAM
`,
    plcPrgVar: "plcOwn : INT := F_LANG_ifon_next(); gZ : INT; gA : INT; pZ : INT; pA : INT; seqAtScan : INT;",
    plcPrgBody: [
      "A_PRG_LANG_ifon();",
      "Z_PRG_LANG_ifon();",
      "gZ := gLangIfonZ; gA := gLangIfonA; pZ := Z_PRG_LANG_ifon.own; pA := A_PRG_LANG_ifon.own;",
      "seqAtScan := gLangIfonSeq;",
    ].join("\n"),
  },
]
