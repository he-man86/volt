/**
 * Semantic diagnostics orchestrator — walks a check registry,
 * gates each entry by `config` flag AND target body language,
 * and concatenates results.
 *
 * **Pure data in → pure data out.** This module knows nothing about
 * LSP transport. The server calls `computeSemanticDiagnostics()` and
 * merges results with parse errors before push/pull delivery.
 *
 * Adding a new check:
 *   1. Add a `CheckSpec` to the `CHECKS` array below.
 *   2. If the check depends on body shape (ST tokens vs FBD graph),
 *      gate via `languages: ["structured-text"]` etc. so it doesn't
 *      false-positive on other body kinds.
 *
 * Adding a new body language (FBD/LD/SFC/CFC/…):
 *   - No changes here. Universal checks (`languages` unset) run on
 *     the new language automatically. Per-language checks stay
 *     scoped where their `languages` field declares.
 */
import type { BodySpan, ParseResult } from "../parser/ast.js";
import type { BodyLanguageId, BodyModel } from "../body/index.js";
import type { DiagnosticConfig } from "../lsp/config.js";
import type { Vendor } from "../reference/index.js";
import type { Scope } from "./symbol-table.js";

import { type DiagnosticItem } from "./checks/_shared.js";
import { walkDeclarations } from "./checks/check-identifier-shape.js";
import { checkUnresolvedIdentifiers } from "./checks/check-unresolved-identifier.js";
import { analyzePragmas } from "./checks/check-pragmas.js";
import { checkLifecycleSignatures } from "./checks/check-lifecycle.js";
import { checkShadowing } from "./checks/check-shadowing.js";
import { checkConversionCalls } from "./checks/check-conversion.js";
import { checkAssignmentTypes } from "./checks/check-assignment-types.js";
import { checkInterfaceImplementations } from "./checks/check-interface-implementation.js";
import { checkBinaryOperators } from "./checks/check-binary-operators.js";
import { checkVarSectionPlacement } from "./checks/check-var-section-placement.js";
import { checkDerefOnNonPointer } from "./checks/check-deref.js";
import { checkVendorOnlyOperators } from "./checks/check-vendor-only-operator.js";

export type { DiagnosticItem };

export interface DiagnosticsArgs {
	/** Parse result for this document. */
	parseResult: ParseResult;
	/** Source text — used for pragma diagnostics (pragmas are stripped from parsed body tokens). */
	source: string;
	/** The project scope (for cross-file lookup). */
	project: Scope;
	/** Body language of this document. Drives per-language check
	 *  gating (ST-grammar checks like assignment-type-mismatch skip
	 *  on `plc-fbd`, etc.). */
	languageId: BodyLanguageId;
	/** Per-body BodyModel produced by the language-appropriate
	 *  parser (`body/index.ts`). Required: the workspace always
	 *  builds it via `buildBodyModelsForParseResult`. */
	bodyModels: Map<BodySpan, BodyModel>;
	/** Enable flags. */
	config: DiagnosticConfig;
	/** Active vendor — drives wrong-vendor-pragma vs unknown-pragma distinction. */
	activeVendor?: Vendor;
}

/** Shared context passed to every check function. Carries everything
 *  any check might need; checks read only what they use. */
export interface CheckContext extends DiagnosticsArgs {}

interface CheckSpec {
	/** Stable identifier — appears in DiagnosticItem.code on output
	 *  but kept here for log / debug clarity too. */
	id: string;
	/** Which body languages this check applies to. `undefined` =
	 *  universal (runs on every body language). */
	languages?: ReadonlyArray<BodyLanguageId>;
	/** Whether this check is currently enabled by user config. Some
	 *  checks have multiple sub-flags (e.g. `walkDeclarations` runs
	 *  if ANY of reservedKeyword / doubleUnderscore / etc. are on);
	 *  the predicate handles that. */
	enabled: (cfg: DiagnosticConfig) => boolean;
	/** Execute the check; append findings to `out`. */
	run: (ctx: CheckContext, out: DiagnosticItem[]) => void;
}

/**
 * The check registry.
 *
 * Universal checks (no `languages` field) run on every body
 * language — they operate on declarations or on the language-
 * neutral `BodyModel.identifiers` surface.
 *
 * ST-grammar checks declare `languages: ["structured-text"]` —
 * they walk the raw ST token stream (assignment `:=`, operator
 * type rules, etc.) which doesn't exist for graphical bodies.
 */
const CHECKS: CheckSpec[] = [
	// ─── Universal — declarations only / language-neutral BodyModel ──
	{
		id: "identifier-shape",
		enabled: (c) =>
			c.reservedKeyword ||
			c.doubleUnderscore ||
			c.consecutiveUnderscores ||
			c.duplicateDeclaration,
		run: (ctx, out) => walkDeclarations(ctx.parseResult, ctx.project, ctx.config, out),
	},
	{
		id: "unresolved-identifier",
		enabled: (c) => c.unresolvedIdentifier,
		// Uses BodyModel.identifiers — populated by every body
		// parser, so this check works for ST + every graphical
		// language without per-language code paths.
		run: (ctx, out) =>
			checkUnresolvedIdentifiers(ctx.parseResult, ctx.project, ctx.bodyModels, out),
	},
	{
		id: "pragmas",
		enabled: (c) =>
			c.unknownPragma ||
			c.wrongVendorPragma ||
			c.pragmaMissingCompanion ||
			c.pragmaConflict ||
			c.initSlotCollision ||
			c.messagePragmas ||
			c.orphanConditionalPragma,
		run: (ctx, out) =>
			analyzePragmas(ctx.source, ctx.parseResult, ctx.config, ctx.activeVendor, out),
	},
	{
		id: "fb-lifecycle-signature",
		enabled: (c) => c.fbLifecycleSignature,
		run: (ctx, out) => checkLifecycleSignatures(ctx.parseResult, out),
	},
	{
		id: "shadowing-declaration",
		enabled: (c) => c.shadowingDeclaration,
		run: (ctx, out) => checkShadowing(ctx.project, out),
	},
	{
		id: "missing-interface-implementation",
		enabled: (c) => c.missingInterfaceImplementation,
		run: (ctx, out) => checkInterfaceImplementations(ctx.parseResult, ctx.project, out),
	},
	{
		id: "var-section-placement",
		enabled: (c) => c.varSectionPlacement,
		run: (ctx, out) => checkVarSectionPlacement(ctx.parseResult, out),
	},

	// ─── ST-grammar only — walk raw ST token stream ────────────────
	// These would false-positive on graphical bodies whose
	// "body" is XML rather than ST statements.
	{
		id: "conversion-source-mismatch",
		languages: ["structured-text"],
		enabled: (c) => c.conversionSourceMismatch,
		run: (ctx, out) => checkConversionCalls(ctx.parseResult, ctx.project, out),
	},
	{
		id: "assignment-type-mismatch",
		languages: ["structured-text"],
		enabled: (c) => c.assignmentTypeMismatch,
		run: (ctx, out) => checkAssignmentTypes(ctx.parseResult, ctx.project, out),
	},
	{
		id: "binary-operator-type-mismatch",
		languages: ["structured-text"],
		enabled: (c) => c.binaryOperatorTypeMismatch,
		run: (ctx, out) => checkBinaryOperators(ctx.parseResult, ctx.project, out),
	},
	{
		id: "deref-non-pointer",
		languages: ["structured-text"],
		enabled: (c) => c.derefOnNonPointer,
		run: (ctx, out) => checkDerefOnNonPointer(ctx.parseResult, ctx.project, out),
	},
	{
		id: "vendor-only-operator",
		languages: ["structured-text"],
		enabled: (c) => c.vendorOnlyOperator,
		run: (ctx, out) => checkVendorOnlyOperators(ctx.parseResult, ctx.activeVendor, ctx.source, out),
	},
];

export function computeSemanticDiagnostics(args: DiagnosticsArgs): DiagnosticItem[] {
	const out: DiagnosticItem[] = [];
	for (const check of CHECKS) {
		if (!check.enabled(args.config)) continue;
		if (check.languages !== undefined && !check.languages.includes(args.languageId)) continue;
		check.run(args, out);
	}
	return out;
}
