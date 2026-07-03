/**
 * FB lifecycle methods: FB_Init / FB_Reinit / FB_Exit.
 * Source: `docs/codesys-reference/11-fb-lifecycle.md`.
 *
 * Hover content for the three lifecycle method names. The
 * `fb-lifecycle-signature` diagnostic cross-references these entries
 * to validate signatures (return type BOOL, required VAR_INPUT params).
 */

import type { ReferenceEntry } from "./index.js";

const SOURCE = {
	url: "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_method_fb_init_fb_reinit.html",
	localFile: "docs/codesys-reference/11-fb-lifecycle.md",
	retrievedAt: "2026-05-26",
};

/**
 * Extended lifecycle entry — `ReferenceEntry` plus the required
 * parameter list. Diagnostics use this to validate `METHOD FB_Init`
 * signatures.
 */
export interface LifecycleEntry extends ReferenceEntry {
	/** Required VAR_INPUT parameter names, in order. */
	requiredParams: ReadonlyArray<{ name: string; type: string }>;
	/** Whether the method may have additional parameters beyond required. */
	allowsExtraParams: boolean;
}

const ENTRIES: LifecycleEntry[] = [
	{
		name: "FB_Init",
		kind: "lifecycle-method",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Implicit FB initialization method. Called before first use; before online-change copy; on factory-reset download.",
		details:
			"Always available implicitly. Declare explicitly to add behavior. Return type MUST be BOOL (return value is ignored by the runtime). Derived FBs must keep the base parameters in the same positions and may add their own.",
		gotchas: [
			"NEVER call SUPER^.FB_Init from your own FB_Init — implicit init has already run.",
			"NOT a constructor. Initialization order matters for derived FBs (base → derived).",
			"Adding extra VAR_INPUTs means callers must set them at instantiation.",
			"Breakpoints may not behave as expected.",
		],
		examples: [
			`METHOD PUBLIC FB_Init : BOOL
VAR_INPUT
    bInitRetains : BOOL;  // TRUE: retains are being initialized (reset warm/cold)
    bInCopyCode  : BOOL;  // TRUE: instance will be copied afterward (online change)
END_VAR`,
		],
		requiredParams: [
			{ name: "bInitRetains", type: "BOOL" },
			{ name: "bInCopyCode", type: "BOOL" },
		],
		allowsExtraParams: true,
	},
	{
		name: "FB_Reinit",
		kind: "lifecycle-method",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Re-initialization method. Called after online-change copy; callable from app code to reset an instance.",
		details:
			"Must be implemented explicitly to take effect. No parameters. Return type BOOL (ignored). Use to re-derive values after the copy operation has placed the instance at a new memory location.",
		examples: ["METHOD FB_Reinit : BOOL\n(* no parameters *)"],
		requiredParams: [],
		allowsExtraParams: false,
	},
	{
		name: "FB_Exit",
		kind: "lifecycle-method",
		source: SOURCE,
		vendor: "shared",
		oneLiner: "Pre-disposal method. Called before instance removal (online change, app exit, download).",
		details:
			"Must be implemented explicitly. Single mandatory parameter `bInCopyCode : BOOL`. Use to release external resources (sockets, file handles) or notify other code that pointers/refs will become stale.",
		gotchas: [
			"For derived FBs, FB_Exit runs in REVERSE order: derived first, then base.",
			"POINTER and REFERENCE TO variables may become stale during the upcoming copy.",
			"INTERFACE variables are auto-adapted by the compiler.",
			"{attribute 'no-exit'} on a specific instance suppresses the FB_Exit call for that one.",
		],
		examples: [
			`METHOD FB_Exit : BOOL
VAR_INPUT
    bInCopyCode : BOOL;  // TRUE: exit before online-change copy
END_VAR`,
		],
		requiredParams: [{ name: "bInCopyCode", type: "BOOL" }],
		allowsExtraParams: false,
	},
];

export const LIFECYCLE_METHODS = new Map<string, ReferenceEntry>(
	ENTRIES.map((e) => [e.name.toLowerCase(), e]),
);

/** Typed accessor used by the `fb-lifecycle-signature` diagnostic. */
export function getLifecycle(name: string): LifecycleEntry | undefined {
	return ENTRIES.find((e) => e.name.toLowerCase() === name.toLowerCase());
}

export const ALL_LIFECYCLE_METHODS: readonly LifecycleEntry[] = ENTRIES;
