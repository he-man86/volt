/**
 * FB lifecycle conformance test catalog — FB_Init / FB_Reinit / FB_Exit.
 *
 * Source: 11-fb-lifecycle.md. The LSP has a `fbLifecycleSignature`
 * diagnostic that's supposed to catch signature mistakes here; these
 * tests measure whether it actually does (and whether TC agrees).
 *
 * Per the doc's "Diagnostic candidates":
 *   - FB_Init / FB_Reinit / FB_Exit with wrong return type → error
 *   - FB_Init missing bInitRetains + bInCopyCode → error/warning
 *   - FB_Exit missing bInCopyCode → error
 *   - FB_Reinit with parameters → questionable (doc says "no parameters")
 *
 * Same LanguageTest shape as pragmas — see pragma-tests.ts for field docs.
 */
import type { LanguageTest } from "../types.js"

export const LIFECYCLE_TESTS: readonly LanguageTest[] = [
  // ========================================================================
  // Category: 11-fb-lifecycle.md — FB_Init / FB_Reinit / FB_Exit signatures
  // ========================================================================

  // ─── Positive: canonical signatures TC + LSP must accept ──────────

  {
    name: "fb_init_canonical",
    pouName: "FB_LANG_fb_init_canonical",
    kind: "function_block",
    feature: "FB_Init with canonical (bInitRetains, bInCopyCode) signature",
    fromDoc: "11-fb-lifecycle.md#fb_init",
    plcPrgVar: "fb_ic : FB_LANG_fb_init_canonical;",
    plcPrgBody: "fb_ic();",
    source: `FUNCTION_BLOCK FB_LANG_fb_init_canonical
VAR
	iCounter : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD FB_Init : BOOL
VAR_INPUT
	bInitRetains : BOOL;
	bInCopyCode : BOOL;
END_VAR
iCounter := 0;
END_METHOD
`,
  },

  // NOTE: An "fb_init_with_extra_param" test was attempted here but
  // removed for v1: it requires `fb : FB(iComNum := 1);` instantiation
  // syntax in PLC_PRG's VAR section, which the volt-lsp-iec parser
  // doesn't accept (the `(arg := val)` shortcut isn't in its grammar
  // yet). TC supports it. This is a real LSP parser gap worth
  // re-adding once the parser is extended.

  {
    name: "fb_reinit_canonical",
    pouName: "FB_LANG_fb_reinit_canonical",
    kind: "function_block",
    feature: "FB_Reinit with canonical (no-param) signature",
    fromDoc: "11-fb-lifecycle.md#fb_reinit",
    plcPrgVar: "fb_rc : FB_LANG_fb_reinit_canonical;",
    plcPrgBody: "fb_rc.FB_Reinit();",
    source: `FUNCTION_BLOCK FB_LANG_fb_reinit_canonical
VAR
	iCounter : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD FB_Reinit : BOOL
iCounter := 0;
END_METHOD
`,
  },

  {
    name: "fb_exit_canonical",
    pouName: "FB_LANG_fb_exit_canonical",
    kind: "function_block",
    feature: "FB_Exit with canonical (bInCopyCode) signature",
    fromDoc: "11-fb-lifecycle.md#fb_exit",
    plcPrgVar: "fb_ec : FB_LANG_fb_exit_canonical;",
    plcPrgBody: "fb_ec();",
    source: `FUNCTION_BLOCK FB_LANG_fb_exit_canonical
VAR
	iCleanup : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD FB_Exit : BOOL
VAR_INPUT
	bInCopyCode : BOOL;
END_VAR
iCleanup := 0;
END_METHOD
`,
  },

  // ─── Negative: wrong return type ──────────────────────────────────

  {
    name: "fb_init_wrong_return_type",
    pouName: "FB_LANG_fb_init_wrong_return_type",
    kind: "function_block",
    feature: "FB_Init declared with non-BOOL return — should error per docs",
    fromDoc: "11-fb-lifecycle.md#critical-rules",
    note: "Per docs: 'changing the return type is undefined behavior'. TC may accept it silently; LSP fbLifecycleSignature check is the value-add. Whether TC errors is itself a discovery.",
    plcPrgVar: "fb_iwrt : FB_LANG_fb_init_wrong_return_type;",
    plcPrgBody: "fb_iwrt();",
    source: `FUNCTION_BLOCK FB_LANG_fb_init_wrong_return_type
VAR
	iCounter : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD FB_Init : INT
VAR_INPUT
	bInitRetains : BOOL;
	bInCopyCode : BOOL;
END_VAR
iCounter := 0;
FB_Init := 1;
END_METHOD
`,
  },

  // ─── Negative: missing required params ───────────────────────────

  {
    name: "fb_init_missing_bInCopyCode",
    pouName: "FB_LANG_fb_init_missing_bInCopyCode",
    kind: "function_block",
    feature: "FB_Init missing the bInCopyCode parameter — TC ERRORS",
    fromDoc: "11-fb-lifecycle.md#fb_init",
    note: "DISCOVERY: TC errors with 'An FB_Init-Method of a functionblock needs two inputs bInitRetains and bInCopyCode of type BOOL'. The error was originally missed because the bridge BuildHandler regex required a (line) group — TC writes these structural errors without line numbers. Regex fixed.",
    plcPrgVar: "fb_imb : FB_LANG_fb_init_missing_bInCopyCode;",
    plcPrgBody: "fb_imb();",
    source: `FUNCTION_BLOCK FB_LANG_fb_init_missing_bInCopyCode
VAR
	iCounter : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD FB_Init : BOOL
VAR_INPUT
	bInitRetains : BOOL;
END_VAR
iCounter := 0;
END_METHOD
`,
  },

  {
    name: "fb_exit_missing_bInCopyCode",
    pouName: "FB_LANG_fb_exit_missing_bInCopyCode",
    kind: "function_block",
    feature: "FB_Exit missing the bInCopyCode parameter — TC ERRORS per docs",
    fromDoc: "11-fb-lifecycle.md#fb_exit",
    note: "DISCOVERY: TC errors with 'An FB_Exit-Method of a functionblock needs an input bInCopyCode of type BOOL'. Captured after the bridge regex fix (line-numberless structural errors).",
    plcPrgVar: "fb_emb : FB_LANG_fb_exit_missing_bInCopyCode;",
    plcPrgBody: "fb_emb();",
    source: `FUNCTION_BLOCK FB_LANG_fb_exit_missing_bInCopyCode
VAR
	iCleanup : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD FB_Exit : BOOL
VAR_INPUT
END_VAR
iCleanup := 0;
END_METHOD
`,
  },

  // ─── Edge case: FB_Reinit declared WITH params (docs say "no parameters") ──

  {
    name: "fb_reinit_with_params",
    pouName: "FB_LANG_fb_reinit_with_params",
    kind: "function_block",
    feature: "FB_Reinit declared with VAR_INPUT — docs say no params",
    fromDoc: "11-fb-lifecycle.md#fb_reinit",
    note: "Docs comment '(* no parameters *)' — but adding them may be silently accepted by TC. Disagreement is a discovery: should LSP flag this?",
    plcPrgVar: "fb_rwp : FB_LANG_fb_reinit_with_params;",
    plcPrgBody: "fb_rwp.FB_Reinit(iSeed := 1);",
    source: `FUNCTION_BLOCK FB_LANG_fb_reinit_with_params
VAR
	iCounter : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD FB_Reinit : BOOL
VAR_INPUT
	iSeed : INT;
END_VAR
iCounter := iSeed;
END_METHOD
`,
  },

  // ─── Running: what FB_Init does to an instance (the transpiler ignored it — an ordinary METHOD nothing calls) ───────
  // pro2193 hands its modules their identity through FB_Init (`inst : DrawerControlFB(instanceNo := 1, …)`). Asked:
  // does FB_Init run once per instance before the first cycle, with the declaration's argument and bInitRetains /
  // bInCopyCode at a cold start — and after the field's own initial value (3 → 35 if after, 5 if before)? First recorded
  // with the argument written as an initializer, `five : FB_LANG_init_args := (startValue := 5)`, which does not compile:
  // "No matching 'FB_Init' method found … Check syntax 'five : FB_LANG_init_args(INT)'" — it is written as a call.
  {
    name: "fb_init_runs_with_declared_arguments",
    pouName: "FB_LANG_init_args",
    kind: "function_block",
    feature: "FB_Init with an extra input, given by each instance's declaration initializer: its effect on the instance",
    fromDoc: "11-fb-lifecycle.md#fb_init",
    plcPrgVar: "five : FB_LANG_init_args(startValue := 5); nine : FB_LANG_init_args(startValue := 9);",
    plcPrgBody: "five();\nnine();",
    cycles: 2,
    source: `FUNCTION_BLOCK FB_LANG_init_args
VAR
	started : INT;
	retains : BOOL;
	copyCode : BOOL;
	initCalls : INT;
	bodyRuns : INT;
	seenInitial : INT := 3;
END_VAR
bodyRuns := bodyRuns + 1;
END_FUNCTION_BLOCK

METHOD FB_Init : BOOL
VAR_INPUT
	bInitRetains : BOOL;
	bInCopyCode : BOOL;
	startValue : INT;
END_VAR
started := startValue;
retains := bInitRetains;
copyCode := bInCopyCode;
initCalls := initCalls + 1;
seenInitial := seenInitial * 10 + startValue;
END_METHOD
`,
  },
  // A derived FB with its own FB_Init, the base with one too: does the base's run as well, and in which order (12: base
  // first, 21: derived first, 2: the base's does not run)?
  {
    name: "fb_init_base_and_derived",
    pouName: "FB_LANG_init_derived",
    kind: "function_block",
    feature: "FB_Init declared on a base FB and on the FB that EXTENDS it: which run, in which order",
    fromDoc: "11-fb-lifecycle.md#fb_init",
    plcPrgVar: "derived : FB_LANG_init_derived(startValue := 7);",
    plcPrgBody: "derived();",
    source: `FUNCTION_BLOCK FB_LANG_init_base
VAR
	baseStarted : INT;
	order : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD FB_Init : BOOL
VAR_INPUT
	bInitRetains : BOOL;
	bInCopyCode : BOOL;
	startValue : INT;
END_VAR
baseStarted := startValue;
order := order * 10 + 1;
END_METHOD

FUNCTION_BLOCK FB_LANG_init_derived EXTENDS FB_LANG_init_base
VAR
	derivedStarted : INT;
	seenBase : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD FB_Init : BOOL
VAR_INPUT
	bInitRetains : BOOL;
	bInCopyCode : BOOL;
	startValue : INT;
END_VAR
derivedStarted := startValue + 100;
seenBase := baseStarted;
order := order * 10 + 2;
END_METHOD
`,
  },
  // Asked by the review of the FB_Init batch — the transpiler chose each order without a recording. (1) An instance with
  // both FB_Init arguments and a structured initializer: does it compile, and which applies first? Initializer first:
  // seenBefore 9, started 95. FB_Init first (the CODESYS help's reading): seenBefore 0, started 9.
  {
    name: "fb_init_and_structured_initializer",
    pouName: "FB_LANG_init_struct",
    kind: "function_block",
    feature: "an instance declared with FB_Init arguments and a structured initializer of a field FB_Init also sets",
    fromDoc: "11-fb-lifecycle.md#fb_init",
    plcPrgVar: "both : FB_LANG_init_struct(startValue := 5) := (started := 9);",
    plcPrgBody: "both();",
    source: `FUNCTION_BLOCK FB_LANG_init_struct
VAR
	started : INT;
	seenBefore : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD FB_Init : BOOL
VAR_INPUT
	bInitRetains : BOOL;
	bInCopyCode : BOOL;
	startValue : INT;
END_VAR
seenBefore := started;
started := started * 10 + startValue;
END_METHOD
`,
  },
  // (2) A holder's call_after_global_init_slot method reading an instance inside it that runs FB_Init: 5 if every FB_Init
  // runs before the slot methods, 0 if the holder's method runs first.
  {
    name: "fb_init_before_slot_method_nested",
    pouName: "FB_LANG_init_holder",
    kind: "function_block",
    feature: "call_after_global_init_slot on an FB reading a field instance whose FB_Init sets it",
    fromDoc: "11-fb-lifecycle.md#fb_init",
    plcPrgVar: "holder : FB_LANG_init_holder;",
    plcPrgBody: "holder();",
    source: `FUNCTION_BLOCK FB_LANG_init_inner
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

FUNCTION_BLOCK FB_LANG_init_holder
VAR
	inner : FB_LANG_init_inner(startValue := 5);
	seen : INT;
END_VAR
END_FUNCTION_BLOCK

{attribute 'call_after_global_init_slot' := '50000'}
METHOD AfterGlobalInit
seen := inner.started;
END_METHOD
`,
  },
  // (3) Siblings: a reader's call_after_global_init_slot method reads a global that a LATER-declared writer's FB_Init sets —
  // 7 if every FB_Init runs before any slot method, 0 if they interleave in declaration order.
  {
    name: "fb_init_before_slot_method_sibling",
    pouName: "GVL_LANG_init_shared",
    kind: "gvl",
    feature: "call_after_global_init_slot of one instance reading a global the FB_Init of an instance declared after it sets",
    fromDoc: "11-fb-lifecycle.md#fb_init",
    plcPrgVar: "reader : FB_LANG_init_reader; writer : FB_LANG_init_writer(startValue := 7);",
    plcPrgBody: "reader();\nwriter();",
    source: `VAR_GLOBAL
	gLangInitShared : INT;
END_VAR

FUNCTION_BLOCK FB_LANG_init_reader
VAR
	seen : INT;
END_VAR
END_FUNCTION_BLOCK

{attribute 'call_after_global_init_slot' := '50000'}
METHOD AfterGlobalInit
seen := gLangInitShared;
END_METHOD

FUNCTION_BLOCK FB_LANG_init_writer
VAR
	mine : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD FB_Init : BOOL
VAR_INPUT
	bInitRetains : BOOL;
	bInCopyCode : BOOL;
	startValue : INT;
END_VAR
gLangInitShared := startValue;
mine := startValue;
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
]
