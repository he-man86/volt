/**
 * Server configuration, passed in via LSP `initializationOptions`. The client (VS Code, opencode, any
 * MCP-aware tool) sends a typed blob at `initialize`; the workspace stores the resolved form and each
 * check / query reads it. Independent of `vscode-languageserver-protocol` types — the shape is ours.
 */

/**
 * Per-check enable flags — each maps 1:1 to a check in `../../semantic/diagnostics.ts`, where the full
 * scope and rationale live. Defaults are in `DEFAULT_DIAGNOSTIC_CONFIG` below.
 */
export interface DiagnosticConfig {
	// ── Identifiers ──
	/** Identifier collides with a reserved keyword. */
	reservedKeyword: boolean;
	/** Identifier starts with `__` (reserved for system-generated names). */
	doubleUnderscore: boolean;
	/** Repeated underscores in an identifier (`foo__bar`). */
	consecutiveUnderscores: boolean;
	/** Same name declared twice in one scope. */
	duplicateDeclaration: boolean;
	/** A body identifier that resolves nowhere. */
	unresolvedIdentifier: boolean;

	// ── Pragmas ──
	/** Pragma name in neither vendor's catalog. */
	unknownPragma: boolean;
	/** Pragma valid only for the other vendor. */
	wrongVendorPragma: boolean;
	/** A pragma missing its required companion (e.g. instance-path without reflection). */
	pragmaMissingCompanion: boolean;
	/** Two mutually-exclusive pragmas on the same target. */
	pragmaConflict: boolean;
	/** Surface `{error}`/`{warning}`/`{info}`/`{text}` message pragmas as diagnostics. */
	messagePragmas: boolean;
	/** `{ELSE}`/`{ELSIF}`/`{END_IF}` without a matching `{IF}` (structural balance only). */
	orphanConditionalPragma: boolean;
	/** `{attribute 'global_init_slot'}` collides with a reserved slot. */
	initSlotCollision: boolean;

	// ── Declarations & OOP ──
	/** FB_Init/FB_Reinit/FB_Exit missing a required VAR_INPUT parameter. */
	fbLifecycleSignature: boolean;
	/** A declaration shadows a same-name symbol in an outer scope. (info) */
	shadowingDeclaration: boolean;
	/** `IMPLEMENTS <Iface>` but a required method/property is missing. */
	missingInterfaceImplementation: boolean;
	/** An implemented interface member has an incompatible signature. */
	missingInterfaceSignature: boolean;
	/** Instantiating an ABSTRACT function block. */
	abstractInstantiation: boolean;
	/** A VAR-section kind not allowed in the containing POU kind (e.g. VAR_TEMP in a METHOD). */
	varSectionPlacement: boolean;
	/** External write to a non-VAR_INPUT/OUTPUT member of an FB instance (`fb.internalVar := x`). */
	externalNonInputWrite: boolean;

	// ── Type-aware (expression inference) ──
	/** `X_TO_Y(arg)` where arg's type isn't compatible with `X`. */
	conversionSourceMismatch: boolean;
	/** `a := b` where b's type isn't assignable to a. */
	assignmentTypeMismatch: boolean;
	/** A binary operator on incompatible operands (e.g. MOD on REAL, BOOL + numeric). */
	binaryOperatorTypeMismatch: boolean;
	/** A call whose arguments don't match the callee's parameters (name / count / type). */
	callArgumentMismatch: boolean;
	/** Implicit narrowing the compiler warns on — currently LREAL→REAL. (warning) */
	narrowingConversion: boolean;
	/** `x^` where x isn't a pointer type. */
	derefOnNonPointer: boolean;

	// ── Vendor-specific ──
	/** A CODESYS-only `__` system operator used under TwinCAT (`__NEW`, `__CURRENTTASK`, …). */
	vendorOnlyOperator: boolean;

	// ── VG (graphical FBD/LD) ──
	/** VG structural well-formedness — the bridge's `VG_*` push gate, surfaced in the editor. */
	vgStructure: boolean;
	/** A VG operand references a name not declared in the POU. */
	vgUndeclaredIdentifier: boolean;
	/** A VG `JMP` targets a label not defined in its network. */
	vgUndefinedLabel: boolean;
	/** A VG call passes a pin name the FB type doesn't declare. */
	vgUnknownPin: boolean;
	/** VG body not in canonical form (formatting-level; the bridge is the authority). */
	vgNotCanonical: boolean;
}

/**
 * Defaults mirror the compiler: a check is ON only if the compiler itself rejects (or warns on) the code.
 * The five stricter-than-compiler lints are OFF — they fire on code the compiler accepts, so they're opt-in.
 * The conformance replay (`../../tests/conformance/language.test.ts`) validates this contract.
 */
export const DEFAULT_DIAGNOSTIC_CONFIG: DiagnosticConfig = {
	reservedKeyword: true,
	doubleUnderscore: true,
	consecutiveUnderscores: true,
	duplicateDeclaration: true,
	unresolvedIdentifier: true,
	unknownPragma: false, // opt-in: the compiler silently ignores unknown attributes (forward-compat)
	wrongVendorPragma: false, // opt-in: only relevant when porting between vendors
	pragmaMissingCompanion: true,
	pragmaConflict: true,
	messagePragmas: true,
	orphanConditionalPragma: true,
	initSlotCollision: false, // opt-in: only conflicts if the claiming library is actually loaded
	fbLifecycleSignature: true,
	shadowingDeclaration: false, // opt-in: the compiler allows shadowing
	missingInterfaceImplementation: true,
	missingInterfaceSignature: true,
	abstractInstantiation: true,
	varSectionPlacement: true,
	externalNonInputWrite: true,
	conversionSourceMismatch: true,
	assignmentTypeMismatch: true,
	binaryOperatorTypeMismatch: true,
	callArgumentMismatch: true,
	narrowingConversion: true,
	derefOnNonPointer: true,
	vendorOnlyOperator: true,
	vgStructure: true,
	vgUndeclaredIdentifier: true,
	vgUndefinedLabel: true,
	vgUnknownPin: true,
	vgNotCanonical: false, // opt-in: the bridge is the canonical authority; the formatter handles it
};

/**
 * The active PLC dialect. `Vendor` is the RESOLVED value; `VendorSetting` additionally allows `"auto"`,
 * which the client resolves (`detect-vendor.ts`) before it reaches `resolveConfig` — which falls back to
 * `"codesys"` if it still sees `"auto"`.
 */
export type Vendor = "codesys" | "twincat";
export type VendorSetting = Vendor | "auto";

export interface PlcLspInitOptions {
	/** Active vendor (default "auto"). */
	vendor?: VendorSetting;
	diagnostics?: Partial<DiagnosticConfig>;
	/** Append the documentation source URL to hover content. Default: true. */
	hover?: { showSource?: boolean };
	/** Honor LSP snippet syntax in completion items. Default: true. */
	completion?: { snippetSupport?: boolean };
}

export interface ResolvedConfig {
	/** Resolved vendor — never "auto". */
	vendor: Vendor;
	diagnostics: DiagnosticConfig;
	hover: { showSource: boolean };
	completion: { snippetSupport: boolean };
}

export const DEFAULT_RESOLVED_CONFIG: ResolvedConfig = {
	vendor: "codesys",
	diagnostics: DEFAULT_DIAGNOSTIC_CONFIG,
	hover: { showSource: true },
	completion: { snippetSupport: true },
};

/**
 * Per-rule vendor applicability. A rule listed here runs ONLY on the vendors named; a rule ABSENT from the
 * map runs on both. Nearly every check applies to both — CODESYS and TwinCAT are the same IEC 61131-3
 * language. Add an entry ONLY with recorded conformance evidence that one vendor accepts code the other
 * rejects, or for a rule vendor-specific by construction. See `diagnostics-conformance.md`.
 */
const RULE_VENDOR_APPLICABILITY: Partial<Record<keyof DiagnosticConfig, readonly Vendor[]>> = {
	// CODESYS-only `__` operators used under TwinCAT — by definition it must never fire on a CODESYS
	// workspace, where those operators are legal.
	vendorOnlyOperator: ["twincat"],
};

/**
 * Merge init-options over the defaults, resolve the vendor, and mask off checks that don't apply to it
 * (`RULE_VENDOR_APPLICABILITY` — e.g. `vendorOnlyOperator` never fires on CODESYS). Runs ONCE at init, so
 * the dispatcher then sees a fully pre-filtered config with no per-token vendor branching.
 */
export function resolveConfig(opts: PlcLspInitOptions | undefined): ResolvedConfig {
	const requested = opts?.vendor;
	const vendor: Vendor = requested === "codesys" || requested === "twincat" ? requested : "codesys";
	const diagnostics: DiagnosticConfig = { ...DEFAULT_DIAGNOSTIC_CONFIG, ...opts?.diagnostics };
	for (const [key, vendors] of Object.entries(RULE_VENDOR_APPLICABILITY)) {
		if (vendors && !vendors.includes(vendor)) diagnostics[key as keyof DiagnosticConfig] = false;
	}
	return {
		vendor,
		diagnostics,
		hover: { showSource: opts?.hover?.showSource ?? true },
		completion: { snippetSupport: opts?.completion?.snippetSupport ?? true },
	};
}
