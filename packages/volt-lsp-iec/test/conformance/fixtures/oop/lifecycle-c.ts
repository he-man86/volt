/**
 * the fixtures of `lifecycle.ts` — part C.
 *
 * One slice of `lifecycle.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"

export const LIFECYCLE_TESTS_C: readonly LanguageTest[] = [
  // An instance-path inside an FB held by a PROGRAM that has a METHOD: the program's name once.
  {
    name: "instance_path_in_program_with_method",
    pouName: "PRG_LANG_pathM",
    kind: "program",
    feature: "{attribute 'instance-path'} in an FB instance nested in a PROGRAM that has a METHOD",
    fromDoc: "07-pragmas.md#instance-path",
    deferred: {
      transpile:
        "the path is taken from the project tree, Device.Application.PRG_LANG_pathM.outer.inner — the simulator's reads Device.Sim.Device.Application…, a segment the tree does not hold (user decision 2026-09-15); the program's name once is checked in lower/init/attributes.test.ts",
    },
    plcPrgVar: "seen : STRING(255);",
    plcPrgBody: "PRG_LANG_pathM();\nseen := PRG_LANG_pathM.outer.inner.sMyPath;",
    source: `PROGRAM PRG_LANG_pathM
VAR
	outer : FB_LANG_pathOuterM;
END_VAR
Nop();
outer();
END_PROGRAM

METHOD Nop
;
END_METHOD

FUNCTION_BLOCK FB_LANG_pathOuterM
VAR
	inner : FB_LANG_pathInnerM;
END_VAR
END_FUNCTION_BLOCK

{attribute 'reflection'}
FUNCTION_BLOCK FB_LANG_pathInnerM
VAR
	{attribute 'instance-path'}
	{attribute 'noinit'}
	sMyPath : STRING(255);
END_VAR
END_FUNCTION_BLOCK
`,
  },
  // (6) The same with a global variable that has an initial value.
  {
    name: "fb_init_argument_from_global",
    pouName: "GVL_LANG_init_seed",
    kind: "gvl",
    feature: "an FB_Init argument naming a global variable, which has an initial value",
    fromDoc: "11-fb-lifecycle.md#fb_init",
    plcPrgVar: "fromGlobal : FB_LANG_init_gvar(startValue := gLangInitSeed);",
    plcPrgBody: "fromGlobal();",
    source: `VAR_GLOBAL
	gLangInitSeed : INT := 6;
END_VAR

FUNCTION_BLOCK FB_LANG_init_gvar
VAR
	started : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD FB_Init : BOOL
VAR_INPUT
	bInitRetains : BOOL;
	bInCopyCode : BOOL;
	startValue : INT;
END_VAR
started := startValue;
END_METHOD
`,
  },
  // An instance declared WITHOUT the argument FB_Init's extra input needs. Recorded: it does not compile — "No matching
  // 'FB_Init' method found for instantiation of FB_LANG_init_leftout. Specified 'FB_Init' method requires exactly 1 inputs".
  {
    name: "fb_init_argument_left_out",
    pouName: "FB_LANG_init_leftout",
    kind: "function_block",
    feature: "an instance of an FB whose FB_Init has an extra input, declared without an initializer",
    fromDoc: "11-fb-lifecycle.md#fb_init",
    plcPrgVar: "plain : FB_LANG_init_leftout;",
    plcPrgBody: "plain();",
    source: `FUNCTION_BLOCK FB_LANG_init_leftout
VAR
	started : INT := 3;
	initCalls : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD FB_Init : BOOL
VAR_INPUT
	bInitRetains : BOOL;
	bInCopyCode : BOOL;
	startValue : INT;
END_VAR
started := startValue;
initCalls := initCalls + 1;
END_METHOD
`,
  },
  // ═══ transpile-review-2026-09-29: the lifecycle root causes (tasks 15, 16, 22, 23, 29). Each case asks the vendor
  //     and the recorder answers. The values the review measured LIVE are quoted as leads, not as expectations. ═══

  // Task 15: copying an FB instance whole (`b := a`). Does the copy's ADR(own member) pointer keep the SOURCE's
  // address, or point at its own member? The review measured LIVE r=7, sameA=TRUE, sameB=FALSE (the copy keeps a's
  // address). The lowering re-targets the pointer at b.x (r=5). Until a foreign target is modelled, the transpiler must
  // refuse it.
  {
    name: "tr_15_fb_copy_keeps_pointer_address",
    pouName: "FB_LANG_tr15_ptrcopy",
    kind: "function_block",
    feature: "an FB instance assigned whole to another; its POINTER field was initialized to ADR(its own member)",
    fromDoc: "07-pragmas.md#no_assign",
    note: "transpile-review-2026-09-29 task 15 (lower/statements/assign.ts whole-value assign; lower/pointers/state.ts frame-relative targets).",
    plcPrgVar: "a : FB_LANG_tr15_ptrcopy; b : FB_LANG_tr15_ptrcopy; rb : INT; ra : INT; sameA : BOOL; sameB : BOOL;",
    plcPrgBody: [
      "b := a;",
      "a(set := 7);",
      "b(set := 0);",
      "rb := b.seen;",
      "ra := a.seen;",
      "sameA := b.p = ADR(a.x);",
      "sameB := b.p = ADR(b.x);",
    ].join("\n"),
    source: `FUNCTION_BLOCK FB_LANG_tr15_ptrcopy
VAR_INPUT
	set : INT;
END_VAR
VAR
	x : INT := 5;
	p : POINTER TO INT := ADR(x);
	seen : INT;
END_VAR
IF set <> 0 THEN
	x := set;
END_IF
seen := p^;
END_FUNCTION_BLOCK
`,
  },
  // Task 16: an instance with a VAR_IN_OUT is called with its own variable first (so it holds its own binding), then
  // overwritten whole by an instance bound to a different variable. Whose variable does the target's METHOD write
  // through? Instance assignment copies the in-out's pointer (07-pragmas.md), so the lead is first=11, second=100. The
  // lowering has no dispatch arm for the copied binding and panics.
  {
    name: "tr_16_fb_copy_carries_inout_binding",
    pouName: "FB_LANG_tr16_worker",
    kind: "function_block",
    feature:
      "an FB instance with a VAR_IN_OUT, called, then assigned whole from an instance bound elsewhere; its METHOD writes the in-out",
    fromDoc: "07-pragmas.md#no_assign",
    note: "transpile-review-2026-09-29 task 16 (lower/calls/last-binding.ts arms dispatch only for tags this instance's own calls wrote). Cf. callshape_inout_in_method_after_call.",
    plcPrgVar: "w : FB_LANG_tr16_worker; w2 : FB_LANG_tr16_worker; first : INT := 1; second : INT := 100;",
    plcPrgBody: ["w(shared := first);", "w2(shared := second);", "w2 := w;", "w2.AddTen();"].join("\n"),
    source: `FUNCTION_BLOCK FB_LANG_tr16_worker
VAR_IN_OUT
	shared : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD AddTen
shared := shared + 10;
END_METHOD
`,
  },
  // Task 16, the shapes around it (review of transpile-restructure 4e): the copy's target never called itself, so the
  // copied binding is the only one it holds; and the copy made the other way, the SOURCE then calling its METHOD.
  {
    name: "tr_16_fb_copy_into_uncalled_carries_inout_binding",
    pouName: "FB_LANG_tr16b_worker",
    kind: "function_block",
    feature: "an FB instance with a VAR_IN_OUT, never called, assigned whole from a called instance; its METHOD writes the in-out",
    fromDoc: "07-pragmas.md#no_assign",
    note: "Review of transpile-restructure 4e (lower/calls/last-binding.ts: every binding of a copied FB type is an arm). Cf. tr_16_fb_copy_carries_inout_binding.",
    plcPrgVar: "w : FB_LANG_tr16b_worker; w2 : FB_LANG_tr16b_worker; first : INT := 1; second : INT := 100;",
    plcPrgBody: ["w(shared := first);", "w2 := w;", "w2.AddTen();"].join("\n"),
    source: `FUNCTION_BLOCK FB_LANG_tr16b_worker
VAR_IN_OUT
	shared : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD AddTen
shared := shared + 10;
END_METHOD
`,
  },
  {
    name: "tr_16_fb_copy_reverse_carries_inout_binding",
    pouName: "FB_LANG_tr16c_worker",
    kind: "function_block",
    feature: "two FB instances each called with its own VAR_IN_OUT, the first assigned whole from the second; the first's METHOD writes the in-out",
    fromDoc: "07-pragmas.md#no_assign",
    note: "Review of transpile-restructure 4e (lower/calls/last-binding.ts: every binding of a copied FB type is an arm). Cf. tr_16_fb_copy_carries_inout_binding.",
    plcPrgVar: "w : FB_LANG_tr16c_worker; w2 : FB_LANG_tr16c_worker; first : INT := 1; second : INT := 100;",
    plcPrgBody: ["w(shared := first);", "w2(shared := second);", "w := w2;", "w.AddTen();"].join("\n"),
    source: `FUNCTION_BLOCK FB_LANG_tr16c_worker
VAR_IN_OUT
	shared : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD AddTen
shared := shared + 10;
END_METHOD
`,
  },
  // ...and the copy taken from ANOTHER instance of a frame type there are several of: x1's inner is bound to x1.a, copied
  // into x2's w2, and x2's METHOD writes through it (an OUTPUT read and an INPUT written from outside: with both a plain VAR
  // CODESYS refuses the copy, "'w2' is no input of ...", record:exec 2026-10-09). The lowering lent `a` from the running frame (x2.a) with no
  // diagnostic; it now refuses (`call-fb-inout`). Whose `a` CODESYS writes is what this records.
  {
    name: "tr_16_fb_copy_across_frame_instances",
    pouName: "FB_LANG_tr16d_holder",
    kind: "function_block",
    feature: "an FB holding an instance with a VAR_IN_OUT bound to its own variable; one holder's instance copied into another holder's, whose METHOD writes the in-out",
    fromDoc: "07-pragmas.md#no_assign",
    note: "Review of transpile-restructure 4e (lower/calls/last-binding.ts lent the copied binding's places from the running frame). Cf. tr_16_fb_copy_carries_inout_binding.",
    plcPrgVar: "x1 : FB_LANG_tr16d_holder; x2 : FB_LANG_tr16d_holder;",
    plcPrgBody: ["x1();", "x2();", "x2.w2 := x1.inner;", "x2.Use();"].join("\n"),
    source: `FUNCTION_BLOCK FB_LANG_tr16d_holder
VAR_INPUT
	w2 : FB_LANG_tr16_worker;
END_VAR
VAR_OUTPUT
	inner : FB_LANG_tr16_worker;
END_VAR
VAR
	a : INT := 1;
END_VAR
inner(shared := a);
END_FUNCTION_BLOCK

METHOD Use
w2.AddTen();
END_METHOD
`,
  },
  // Task 22: does an instance's implicit initialization (its non-constant field initializers) complete BEFORE its
  // FB_Init (11-fb-lifecycle.md:23)? Three initializer shapes, each read inside FB_Init. The lowering runs FB_Init
  // first: a null dereference for ADR(), and seen=0 / a=7 for the call.
  {
    name: "tr_22_fb_init_reads_adr_field",
    pouName: "FB_LANG_tr22_adr",
    kind: "function_block",
    feature: "FB_Init dereferencing a POINTER field initialized to ADR(a member with an initial value)",
    fromDoc: "11-fb-lifecycle.md#critical-rules",
    note: "transpile-review-2026-09-29 task 22 (lower/init/fb-init.ts pushed the FB_Init invokes before the <FB>.__INIT invokes; fixed).",
    plcPrgVar: "inst : FB_LANG_tr22_adr;",
    plcPrgBody: "inst();",
    source: `FUNCTION_BLOCK FB_LANG_tr22_adr
VAR
	m : INT := 7;
	p : POINTER TO INT := ADR(m);
	seen : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD FB_Init : BOOL
VAR_INPUT
	bInitRetains : BOOL;
	bInCopyCode : BOOL;
END_VAR
seen := p^;
END_METHOD
`,
  },
  {
    name: "tr_22_fb_init_reads_call_field",
    pouName: "FB_LANG_tr22_call",
    kind: "function_block",
    feature: "FB_Init reading, then overwriting, a field initialized by a FUNCTION call",
    fromDoc: "11-fb-lifecycle.md#critical-rules",
    note: "transpile-review-2026-09-29 task 22. An initializer that ran after FB_Init would also undo FB_Init's write (a=7).",
    plcPrgVar: "inst : FB_LANG_tr22_call;",
    plcPrgBody: "inst();",
    source: `FUNCTION F_LANG_tr22_inc : INT
VAR_INPUT
	n : INT;
END_VAR
F_LANG_tr22_inc := n + 1;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_tr22_call
VAR
	a : INT := F_LANG_tr22_inc(6);
	seen : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD FB_Init : BOOL
VAR_INPUT
	bInitRetains : BOOL;
	bInCopyCode : BOOL;
END_VAR
seen := a;
a := 100;
END_METHOD
`,
  },
  {
    name: "tr_22_fb_init_reads_this_field",
    pouName: "FB_LANG_tr22_this",
    kind: "function_block",
    feature: "FB_Init reading a member through a POINTER field initialized to THIS",
    fromDoc: "11-fb-lifecycle.md#critical-rules",
    note: "transpile-review-2026-09-29 task 22. Cf. initseq_this (the same initializer, read in the body).",
    plcPrgVar: "inst : FB_LANG_tr22_this;",
    plcPrgBody: "inst();",
    source: `FUNCTION_BLOCK FB_LANG_tr22_this
VAR
	self : POINTER TO FB_LANG_tr22_this := THIS;
	n : INT := 7;
	seen : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD FB_Init : BOOL
VAR_INPUT
	bInitRetains : BOOL;
	bInCopyCode : BOOL;
END_VAR
seen := self^.n;
END_METHOD
`,
  },
  // Task 23: an FB_Init argument naming a variable whose initializer does not fold (a FUNCTION call). Initializers and
  // FB_Init interleave in declaration order (initseq_fb_init_declared_last, initseq_after_fb_init), so with the variable
  // declared first the lead is got=4. The lowering passes 0. The twin declares the instance FIRST: does it compile, and
  // what arrives then?
  {
    name: "tr_23_fb_init_argument_from_pending_init",
    pouName: "FB_LANG_tr23_holder",
    kind: "function_block",
    feature: "an FB_Init argument naming a variable declared before the instance, whose initializer is a FUNCTION call",
    fromDoc: "11-fb-lifecycle.md#fb_init",
    note: "transpile-review-2026-09-29 task 23 (lower/init/fb-init.ts recordedArgument never checks pendingInits).",
    plcPrgVar: "holder : FB_LANG_tr23_holder;",
    plcPrgBody: "holder();",
    source: `FUNCTION F_LANG_tr23_inc : INT
VAR_INPUT
	n : INT;
END_VAR
F_LANG_tr23_inc := n + 1;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_tr23_target
VAR
	got : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD FB_Init : BOOL
VAR_INPUT
	bInitRetains : BOOL;
	bInCopyCode : BOOL;
	v : INT;
END_VAR
got := v;
END_METHOD

FUNCTION_BLOCK FB_LANG_tr23_holder
VAR
	x : INT := F_LANG_tr23_inc(3);
	h : FB_LANG_tr23_target(v := x);
	got : INT;
END_VAR
got := h.got;
END_FUNCTION_BLOCK
`,
  },
]
