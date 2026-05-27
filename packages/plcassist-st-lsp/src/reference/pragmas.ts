/**
 * CODESYS pragmas. Source: `docs/codesys-reference/07-pragmas.md`.
 *
 * The single largest reference category and the highest-value one for
 * AI assistance — pragmas silently change behavior in ways the AI
 * cannot infer from syntax alone.
 *
 * Each entry captures:
 *   - Name (with aliases for variants like `noinit`/`no_init`/`no-init`)
 *   - Category (message / attribute / conditional / region / custom)
 *   - One-liner purpose
 *   - Insert location constraint
 *   - Key gotchas
 *   - Required companions (e.g. `instance-path` requires `reflection`)
 *   - Conflicts (e.g. `pingroup` vs `pin_presentation_order_*`)
 *
 * Used by:
 *   - Hover: describe the pragma at the cursor
 *   - `unknown-pragma` diagnostic: warn on names not in the catalog
 *   - `pragma-missing-companion` / `pragma-conflict` diagnostics:
 *     error on missing required attributes / mutually-exclusive pairs
 *   - Completion: snippet expansion inside `{attribute '...'}`
 */

import type { ReferenceEntry } from "./index.js";

const SOURCE = {
	url: "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_struct_reference_pragmas.html",
	localFile: "docs/codesys-reference/07-pragmas.md",
	retrievedAt: "2026-05-26",
};

export type PragmaCategory = "message" | "attribute" | "conditional" | "region";

export type PragmaInsertLocation =
	| "fb-top"
	| "method-top"
	| "pou-top"
	| "var-above"
	| "gvl-top"
	| "enum-top"
	| "struct-top"
	| "implementation-line"
	| "any";

/**
 * Extended pragma entry — `ReferenceEntry` plus pragma-specific metadata
 * useful for completion snippets and diagnostics.
 */
export interface PragmaEntry extends ReferenceEntry {
	category: PragmaCategory;
	/** Canonical syntax. Used as completion snippet template. */
	syntax: string;
	insertLocation: PragmaInsertLocation;
	/** Other pragma names this one requires to be present. */
	requires?: string[];
	/** Other pragma names that cannot coexist on the same target. */
	forbids?: string[];
}

function pr(entry: PragmaEntry): PragmaEntry {
	return entry;
}

const ENTRIES: PragmaEntry[] = [
	// ─── Message pragmas ────────────────────────────────────────────
	pr({
		name: "text",
		kind: "pragma",
		category: "message",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Untyped compile-time message printed in the Messages view.",
		syntax: "{text '${1:message}'}",
		insertLocation: "any",
	}),
	pr({
		name: "info",
		kind: "pragma",
		category: "message",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Compile-time message tagged as Message in the Messages view.",
		syntax: "{info '${1:message}'}",
		insertLocation: "any",
	}),
	pr({
		name: "warning",
		kind: "pragma",
		category: "message",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Local compile-time warning at this position. Emits C0373.",
		syntax: "{warning '${1:message}'}",
		insertLocation: "any",
		gotchas: ["For deprecation messages, prefer {attribute 'obsolete'} (centrally defined on the type)."],
	}),
	pr({
		name: "error",
		kind: "pragma",
		category: "message",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Local compile-time error at this position.",
		syntax: "{error '${1:message}'}",
		insertLocation: "any",
	}),

	// ─── Conditional / region ───────────────────────────────────────
	pr({
		name: "IF",
		kind: "pragma",
		category: "conditional",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Begin conditional-compilation block. Uses operators like `defined()`, `hasattribute()`, `hastype()`.",
		syntax: "{IF ${1:condition}}",
		insertLocation: "implementation-line",
		gotchas: [
			"Only allowed in implementation parts — NOT declarations (except with `project_defined` operator).",
			"Branches not selected are stripped at pre-compile time.",
		],
	}),
	pr({
		name: "ELSIF",
		kind: "pragma",
		category: "conditional",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Additional branch in a conditional-compilation block.",
		syntax: "{ELSIF ${1:condition}}",
		insertLocation: "implementation-line",
	}),
	pr({
		name: "ELSE",
		kind: "pragma",
		category: "conditional",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Default branch in a conditional-compilation block.",
		syntax: "{ELSE}",
		insertLocation: "implementation-line",
	}),
	pr({
		name: "END_IF",
		kind: "pragma",
		category: "conditional",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Close a conditional-compilation block.",
		syntax: "{END_IF}",
		insertLocation: "implementation-line",
	}),
	pr({
		name: "define",
		kind: "pragma",
		category: "conditional",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Define a compiler-define symbol. `{define <name>}` or `{define <name> '<value>'}`.",
		syntax: "{define ${1:NAME}}",
		insertLocation: "any",
	}),
	pr({
		name: "undefine",
		kind: "pragma",
		category: "conditional",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Remove a compiler-define symbol.",
		syntax: "{undefine ${1:NAME}}",
		insertLocation: "any",
	}),
	pr({
		name: "region",
		kind: "pragma",
		category: "region",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Begin a foldable source region. No semantic effect.",
		syntax: "{region '${1:name}'}",
		insertLocation: "any",
	}),
	pr({
		name: "end_region",
		kind: "pragma",
		category: "region",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Close a foldable source region.",
		syntax: "{end_region}",
		insertLocation: "any",
	}),

	// ─── Attribute pragmas ──────────────────────────────────────────
	// Lifecycle / initialization
	pr({
		name: "call_after_global_init_slot",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Function/program called after global initialization, ordered by slot number.",
		syntax: "{attribute 'call_after_global_init_slot' := '${1:slot}'}",
		insertLocation: "pou-top",
		requires: ["linkalways"],
		gotchas: [
			"VAR_INPUT declarations cause compile errors — inputs unknown at implicit call time.",
			"Only called if compiled+downloaded. Add {attribute 'linkalways'} to guarantee build inclusion.",
		],
	}),
	pr({
		name: "call_after_init",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Method called implicitly after FB_Init and after initial assignments.",
		syntax: "{attribute 'call_after_init'}",
		insertLocation: "method-top",
		gotchas: [
			"VAR_INPUT in the method causes compile errors.",
			"Available since compiler 3.4.1.0.",
			"Derived POUs MUST also use the attribute; override with same name + signature + attribute, call SUPER^.MyInit.",
			"Method name is free EXCEPT FB_Init / FB_Reinit / FB_Exit.",
			"Breakpoints may not behave as expected.",
		],
	}),
	pr({
		name: "call_after_online_change_slot",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Function/program called after each online change, ordered by slot.",
		syntax: "{attribute 'call_after_online_change_slot' := '${1:slot}'}",
		insertLocation: "pou-top",
		gotchas: ["Runs while app is paused — keep small to avoid jitter."],
	}),
	pr({
		name: "call_before_global_exit_slot",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Function/program called before GlobalExit (before download/reset).",
		syntax: "{attribute 'call_before_global_exit_slot' := '${1:slot}'}",
		insertLocation: "pou-top",
	}),
	pr({
		name: "call_on_type_change",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Method called when the type of a referenced FB changes (POINTER TO X or REFERENCE TO X).",
		syntax: "{attribute 'call_on_type_change' := '${1:FB_A, FB_B}'}",
		insertLocation: "method-top",
	}),
	pr({
		name: "global_init_slot",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Defines the initialization order of POUs and GVLs. Default: POU=50000, GVL=49990.",
		syntax: "{attribute 'global_init_slot' := '${1:50000}'}",
		insertLocation: "gvl-top",
		gotchas: [
			"Many slots are reserved by CODESYS subsystems (visu, IO mapping, etc.) — see corpus.",
			"Same value across multiple POUs gives undefined order between them.",
		],
	}),

	// Hide / show
	pr({
		name: "conditionalshow",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Hide library identifier from CODESYS UI (Library Manager, IntelliSense, monitoring).",
		syntax: "{attribute 'conditionalshow' := '${1:label}'}",
		insertLocation: "any",
	}),
	pr({
		name: "conditionalshow_all_locals",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Hide all local variables of an FB from the UI.",
		syntax: "{attribute 'conditionalshow_all_locals' := '${1:label}'}",
		insertLocation: "fb-top",
	}),
	pr({
		name: "hide",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Hide variable/POU from UI. Prefer `conditionalshow` for new code.",
		syntax: "{attribute 'hide'}",
		insertLocation: "any",
	}),
	pr({
		name: "hide_all_locals",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Hide all locals of an FB from UI (List Components, Monitoring, Symbol Config).",
		syntax: "{attribute 'hide_all_locals'}",
		insertLocation: "fb-top",
	}),

	// Constants
	pr({
		name: "const_replaced",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Force the constant to be inlined regardless of project's Replace Constants option.",
		syntax: "{attribute 'const_replaced'}",
		insertLocation: "var-above",
		gotchas: ["Only effective on scalar types — not arrays/structs."],
	}),
	pr({
		name: "const_non_replaced",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Keep the constant as a symbol (exportable in Symbol Config) regardless of project setting.",
		syntax: "{attribute 'const_non_replaced'}",
		insertLocation: "var-above",
	}),

	// I/O mapping / graphics
	pr({
		name: "dataflow",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "FBD/LD/IL: control which input/output connects to the next FB in the chain.",
		syntax: "{attribute 'dataflow'}",
		insertLocation: "var-above",
		gotchas: ["Only ONE input AND ONE output per FB may carry this attribute."],
	}),
	pr({
		name: "displaymode",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Per-variable monitoring display format. Values: 'bin'|'binary'|'dec'|'decimal'|'hex'|'hexadecimal'.",
		syntax: "{attribute 'displaymode' := '${1|bin,dec,hex|}'}",
		insertLocation: "var-above",
	}),
	pr({
		name: "ExpandFully",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Make array elements visible in visu Properties dialog.",
		syntax: "{attribute 'ExpandFully'}",
		insertLocation: "var-above",
	}),
	pr({
		name: "pingroup",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Group FB pins for collapsible display in FBD/LD editor.",
		syntax: "{attribute 'pingroup' := '${1:group_name}'}",
		insertLocation: "var-above",
		forbids: ["pin_presentation_order_inputs", "pin_presentation_order_outputs"],
	}),
	pr({
		name: "pin_presentation_order_inputs",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Force input pin display order. Use `*` for unspecified names.",
		syntax: "{attribute 'pin_presentation_order_inputs' := '${1:name1, name2}'}",
		insertLocation: "fb-top",
		forbids: ["pingroup"],
	}),
	pr({
		name: "pin_presentation_order_outputs",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Force output pin display order. Use `*` for unspecified names.",
		syntax: "{attribute 'pin_presentation_order_outputs' := '${1:name1, name2}'}",
		insertLocation: "fb-top",
		forbids: ["pingroup"],
	}),
	pr({
		name: "io_function_block",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Mark FB as eligible for I/O channel mapping.",
		syntax: "{attribute 'io_function_block'}",
		insertLocation: "fb-top",
	}),
	pr({
		name: "io_function_block_mapping",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Mark a parameter as the default channel-mapped one.",
		syntax: "{attribute 'io_function_block_mapping'}",
		insertLocation: "var-above",
	}),

	// Online change / persistence
	pr({
		name: "no_copy",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "During online change, re-initialize this variable instead of copying its value.",
		syntax: "{attribute 'no_copy'}",
		insertLocation: "var-above",
	}),
	pr({
		name: "noinit",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Variable is NOT implicitly initialized at startup/reset.",
		syntax: "{attribute 'noinit'}",
		insertLocation: "var-above",
		aliases: ["no_init", "no-init"],
	}),
	pr({
		name: "init_on_onlchange",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Variable is re-initialized on every online change.",
		syntax: "{attribute 'init_on_onlchange'}",
		insertLocation: "var-above",
		gotchas: ["Compiler ≥ 3.5.0.0: 'fast online change' skips init code. Set no_fast_online_change to force."],
	}),
	pr({
		name: "init_namespace",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "String variable in a library FB is initialized to the library's namespace.",
		syntax: "{attribute 'init_namespace'}",
		insertLocation: "var-above",
	}),
	pr({
		name: "initialize_on_call",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "FB inputs are re-initialized on every call. Useful for stale pointers post online-change.",
		syntax: "{attribute 'initialize_on_call'}",
		insertLocation: "fb-top",
	}),
	pr({
		name: "no-exit",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Suppress FB_Exit call for THIS specific instance.",
		syntax: "{attribute 'no-exit'}",
		insertLocation: "var-above",
	}),
	pr({
		name: "no_instance_in_retain",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Forbid this FB from being declared as a RETAIN variable.",
		syntax: "{attribute 'no_instance_in_retain'}",
		insertLocation: "fb-top",
	}),

	// Reflection / monitoring
	pr({
		name: "reflection",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Mark FB as reflective — required so the compiler scans for `instance-path` and `is_connected`.",
		syntax: "{attribute 'reflection'}",
		insertLocation: "fb-top",
	}),
	pr({
		name: "instance-path",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "String variable initialized to the POU's device-tree instance path.",
		syntax: "{attribute 'instance-path'}",
		insertLocation: "var-above",
		requires: ["reflection", "noinit"],
		gotchas: ["The variable must ALSO have {attribute 'noinit'}.", "Length can exceed 255 — use STRING(255) or larger."],
	}),
	pr({
		name: "is_connected",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "BOOL variable set to TRUE iff the named input has an external assignment.",
		syntax: "{attribute 'is_connected' := '${1:input_var_name}'}",
		insertLocation: "var-above",
		requires: ["reflection"],
	}),
	pr({
		name: "implicit-parameter",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Auto-populate a STRING/WSTRING input with context about the caller: 'pouname'|'position'|'instance-path'.",
		syntax: "{attribute 'implicit-parameter' := '${1|pouname,position,instance-path|}'}",
		insertLocation: "var-above",
		gotchas: ["Allowed in PROGRAM, FUNCTION, METHOD (incl. interface methods). Not inheritable."],
	}),
	pr({
		name: "monitoring",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Enable monitoring of a property: 'variable' (read-only) or 'call' (full call with side effects).",
		syntax: "{attribute 'monitoring' := '${1|variable,call|}'}",
		insertLocation: "any",
		gotchas: ["'call' invokes the getter/setter at every monitor tick — side effects fire."],
	}),
	pr({
		name: "monitoring_display",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Show a named member in the top line of monitoring for an FB/struct instance.",
		syntax: "{attribute 'monitoring_display' := '${1:member_name}'}",
		insertLocation: "any",
	}),
	pr({
		name: "monitoring_encoding",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Declare a STRING contains UTF-8 — monitoring decodes accordingly.",
		syntax: "{attribute 'monitoring_encoding' := 'UTF-8'}",
		insertLocation: "var-above",
	}),

	// Assignment / type / build
	pr({
		name: "no_assign",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Compile ERROR on instance-to-instance assignment of this FB.",
		syntax: "{attribute 'no_assign'}",
		insertLocation: "fb-top",
	}),
	pr({
		name: "no_assign_warning",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Compile WARNING on instance-to-instance assignment of this FB.",
		syntax: "{attribute 'no_assign_warning'}",
		insertLocation: "fb-top",
	}),
	pr({
		name: "no_check",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Suppress implicit-check function calls (array bounds, div-by-zero) for this POU.",
		syntax: "{attribute 'no_check'}",
		insertLocation: "pou-top",
		gotchas: ["Cascades to ALL child objects of the POU (e.g. actions)."],
	}),
	pr({
		name: "no_virtual_actions",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Prevent SFC actions of the base FB from being overridden by derived FBs.",
		syntax: "{attribute 'no_virtual_actions'}",
		insertLocation: "fb-top",
	}),
	pr({
		name: "obsolete",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Emit a centrally-defined warning whenever this data type is used.",
		syntax: "{attribute 'obsolete' := '${1:replacement message}'}",
		insertLocation: "any",
	}),
	pr({
		name: "pack_mode",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Memory packing for a struct/DUT: 0 (aligned) | 1 | 2 | 4 | 8 byte alignment.",
		syntax: "{attribute 'pack_mode' := '${1|0,1,2,4,8|}'}",
		insertLocation: "struct-top",
	}),
	pr({
		name: "qualified_only",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Force qualified access (`gvl.x`, `EnumName.MEMBER`) for a GVL or ENUM.",
		syntax: "{attribute 'qualified_only'}",
		insertLocation: "gvl-top",
	}),
	pr({
		name: "subsequent",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Allocate variables in a contiguous memory region.",
		syntax: "{attribute 'subsequent'}",
		insertLocation: "pou-top",
		gotchas: ["VAR_TEMP in a subsequent program → compile error.", "Any RETAIN variable → ALL variables land in retain memory."],
	}),
	pr({
		name: "linkalways",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Force the compiler to always include this POU/GVL in the build, even if unreferenced.",
		syntax: "{attribute 'linkalways'}",
		insertLocation: "pou-top",
	}),
	pr({
		name: "enable_dynamic_creation",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Required to use __NEW on a function block.",
		syntax: "{attribute 'enable_dynamic_creation'}",
		insertLocation: "fb-top",
	}),
	pr({
		name: "estimated-stack-usage",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Provide an estimated stack-size value (bytes) to satisfy stack check on recursive methods.",
		syntax: "{attribute 'estimated-stack-usage' := '${1:128}'}",
		insertLocation: "method-top",
	}),

	// Strings / enums
	pr({
		name: "to_string",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "TO_STRING on this ENUM returns the member name instead of the numeric value.",
		syntax: "{attribute 'to_string'}",
		insertLocation: "enum-top",
	}),
	pr({
		name: "ProcessValue",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "CFC editor: mark a struct member as the 'process value' for scalar-input connection.",
		syntax: "{attribute 'ProcessValue'}",
		insertLocation: "var-above",
	}),

	// Warnings
	pr({
		name: "suppress_warning",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Suppress specific compiler warnings by ID, comma-separated.",
		syntax: "{attribute 'suppress_warning' := '${1:0125}'}",
		insertLocation: "pou-top",
	}),
	pr({
		name: "warning disable",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Suppress a specific compiler warning ID locally. Pair with `warning restore`.",
		syntax: "{warning disable ${1:C0195}}",
		insertLocation: "any",
	}),
	pr({
		name: "warning restore",
		kind: "pragma",
		category: "attribute",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Re-enable a previously-disabled compiler warning.",
		syntax: "{warning restore ${1:C0195}}",
		insertLocation: "any",
	}),

	// ─── TwinCAT-specific pragmas ───────────────────────────────────
	// Source: Beckhoff InfoSys https://infosys.beckhoff.com/content/1033/tc3_plc_intro/2529567115.html
	// Retrieved 2026-05-26.
	...twincatPragmas(),
];

function twincatPragmas(): PragmaEntry[] {
	const TC_SOURCE = {
		url: "https://infosys.beckhoff.com/content/1033/tc3_plc_intro/2529567115.html",
		localFile: "docs/twincat-reference/01-pragmas-twincat.md",
		retrievedAt: "2026-05-26",
	};

	function tc(opts: {
		name: string;
		oneLiner: string;
		syntax: string;
		insertLocation: PragmaInsertLocation;
		equivalentIn?: PragmaEntry["equivalentIn"];
		gotchas?: string[];
		aliases?: string[];
	}): PragmaEntry {
		return {
			name: opts.name,
			kind: "pragma",
			category: "attribute",
			source: TC_SOURCE,
			vendor: "twincat",
			oneLiner: opts.oneLiner,
			syntax: opts.syntax,
			insertLocation: opts.insertLocation,
			...(opts.equivalentIn !== undefined ? { equivalentIn: opts.equivalentIn } : {}),
			...(opts.gotchas !== undefined ? { gotchas: opts.gotchas } : {}),
			...(opts.aliases !== undefined ? { aliases: opts.aliases } : {}),
		};
	}

	return [
		tc({
			name: "TcCallAfterOutputUpdate",
			oneLiner: "Method runs after the task's output update phase, before next input read.",
			syntax: "{attribute 'TcCallAfterOutputUpdate'}",
			insertLocation: "method-top",
		}),
		tc({
			name: "TcContextId",
			oneLiner: "Numeric task-context selector for VAR_GLOBALs shared across tasks.",
			syntax: "{attribute 'TcContextId' := '${1:1}'}",
			insertLocation: "var-above",
		}),
		tc({
			name: "TcContextName",
			oneLiner: "Named task-context selector — defines which task updates an allocated variable.",
			syntax: "{attribute 'TcContextName' := '${1:PlcTask}'}",
			insertLocation: "var-above",
		}),
		tc({
			name: "TcDisplayScale",
			oneLiner: "Display scaling for engineering units in monitoring.",
			syntax: "{attribute 'TcDisplayScale' := '${1:1.0}'}",
			insertLocation: "var-above",
		}),
		tc({
			name: "TcEncoding",
			oneLiner: "Specify character encoding (e.g. 'UTF-8') for STRING variables.",
			syntax: "{attribute 'TcEncoding' := '${1:UTF-8}'}",
			insertLocation: "var-above",
		}),
		tc({
			name: "TcGlobalDataType",
			oneLiner: "Mark a DUT as a globally-shared data type for OPC UA / ADS exposure.",
			syntax: "{attribute 'TcGlobalDataType'}",
			insertLocation: "struct-top",
		}),
		tc({
			name: "TcHideSubItems",
			oneLiner: "Hide nested struct members from the Visual Studio object browser.",
			syntax: "{attribute 'TcHideSubItems'}",
			insertLocation: "struct-top",
			equivalentIn: {
				codesys: { name: "hide_all_locals", note: "partial — codesys hide is broader" },
			},
		}),
		tc({
			name: "TcIgnorePersistent",
			oneLiner: "Exclude this variable from persistent-data file generation.",
			syntax: "{attribute 'TcIgnorePersistent'}",
			insertLocation: "var-above",
		}),
		tc({
			name: "TcInitOnReset",
			oneLiner: "Re-initialize this variable on PLC reset (vs. retain).",
			syntax: "{attribute 'TcInitOnReset'}",
			insertLocation: "var-above",
		}),
		tc({
			name: "TcInitSymbol",
			oneLiner: "Specify the symbol used to initialize this variable from configuration.",
			syntax: "{attribute 'TcInitSymbol' := '${1:initSymbol}'}",
			insertLocation: "var-above",
		}),
		tc({
			name: "TcLinkTo",
			oneLiner: "Auto-link a variable to a hardware input/output by symbolic path.",
			syntax: "{attribute 'TcLinkTo' := '${1:TIID^Device^Input}'}",
			insertLocation: "var-above",
			aliases: ["TcLinkToOSO"],
		}),
		tc({
			name: "TcLinkToOSO",
			oneLiner: "Variant of TcLinkTo for one-side-only linking.",
			syntax: "{attribute 'TcLinkToOSO' := '${1:TIID^Device^Input}'}",
			insertLocation: "var-above",
		}),
		tc({
			name: "TcNcAxis",
			oneLiner: "Bind to an NC motion axis index (use with AXIS_REF).",
			syntax: "{attribute 'TcNcAxis' := '${1:0}'}",
			insertLocation: "var-above",
		}),
		tc({
			name: "TcNoSymbol",
			oneLiner: "Exclude from ADS / OPC UA symbol generation. The variable is invisible to external clients.",
			syntax: "{attribute 'TcNoSymbol'}",
			insertLocation: "var-above",
			equivalentIn: {
				codesys: { name: "hide", note: "partial — codesys hide affects UI, TcNoSymbol affects symbol exports" },
			},
			aliases: ["tc_no_symbol"],
		}),
		tc({
			name: "TcPersistent",
			oneLiner: "Mark as persistent without changing memory area (alternative to PERSISTENT modifier).",
			syntax: "{attribute 'TcPersistent'}",
			insertLocation: "var-above",
			equivalentIn: {
				codesys: { name: "PERSISTENT", note: "modifier rather than attribute" },
			},
		}),
		tc({
			name: "TcRetain",
			oneLiner: "Mark as retain without changing memory area (alternative to RETAIN modifier).",
			syntax: "{attribute 'TcRetain'}",
			insertLocation: "var-above",
			equivalentIn: {
				codesys: { name: "RETAIN", note: "modifier rather than attribute" },
			},
		}),
		tc({
			name: "TcRpcEnable",
			oneLiner: "Activate a method for ADS Remote Procedure Call. Required to expose as OPC UA method.",
			syntax: "{attribute 'TcRpcEnable'}",
			insertLocation: "method-top",
		}),
		tc({
			name: "TcSwapDWord",
			oneLiner: "Byte-swap 32-bit words on read/write (endianness conversion for fieldbus interop).",
			syntax: "{attribute 'TcSwapDWord'}",
			insertLocation: "var-above",
		}),
		tc({
			name: "TcSwapWord",
			oneLiner: "Byte-swap 16-bit words on read/write.",
			syntax: "{attribute 'TcSwapWord'}",
			insertLocation: "var-above",
		}),
		tc({
			name: "Tc2GvlVarNames",
			oneLiner: "Compatibility: keep TwinCAT 2-style global variable naming.",
			syntax: "{attribute 'Tc2GvlVarNames'}",
			insertLocation: "gvl-top",
		}),
	];
}

export const PRAGMAS = new Map<string, ReferenceEntry>(
	ENTRIES.map((e) => [e.name.toLowerCase(), e]),
);

// Alias spellings for `noinit`/`no_init`/`no-init` etc.
for (const e of ENTRIES) {
	if (e.aliases !== undefined) {
		for (const alias of e.aliases) {
			PRAGMAS.set(alias.toLowerCase(), e);
		}
	}
}

/** Typed accessor for diagnostics/completion that need pragma-specific fields. */
export function getPragma(name: string): PragmaEntry | undefined {
	return ENTRIES.find(
		(e) =>
			e.name.toLowerCase() === name.toLowerCase() ||
			(e.aliases?.some((a) => a.toLowerCase() === name.toLowerCase()) ?? false),
	);
}

/** All pragmas, for completion seeding. */
export const ALL_PRAGMAS: readonly PragmaEntry[] = ENTRIES;
