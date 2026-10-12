/**
 * the fixtures of `init-model.ts` — part A.
 *
 * One slice of `init-model.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import { FB_INIT, FB_INIT_V, STRUCT_FIELD_DYNAMIC, clock, doc, target } from "./init-model-shared.js"

export const INIT_MODEL_TESTS_A: readonly LanguageTest[] = [
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
    deferred: { transpile: STRUCT_FIELD_DYNAMIC },
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
    deferred: { transpile: STRUCT_FIELD_DYNAMIC },
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
    deferred: {
      transpile:
        "2026-10-09 (transpile-restructure 5.8, design.md §3.4 step 5d): `THIS^.n` and `THIS` as FB_Init arguments are neither a constant, a variable nor a struct field, so lowering refuses them (`fb-init-argument`). niche: accepted loss (0 occurrences in the corpora: every corpus FB_Init argument is a literal)",
    },
  },
]
