/**
 * Variable-section conformance tests — VAR section kinds and modifiers
 * that the existing identifier/shadowing/lifecycle catalogs don't
 * already exercise.
 *
 * Source: 02-variables.md.
 *
 * Each entry uses ONE FB; the recorder pushes it + a PLC_PRG that
 * instantiates it (TC only analyzes reachable code).
 *
 * Same LanguageTest shape as pragmas — see pragma-tests.ts for field docs.
 */
import type { LanguageTest } from "./types.js";

export const VARIABLE_SECTION_TESTS: readonly LanguageTest[] = [
	// ─── VAR_INPUT / VAR_OUTPUT / VAR_IN_OUT ───────────────────────────

	{
		name: "var_input_output_inout_on_fb",
		pouName: "FB_LANG_var_io_kinds",
		kind: "function_block",
		feature: "FB with VAR_INPUT + VAR_OUTPUT + VAR_IN_OUT sections",
		fromDoc: "02-variables.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_io : FB_LANG_var_io_kinds;\nio_target : INT;",
		plcPrgBody: "fb_io(iIn := 5, iIO := io_target);",
		source:
`FUNCTION_BLOCK FB_LANG_var_io_kinds
VAR_INPUT
	iIn : INT;
END_VAR
VAR_OUTPUT
	iOut : INT;
END_VAR
VAR_IN_OUT
	iIO : INT;
END_VAR

iOut := iIn * 2;
iIO := iIO + iIn;
END_FUNCTION_BLOCK
`,
	},

	{
		name: "var_input_constant",
		pouName: "FB_LANG_var_input_constant",
		kind: "function_block",
		feature: "VAR_INPUT CONSTANT — read-only input parameter",
		fromDoc: "02-variables.md",
		expectTcAccepts: true,
		note: "VAR_INPUT CONSTANT marks a parameter that the FB body must not assign to.",
		plcPrgVar: "fb_vic : FB_LANG_var_input_constant;",
		plcPrgBody: "fb_vic(iLimit := 100);",
		source:
`FUNCTION_BLOCK FB_LANG_var_input_constant
VAR_INPUT CONSTANT
	iLimit : INT;
END_VAR
VAR
	iCount : INT;
END_VAR

iCount := iLimit;
END_FUNCTION_BLOCK
`,
	},

	// ─── VAR_INST ──────────────────────────────────────────────────────

	{
		name: "var_inst_in_method",
		pouName: "FB_LANG_var_inst_method",
		kind: "function_block",
		feature: "VAR_INST inside a METHOD — instance-persistent local",
		fromDoc: "02-variables.md",
		expectTcAccepts: true,
		note: "VAR_INST keeps the variable's value across method invocations on the same FB instance (per-instance, not per-call).",
		plcPrgVar: "fb_vi : FB_LANG_var_inst_method;",
		plcPrgBody: "fb_vi.Tick();",
		source:
`FUNCTION_BLOCK FB_LANG_var_inst_method
VAR
	iLast : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Tick
VAR_INST
	iCounter : INT;
END_VAR
iCounter := iCounter + 1;
iLast := iCounter;
END_METHOD
`,
	},

	// ─── VAR_STAT ──────────────────────────────────────────────────────

	{
		name: "var_stat_in_method",
		pouName: "FB_LANG_var_stat_method",
		kind: "function_block",
		feature: "VAR_STAT inside a METHOD — class-static local",
		fromDoc: "02-variables.md",
		expectTcAccepts: true,
		note: "VAR_STAT is shared across ALL instances of the FB (class-level static).",
		plcPrgVar: "fb_vs : FB_LANG_var_stat_method;",
		plcPrgBody: "fb_vs.Bump();",
		source:
`FUNCTION_BLOCK FB_LANG_var_stat_method
VAR
	iSeen : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Bump
VAR_STAT
	iGlobalCounter : INT;
END_VAR
iGlobalCounter := iGlobalCounter + 1;
iSeen := iGlobalCounter;
END_METHOD
`,
	},

	// ─── RETAIN / NON_RETAIN / PERSISTENT modifiers ────────────────────

	{
		name: "var_retain",
		pouName: "FB_LANG_var_retain",
		kind: "function_block",
		feature: "VAR RETAIN — variable kept across warm reboot",
		fromDoc: "02-variables.md",
		expectTcAccepts: true,
		plcPrgVar: "fb_ret : FB_LANG_var_retain;",
		plcPrgBody: "fb_ret.Tick();",
		source:
`FUNCTION_BLOCK FB_LANG_var_retain
VAR RETAIN
	iCount : DINT;
END_VAR

END_FUNCTION_BLOCK

METHOD Tick
iCount := iCount + 1;
END_METHOD
`,
	},

	{
		name: "var_persistent",
		pouName: "FB_LANG_var_persistent",
		kind: "function_block",
		feature: "VAR PERSISTENT — variable kept across cold reboot",
		fromDoc: "02-variables.md",
		expectTcAccepts: true,
		note: "PERSISTENT survives cold reboot AND program download. Stronger than RETAIN.",
		plcPrgVar: "fb_per : FB_LANG_var_persistent;",
		plcPrgBody: "fb_per.Tick();",
		source:
`FUNCTION_BLOCK FB_LANG_var_persistent
VAR PERSISTENT
	iCount : DINT;
END_VAR

END_FUNCTION_BLOCK

METHOD Tick
iCount := iCount + 1;
END_METHOD
`,
	},

	{
		name: "var_non_retain",
		pouName: "FB_LANG_var_non_retain",
		kind: "function_block",
		feature: "VAR NON_RETAIN — TC rejects bare `VAR NON_RETAIN` on a top-level VAR section",
		fromDoc: "02-variables.md",
		expectTcAccepts: false,
		recordIsolated: true,
		note: "DISCOVERY (verified live): TC errors with `Type definition expected instead of 'END_VAR'` on `VAR NON_RETAIN ... END_VAR`. NON_RETAIN is documented as a cascading-retain override (`Used in retain contexts`) — not a free-standing modifier like RETAIN or PERSISTENT. Only meaningful when the enclosing scope's retain attribute would otherwise propagate. LSP currently accepts it; gap worth noting but a niche feature.",
		plcPrgVar: "fb_nr : FB_LANG_var_non_retain;",
		plcPrgBody: "fb_nr.Tick();",
		source:
`FUNCTION_BLOCK FB_LANG_var_non_retain
VAR NON_RETAIN
	iCount : DINT;
END_VAR

END_FUNCTION_BLOCK

METHOD Tick
iCount := iCount + 1;
END_METHOD
`,
	},

	// ─── VAR_CONFIG (address-binding config block) ──────────────────────

	{
		name: "var_config_address_binding",
		pouName: "GVL_LANG_var_config",
		kind: "gvl",
		feature: "VAR_CONFIG — explicit address-binding block at GVL level",
		fromDoc: "02-variables.md",
		expectTcAccepts: true,
		recordIsolated: true,
		note: "VAR_CONFIG is the IEC-standard way to bind incomplete I/O addresses from a CONFIGURATION/RESOURCE shell down to instance variables. Requires bridge >= 4.9.3 (CodeHelper accepts VAR_CONFIG as gvl-shape header). Recorded TC behavior is the source of truth.",
		source:
`VAR_CONFIG
	PLC_PRG.iSensorReading AT %IW10 : INT;
END_VAR
`,
	},

// ─── VAR_OUTPUT on a FUNCTION (TC restriction) ─────────────────────

	// ─── VAR_EXTERNAL (paired with a GVL test) ──────────────────────────

	{
		name: "var_external_gvl",
		pouName: "GVL_LANG_var_external_target",
		kind: "gvl",
		feature: "GVL providing a global symbol that var_external_consumer imports — pair test",
		fromDoc: "02-variables.md",
		expectTcAccepts: true,
		note: "Pair test: this GVL declares `gShared`; `var_external_consumer` imports it via VAR_EXTERNAL. Both must be in the project for the consumer to compile.",
		source:
`VAR_GLOBAL
	gShared : INT := 100;
END_VAR
`,
	},

	{
		name: "var_external_consumer",
		pouName: "FB_LANG_var_external_consumer",
		kind: "function_block",
		feature: "VAR_EXTERNAL — IEC-style import of a global declared in a separate GVL",
		fromDoc: "02-variables.md",
		expectTcAccepts: true,
		note: "Depends on `var_external_gvl` being in the same project (TC batch recording satisfies this). VAR_EXTERNAL re-declares a global with matching type so the local POU can reference it.",
		plcPrgVar: "fb_ext : FB_LANG_var_external_consumer;",
		plcPrgBody: "fb_ext.Read();",
		source:
`FUNCTION_BLOCK FB_LANG_var_external_consumer
VAR_EXTERNAL
	gShared : INT;
END_VAR
VAR
	iLocal : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Read
iLocal := gShared;
END_METHOD
`,
	},

	{
		name: "var_output_on_function",
		pouName: "FB_LANG_function_var_output",
		kind: "function",
		feature: "VAR_OUTPUT on a FUNCTION — TC accepts (output through return + side outputs)",
		fromDoc: "02-variables.md",
		expectTcAccepts: true,
		note: "Functions can declare VAR_OUTPUT in addition to their return type — TC supports this even though pure IEC 61131-3 functions are stateless.",
		plcPrgVar: "iCarry : INT;\niSum : INT;",
		plcPrgBody: "iSum := FB_LANG_function_var_output(iA := 5, iB := 7, iCarryOut => iCarry);",
		source:
`FUNCTION FB_LANG_function_var_output : INT
VAR_INPUT
	iA : INT;
	iB : INT;
END_VAR
VAR_OUTPUT
	iCarryOut : INT;
END_VAR

FB_LANG_function_var_output := iA + iB;
iCarryOut := 0;
END_FUNCTION
`,
	},
];
