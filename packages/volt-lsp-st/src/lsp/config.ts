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
	/** Pragma name not in either vendor's catalog. Warning. */
	unknownPragma: boolean;
	/** Pragma known but belongs to the OTHER vendor (not the active one). Warning. */
	wrongVendorPragma: boolean;
	/** A pragma missing its required companion (e.g. instance-path without reflection). Error. */
	pragmaMissingCompanion: boolean;
	/** Two mutually-exclusive pragmas on the same target. Warning. */
	pragmaConflict: boolean;
	/** FB_Init/FB_Reinit/FB_Exit with wrong signature. Error. */
	fbLifecycleSignature: boolean;
	/** A declaration shadows a same-name symbol in an outer scope. Information. */
	shadowingDeclaration: boolean;
	/** {attribute 'global_init_slot' := 'N'} collides with a CODESYS-reserved slot. Warning. */
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
}

export const DEFAULT_DIAGNOSTIC_CONFIG: DiagnosticConfig = {
	reservedKeyword: true,
	doubleUnderscore: true,
	consecutiveUnderscores: true,
	duplicateDeclaration: true,
	unresolvedIdentifier: true,
	unknownPragma: true,
	wrongVendorPragma: true,
	pragmaMissingCompanion: true,
	pragmaConflict: true,
	fbLifecycleSignature: true,
	shadowingDeclaration: true,
	initSlotCollision: true,
	conversionSourceMismatch: true,
	messagePragmas: true,
	orphanConditionalPragma: true,
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
