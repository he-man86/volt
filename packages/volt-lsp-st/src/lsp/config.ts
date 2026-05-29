/**
 * Server configuration plumbed in via LSP `initializationOptions`.
 *
 * The client (VS Code extension, opencode, any MCP-aware tool) can pass
 * a typed options blob at `initialize` time. We store it on the workspace
 * and read it from each query/diagnostic check.
 *
 * Keep this independent of `vscode-languageserver-protocol` types — the
 * shape is ours, not LSP-defined.
 */

/**
 * Per-diagnostic enable flags. Defaults are all-on; clients disable
 * checks selectively to mute noise.
 *
 * Each flag maps 1:1 to a check in `src/semantic/diagnostics.ts`.
 */
export interface DiagnosticConfig {
	/** Identifier matches a CODESYS reserved keyword. Error. */
	reservedKeyword: boolean;
	/** Identifier starts with `__` (reserved for system-generated names). Error. */
	doubleUnderscore: boolean;
	/** Multiple consecutive underscores anywhere in an identifier. Error. */
	consecutiveUnderscores: boolean;
	/** Two declarations with the same name in the same scope. Error. */
	duplicateDeclaration: boolean;
	/** Identifier in a body that doesn't resolve. Warning (library-blind). */
	unresolvedIdentifier: boolean;
	/**
	 * Pragma name not in either vendor's catalog. Warning. **OFF by default** —
	 * TC silently ignores unknown attributes (forward-compat for library-
	 * provided pragmas); enable for stricter typo-catching.
	 */
	unknownPragma: boolean;
	/**
	 * Pragma known but belongs to the OTHER vendor (not the active one). Warning.
	 * **OFF by default** — same rationale as `unknownPragma`. Useful when
	 * porting between CODESYS and TwinCAT projects.
	 */
	wrongVendorPragma: boolean;
	/** A pragma missing its required companion (e.g. instance-path without reflection). Error. */
	pragmaMissingCompanion: boolean;
	/** Two mutually-exclusive pragmas on the same target. Warning. */
	pragmaConflict: boolean;
	/**
	 * FB_Init/FB_Reinit/FB_Exit with missing required VAR_INPUT
	 * params. Error. Mirrors TC's enforcement of the minimum
	 * lifecycle contract — TC permits return-type deviations and
	 * extra params, so the LSP does too (verified via conformance).
	 */
	fbLifecycleSignature: boolean;
	/**
	 * A declaration shadows a same-name symbol in an outer scope. Information.
	 * **OFF by default** — TC silently allows shadowing; enable for style-
	 * conscious code-review setups.
	 */
	shadowingDeclaration: boolean;
	/**
	 * {attribute 'global_init_slot' := 'N'} collides with a CODESYS-reserved slot. Warning.
	 * **OFF by default** — TC accepts user-picked slots even when CODESYS
	 * libraries claim them (would only conflict if those libraries are loaded);
	 * enable when you know your library set.
	 */
	initSlotCollision: boolean;
	/** `<X>_TO_<Y>(arg)` where arg's declared type isn't compatible with `<X>`. Warning. */
	conversionSourceMismatch: boolean;
	/**
	 * Surface message pragmas — `{text}` / `{info}` / `{warning}` /
	 * `{error}` — as LSP diagnostics with the corresponding severity.
	 * These pragmas are explicit author-emitted markers (compile-time
	 * message channel); mirroring them in the LSP gives the same
	 * red/yellow squiggle the IDE compiler shows. Off-by-default
	 * would be silly (the user wrote them on purpose), so default ON.
	 */
	messagePragmas: boolean;
	/**
	 * Flag orphan conditional-compile pragmas — `{ELSE}` / `{ELSIF}` /
	 * `{END_IF}` that appear without a matching `{IF}` earlier in the
	 * source. TC raises "Unexpected Pragma: 'ELSE' found without
	 * matching 'if'" for the same case. Doesn't model the full
	 * preprocessor (no compile-time define evaluation, no branch
	 * stripping) — just the structural balance.
	 */
	orphanConditionalPragma: boolean;
	/**
	 * Flag simple assignments `<id> := <single-id-or-typed-literal>;`
	 * where the right-hand side's type isn't assignable to the left
	 * (BOOL ↔ numeric, narrowing DINT→INT, STRING→numeric, etc.).
	 * Mirrors TC's `Cannot convert type X to type Y` error.
	 *
	 * Deliberately MINIMAL: only catches the simplest assignment
	 * shape (single identifier or typed literal on RHS). Binary
	 * expressions, conversion calls, member access are skipped to
	 * avoid false positives — we'd need full expression type-
	 * inference to handle them, which is well outside this LSP's
	 * navigation-grade scope.
	 */
	assignmentTypeMismatch: boolean;
	/**
	 * Flag function blocks that declare `IMPLEMENTS <Iface>` but
	 * don't provide every method/property the interface requires.
	 * Mirrors TC's error on missing interface members.
	 */
	missingInterfaceImplementation: boolean;
	/**
	 * Flag simple binary expressions `<id> <op> <id>` (inside an
	 * assignment) where the operator doesn't accept those operand
	 * types. Covers `MOD` on non-integer types and arithmetic
	 * mixing BOOL with numeric. Mirrors TC's
	 * `'MOD' is not defined for 'REAL'` and
	 * `Cannot convert type 'BOOL' to type 'INT'` errors.
	 *
	 * Same minimalism as assignmentTypeMismatch — only the
	 * `lhs := id op id ;` shape; anything more complex is skipped.
	 */
	binaryOperatorTypeMismatch: boolean;
	/**
	 * Flag VAR-section kinds that aren't allowed for the containing
	 * POU kind. Currently: VAR_TEMP only inside PROGRAM / FUNCTION /
	 * FUNCTION_BLOCK (NOT METHOD / ACTION / INTERFACE) and
	 * VAR_GLOBAL only inside a GVL. Mirrors TC's
	 * `VAR_TEMP declaration not allowed in this place` error.
	 */
	varSectionPlacement: boolean;
	/**
	 * Flag pointer-dereference applied to a non-pointer variable:
	 * `<id>^` where `id` is declared as a non-pointer simple type.
	 * Mirrors TC's `'^' is not defined for ...` error.
	 *
	 * Conservative: only the simple `<id>^` shape is checked. Complex
	 * shapes like `(expr)^`, `arr[i]^`, `obj.field^` are skipped to
	 * avoid false positives without expression typing.
	 */
	derefOnNonPointer: boolean;
	/**
	 * When the active vendor is TwinCAT, error on CODESYS-only system
	 * operators (`__VARINFO`, `__NEW`, `__DELETE`, `__QUERYINTERFACE`,
	 * `__CURRENTTASK`, `__TRY`/`__CATCH`/`__FINALLY`/`__ENDTRY`, etc.)
	 * — verified live: TC rejects all of these. Mirrors TC's parse-error
	 * behavior. `__ISVALIDREF` is TC-compatible and stays silent.
	 */
	vendorOnlyOperator: boolean;
}

/**
 * Default config mirrors TC's enforcement: every check that's ON here
 * fires only on code TC itself rejects. Stricter-than-TC lints
 * (unknown-pragma typos, vendor-mismatch attributes, shadowing
 * declarations, init-slot collisions) default OFF — they're available
 * as opt-in via init options for stricter setups, but the baseline
 * is "if TC compiles it, LSP doesn't complain". Conformance harness
 * (`src/conformance/`, replayed by `language.test.ts`) is what
 * validates this contract.
 */
export const DEFAULT_DIAGNOSTIC_CONFIG: DiagnosticConfig = {
	reservedKeyword: true,
	doubleUnderscore: true,
	consecutiveUnderscores: true,
	duplicateDeclaration: true,
	unresolvedIdentifier: true,
	// stricter-than-TC; opt-in
	unknownPragma: false,
	wrongVendorPragma: false,
	pragmaMissingCompanion: true,
	pragmaConflict: true,
	fbLifecycleSignature: true,
	// stricter-than-TC; opt-in
	shadowingDeclaration: false,
	// stricter-than-TC; opt-in
	initSlotCollision: false,
	conversionSourceMismatch: true,
	messagePragmas: true,
	orphanConditionalPragma: true,
	assignmentTypeMismatch: true,
	missingInterfaceImplementation: true,
	binaryOperatorTypeMismatch: true,
	varSectionPlacement: true,
	derefOnNonPointer: true,
	vendorOnlyOperator: true,
};

/**
 * Vendor selector. Drives which vendor-specific reference entries
 * appear in completion/hover and which diagnostic the unknown-pragma
 * check emits.
 *
 *   - `"codesys"` — CODESYS V3 (3S Smart Software Solutions) targeting
 *   - `"twincat"` — Beckhoff TwinCAT 3 targeting
 *   - `"auto"` — let the workspace scanner detect from project files;
 *     falls back to `"codesys"` when no signal found
 */
export type Vendor = "codesys" | "twincat";
export type VendorSetting = Vendor | "auto";

export interface PlcLspInitOptions {
	/** Active vendor (default "auto"). */
	vendor?: VendorSetting;
	diagnostics?: Partial<DiagnosticConfig>;
	hover?: {
		/** Append the documentation source URL to hover content. Default: true. */
		showSource?: boolean;
	};
	completion?: {
		/** Honor LSP snippet syntax in completion items. Default: true. */
		snippetSupport?: boolean;
	};
}

export interface ResolvedConfig {
	/** Resolved vendor — never "auto" (workspace scanner has already run). */
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
 * Merge a partial init-options blob into the defaults. Each missing field
 * falls back to `DEFAULT_RESOLVED_CONFIG`.
 *
 * `vendor: "auto"` resolves to `"codesys"` here as a deterministic
 * default — the agent's `volt init` writes the detected vendor into
 * `.volt/config.json` and the client passes the resolved value,
 * so this default only fires when no project context is available.
 */
export function resolveConfig(opts: PlcLspInitOptions | undefined): ResolvedConfig {
	const requestedVendor = opts?.vendor;
	const vendor: Vendor =
		requestedVendor === "codesys" || requestedVendor === "twincat"
			? requestedVendor
			: "codesys"; // "auto" or undefined → codesys default
	return {
		vendor,
		diagnostics: {
			...DEFAULT_DIAGNOSTIC_CONFIG,
			...(opts?.diagnostics ?? {}),
		},
		hover: {
			showSource: opts?.hover?.showSource ?? DEFAULT_RESOLVED_CONFIG.hover.showSource,
		},
		completion: {
			snippetSupport:
				opts?.completion?.snippetSupport ?? DEFAULT_RESOLVED_CONFIG.completion.snippetSupport,
		},
	};
}
