/**
 * the fixtures of `init-model.ts` — part B.
 *
 * One slice of `init-model.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import { FB_INIT, clock, doc } from "./init-model-shared.js"

export const INIT_MODEL_TESTS_B: readonly LanguageTest[] = [
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
  // transpile-restructure 7.8d (gate review of 7.8.8): a STRUCTURED initializer whose value RUNS (a call, an address) on
  // an instance whose type has running field initializers — `fb_init_and_structured_initializer` records only a constant
  // one beside FB_Init. The type's fields first, then the structured value: v 103, w 2, seq 3. The structured value
  // first, the type's after it: v 2, w 3, seq 3. The structured value REPLACING the type's initializer of v, in its
  // place: v 101, w 2, seq 2; at the end: v 102, w 1, seq 2.
  {
    name: "init_structured_running_initializer",
    pouName: "GVL_LANG_sri",
    kind: "gvl",
    feature: "a structured initializer that calls, on an instance whose type's field initializers call too",
    fromDoc: doc,
    source: `VAR_GLOBAL
	gLangSriSeq : INT;
END_VAR

${clock("gLangSriSeq", "F_LANG_sri_next")}
FUNCTION_BLOCK FB_LANG_sri
VAR
	v : INT := F_LANG_sri_next();
	w : INT := F_LANG_sri_next();
END_VAR
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_sri := (v := F_LANG_sri_next() + 100); seqAtScan : INT;",
    plcPrgBody: "inst();\nseqAtScan := gLangSriSeq;",
  },
  // ...and an ADDRESS: the type binds `p` to its own `x` (7), the instance's structured initializer to PLC_PRG's `y` (9).
  // 9 when the structured value is applied after the type's binding, 7 when before.
  {
    name: "init_structured_binding_override",
    pouName: "FB_LANG_sbo",
    kind: "function_block",
    feature: "a structured initializer binding a pointer field the type's own initializer binds to another variable",
    fromDoc: doc,
    source: `FUNCTION_BLOCK FB_LANG_sbo
VAR
	p : POINTER TO INT := ADR(x);
	x : INT := 7;
	seen : INT;
END_VAR
seen := p^;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "y : INT := 9; inst : FB_LANG_sbo := (p := ADR(y)); out : INT;",
    plcPrgBody: "inst();\nout := inst.seen;",
  },
  // ...a CONSTANT structured value over a field whose type initializer calls: 50 when it is applied after the type's, the
  // call's 1 when before; w 2 and seq 2 either way (the type's call still runs, unless the structured value replaces it).
  {
    name: "init_structured_constant_over_running",
    pouName: "GVL_LANG_sco",
    kind: "gvl",
    feature: "a constant structured initializer of a field whose type initializer calls",
    fromDoc: doc,
    source: `VAR_GLOBAL
	gLangScoSeq : INT;
END_VAR

${clock("gLangScoSeq", "F_LANG_sco_next")}
FUNCTION_BLOCK FB_LANG_sco
VAR
	v : INT := F_LANG_sco_next();
	w : INT := F_LANG_sco_next();
END_VAR
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_sco := (v := 50); seqAtScan : INT;",
    plcPrgBody: "inst();\nseqAtScan := gLangScoSeq;",
  },
  // ...and a constant 0 over the type's binding `p := ADR(x)`: isNull TRUE when the structured value is applied after it.
  {
    name: "init_structured_null_over_binding",
    pouName: "FB_LANG_snb",
    kind: "function_block",
    feature: "a structured initializer setting to 0 a pointer field the type binds with ADR",
    fromDoc: doc,
    source: `FUNCTION_BLOCK FB_LANG_snb
VAR
	p : POINTER TO INT := ADR(x);
	x : INT := 7;
	isNull : BOOL;
END_VAR
isNull := p = 0;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_snb := (p := 0); out : BOOL;",
    plcPrgBody: "inst();\nout := inst.isNull;",
  },
]
