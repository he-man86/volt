/**
 * the fixtures of `pragma.ts` — part C: More attribute pragmas (batch 4); More attribute pragmas (batch 5); Region pragma — folding-only, no semantic effect; Negative: message pragma {error} should make TC fail build; Coverage extensions for the old check-pragmas, lines 167-174, 240-251.
 *
 * One slice of `pragma.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"

export const PRAGMA_TESTS_C: readonly LanguageTest[] = [
  // ─── More attribute pragmas (batch 4) ───────────────────────────

  {
    name: "conditionalshow_all_locals",
    pouName: "FB_LANG_conditionalshow_all_locals",
    kind: "function_block",
    feature: "{attribute 'conditionalshow_all_locals' := '<text>'} — FB-level locals hide",
    fromDoc: "07-pragmas.md#conditionalshow_all_locals",
    plcPrgVar: "fb_csal : FB_LANG_conditionalshow_all_locals;",
    plcPrgBody: "fb_csal();",
    source: `{attribute 'conditionalshow_all_locals' := 'maintainer_only'}
FUNCTION_BLOCK FB_LANG_conditionalshow_all_locals
VAR
	iA : INT;
	iB : INT;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "pin_presentation_order",
    pouName: "FB_LANG_pin_presentation_order",
    kind: "function_block",
    feature: "{attribute 'pin_presentation_order_inputs' := '...'} reorders FBD/LD pins",
    fromDoc: "07-pragmas.md#pin_presentation_order_inputs-pin_presentation_order_outputs",
    plcPrgVar: "fb_ppo : FB_LANG_pin_presentation_order;",
    plcPrgBody: "fb_ppo(iB := 1, iA := 2);",
    source: `{attribute 'pin_presentation_order_inputs' := 'iB,iA'}
FUNCTION_BLOCK FB_LANG_pin_presentation_order
VAR_INPUT
	iA : INT;
	iB : INT;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "estimated_stack_usage",
    pouName: "FB_LANG_estimated_stack_usage",
    kind: "function_block",
    feature: "{attribute 'estimated-stack-usage' := '<bytes>'} on a recursive method",
    fromDoc: "07-pragmas.md#estimated-stack-usage",
    plcPrgVar: "fb_esu : FB_LANG_estimated_stack_usage;",
    plcPrgBody: "fb_esu.Recurse(iN := 5);",
    source: `FUNCTION_BLOCK FB_LANG_estimated_stack_usage
VAR
	iResult : INT;
END_VAR

END_FUNCTION_BLOCK

{attribute 'estimated-stack-usage' := '128'}
METHOD Recurse
VAR_INPUT
	iN : INT;
END_VAR
iResult := iN;
END_METHOD
`,
  },
  {
    name: "no_virtual_actions",
    pouName: "FB_LANG_no_virtual_actions",
    kind: "function_block",
    feature: "{attribute 'no_virtual_actions'} prevents SFC action overrides in subclasses",
    fromDoc: "07-pragmas.md#no_virtual_actions",
    plcPrgVar: "fb_nva : FB_LANG_no_virtual_actions;",
    plcPrgBody: "fb_nva();",
    source: `{attribute 'no_virtual_actions'}
FUNCTION_BLOCK FB_LANG_no_virtual_actions
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "io_function_block",
    pouName: "FB_LANG_io_function_block",
    kind: "function_block",
    feature: "{attribute 'io_function_block'} marks FB as I/O-channel eligible",
    fromDoc: "07-pragmas.md#io_function_block-io_function_block_mapping",
    plcPrgVar: "fb_iofb : FB_LANG_io_function_block;",
    plcPrgBody: "fb_iofb();",
    source: `{attribute 'io_function_block'}
FUNCTION_BLOCK FB_LANG_io_function_block
VAR_INPUT
	{attribute 'io_function_block_mapping'}
	iChannel : INT;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "call_after_global_init_slot",
    pouName: "FB_LANG_call_after_global_init_slot",
    kind: "function_block",
    feature: "{attribute 'call_after_global_init_slot' := '<slot>'} on a method",
    fromDoc: "07-pragmas.md#call_after_global_init_slot",
    plcPrgVar: "fb_cagis : FB_LANG_call_after_global_init_slot;",
    plcPrgBody: "fb_cagis();",
    source: `FUNCTION_BLOCK FB_LANG_call_after_global_init_slot
VAR
	iCount : INT;
END_VAR

END_FUNCTION_BLOCK

{attribute 'call_after_global_init_slot' := '50000'}
METHOD AfterGlobalInit
iCount := 1;
END_METHOD
`,
  },
  {
    name: "warning_disable_restore",
    pouName: "FB_LANG_warning_disable_restore",
    kind: "function_block",
    feature: "{warning disable <id>} / {warning restore <id>} pair around a code block",
    fromDoc: "07-pragmas.md#warning-disable-warning-restore",
    plcPrgVar: "fb_wdr : FB_LANG_warning_disable_restore;",
    plcPrgBody: "fb_wdr();",
    source: `FUNCTION_BLOCK FB_LANG_warning_disable_restore
VAR
	iVar : INT;
END_VAR
{warning disable C0125}
iVar := iVar + 1;
{warning restore C0125}
END_FUNCTION_BLOCK
`,
  },
  // ─── More attribute pragmas (batch 5) ───────────────────────────

  {
    name: "call_after_online_change_slot",
    pouName: "FB_LANG_call_after_online_change_slot",
    kind: "function_block",
    feature: "{attribute 'call_after_online_change_slot' := '<slot>'} on a function",
    fromDoc: "07-pragmas.md#call_after_online_change_slot",
    plcPrgVar: "fb_caocs : FB_LANG_call_after_online_change_slot;",
    plcPrgBody: "fb_caocs();",
    source: `FUNCTION_BLOCK FB_LANG_call_after_online_change_slot
VAR
	iCount : INT;
END_VAR

END_FUNCTION_BLOCK

{attribute 'call_after_online_change_slot' := '50000'}
METHOD AfterOnlineChange
iCount := 1;
END_METHOD
`,
  },
  {
    name: "call_before_global_exit_slot",
    pouName: "FB_LANG_call_before_global_exit_slot",
    kind: "function_block",
    feature: "{attribute 'call_before_global_exit_slot' := '<slot>'} on a function",
    fromDoc: "07-pragmas.md#call_before_global_exit_slot",
    plcPrgVar: "fb_cbges : FB_LANG_call_before_global_exit_slot;",
    plcPrgBody: "fb_cbges();",
    source: `FUNCTION_BLOCK FB_LANG_call_before_global_exit_slot
VAR
	iCleanup : INT;
END_VAR

END_FUNCTION_BLOCK

{attribute 'call_before_global_exit_slot' := '50000'}
METHOD BeforeGlobalExit
iCleanup := 0;
END_METHOD
`,
  },
  {
    name: "call_on_type_change",
    pouName: "FB_LANG_call_on_type_change",
    kind: "function_block",
    feature: "{attribute 'call_on_type_change' := '<fb>'} on a method tracking referenced FB type",
    fromDoc: "07-pragmas.md#call_on_type_change",
    plcPrgVar: "fb_cotc : FB_LANG_call_on_type_change;",
    plcPrgBody: "fb_cotc();",
    source: `FUNCTION_BLOCK FB_LANG_call_on_type_change
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK

{attribute 'call_on_type_change' := 'FB_LANG_call_on_type_change'}
METHOD ReactToTypeChange : INT
iVar := 1;
ReactToTypeChange := iVar;
END_METHOD
`,
  },
  {
    name: "pin_presentation_order_outputs",
    pouName: "FB_LANG_pin_presentation_order_outputs",
    kind: "function_block",
    feature: "{attribute 'pin_presentation_order_outputs' := '...'} reorders FB output pins",
    fromDoc: "07-pragmas.md#pin_presentation_order_inputs-pin_presentation_order_outputs",
    plcPrgVar: "fb_ppoo : FB_LANG_pin_presentation_order_outputs;",
    plcPrgBody: "fb_ppoo();",
    source: `{attribute 'pin_presentation_order_outputs' := 'oResult,oStatus'}
FUNCTION_BLOCK FB_LANG_pin_presentation_order_outputs
VAR_OUTPUT
	oStatus : INT;
	oResult : INT;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "pin_presentation_order_wildcard",
    pouName: "FB_LANG_pin_presentation_order_wildcard",
    kind: "function_block",
    feature: "{attribute 'pin_presentation_order_inputs'} with `*` placeholder for unspecified",
    fromDoc: "07-pragmas.md#pin_presentation_order_inputs-pin_presentation_order_outputs",
    plcPrgVar: "fb_ppow : FB_LANG_pin_presentation_order_wildcard;",
    plcPrgBody: "fb_ppow();",
    source: `{attribute 'pin_presentation_order_inputs' := 'iLast,*'}
FUNCTION_BLOCK FB_LANG_pin_presentation_order_wildcard
VAR_INPUT
	iA : INT;
	iB : INT;
	iLast : INT;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  // REMOVED `implicit_parameter_pouname`: it tested `{attribute 'implicit-parameter' := 'pouname'}`,
  // but that attribute is NOT a real feature — both CODESYS and TwinCAT ignore it (CODESYS emits
  // `[warning] The attribute implicit-parameter is unknown and will be ignored`) and then reject the
  // no-arg call with `Function 'LogIt' requires exactly '1' inputs`. So it wasn't a pragma test at all,
  // just an un-modeled call-argument-count case under a misleading name. Reintroduce as a proper
  // `callArgumentMismatch` fixture if/when that check lands.

  // NOTE: `is_connected_with_reflection` and `monitoring_on_property`
  // removed for v1 — both hit edges in the bridge's StSplitter:
  // the first mixes VAR_INPUT + VAR in a child decl that splits
  // awkwardly; the second is a property with only GET (no SET),
  // which the splitter's accessor pairing logic assumes. Add when
  // the splitter is extended.

  // ─── Region pragma — folding-only, no semantic effect ─────────────

  {
    name: "region_basic",
    pouName: "FB_LANG_region_basic",
    kind: "function_block",
    feature: "{region 'name'} / {end_region} pair — source folding only",
    fromDoc: "07-pragmas.md#region-pragma",
    plcPrgVar: "fb_rb : FB_LANG_region_basic;",
    plcPrgBody: "fb_rb();",
    source: `FUNCTION_BLOCK FB_LANG_region_basic
VAR
	{region 'state'}
	iCounter : INT;
	iTotal : INT;
	{end_region}
END_VAR

END_FUNCTION_BLOCK
`,
  },
  // ─── Negative: message pragma {error} should make TC fail build ──

  {
    name: "error_message",
    pouName: "FB_LANG_error_message",
    kind: "function_block",
    feature: "{error 'msg'} pragma should cause TC to fail the build",
    fromDoc: "07-pragmas.md#message-pragmas",
    plcPrgVar: "fb_err : FB_LANG_error_message;",
    plcPrgBody: "fb_err();",
    note: "Per docs, {error 'msg'} is an explicit compile error. Verify TC emits error AND LSP recognises it.",
    source: `FUNCTION_BLOCK FB_LANG_error_message
VAR
	iVar : INT;
END_VAR
{error 'this is a deliberate test error'}
iVar := iVar + 1;
END_FUNCTION_BLOCK
`,
  },
  {
    name: "region_pragma_basic",
    pouName: "FB_LANG_region_pragma",
    kind: "function_block",
    feature: "{region 'name'} ... {end_region} — folding metadata (no semantic effect)",
    fromDoc: "07-pragmas.md#region-pragma",
    note: "Region pragmas are pure source-folding metadata; the code inside compiles normally.",
    plcPrgVar: "fb_reg : FB_LANG_region_pragma;",
    plcPrgBody: "fb_reg.Run();",
    source: `FUNCTION_BLOCK FB_LANG_region_pragma
VAR
	iCount : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Run
{region 'Initialization'}
iCount := 0;
{end_region}
{region 'Step'}
iCount := iCount + 1;
{end_region}
END_METHOD
`,
  },
  {
    name: "region_pragma_nested",
    pouName: "FB_LANG_region_nested",
    kind: "function_block",
    feature: "Nested {region}/{end_region} blocks — docs say nesting is supported",
    fromDoc: "07-pragmas.md#region-pragma",
    plcPrgVar: "fb_rn : FB_LANG_region_nested;",
    plcPrgBody: "fb_rn.Run();",
    source: `FUNCTION_BLOCK FB_LANG_region_nested
VAR
	iCount : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Run
{region 'Outer'}
iCount := 0;
{region 'Inner'}
iCount := iCount + 1;
{end_region}
iCount := iCount + 10;
{end_region}
END_METHOD
`,
  },
  // ─── Coverage extensions for the old check-pragmas, lines 167-174, 240-251 ─

  {
    name: "pragma_unknown_directive",
    pouName: "FB_LANG_pragma_unknown_directive",
    kind: "function_block",
    feature: "Unknown {DIRECTIVE} that no recognizer matches — exercises directive-not-found fallthrough",
    fromDoc: "07-pragmas.md",
    note: "TC silently ignores unrecognized {DIRECTIVE}-style pragmas; LSP's unknownPragma check is OFF by default but the recognizer still walks past, hitting the no-match branch.",
    plcPrgVar: "fb_pud : FB_LANG_pragma_unknown_directive;",
    plcPrgBody: "fb_pud();",
    source: `{TOTALLY_MADE_UP_DIRECTIVE foo}
FUNCTION_BLOCK FB_LANG_pragma_unknown_directive
VAR
	iVar : INT;
END_VAR

END_FUNCTION_BLOCK
`,
  },
  {
    name: "pragma_conflicting_pair",
    pouName: "FB_LANG_pragma_conflicting_pair",
    kind: "function_block",
    feature: "Two layout attribute pragmas on the same FB (`pin_presentation_order_inputs` + `pingroup`) — no conflict between them",
    fromDoc: "07-pragmas.md",
    note: "No conflict between the two: TwinCAT builds the pair clean, and CODESYS warns only that `pingroup` belongs on a variable declaration (\"can only be added to variable declarations\") — a placement rule, not a pair rule. The LSP has no conflict list and no pragma-conflict check. (This note used to cite a mutually-exclusive list and a `pragmaConflict` check; neither exists in src/.)",
    plcPrgVar: "fb_pcp : FB_LANG_pragma_conflicting_pair;",
    plcPrgBody: "fb_pcp();",
    source: `{attribute 'pin_presentation_order_inputs' := 'iA, iB'}
{attribute 'pingroup' := 'inputs'}
FUNCTION_BLOCK FB_LANG_pragma_conflicting_pair
VAR_INPUT
	iA : INT;
	iB : INT;
END_VAR

END_FUNCTION_BLOCK
`,
  },
]
