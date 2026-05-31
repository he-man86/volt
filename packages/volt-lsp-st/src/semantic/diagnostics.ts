/**
 * Semantic diagnostics orchestrator — dispatches each enabled check
 * (in `./checks/`) and concatenates their results.
 *
 * **Pure data in → pure data out.** This module knows nothing about
 * LSP transport. The server calls `computeSemanticDiagnostics()` and
 * merges results with parse errors before push/pull delivery.
 *
 * Each check has a `DiagnosticConfig` flag — disabled checks are
 * skipped entirely (no compute cost).
 */
import type { ParseResult } from "../parser/ast.js";
import type { Scope } from "./symbol-table.js";
import type { Vendor } from "../reference/index.js";
import type { BodySpan } from "../parser/ast.js";
import type { BodyModel } from "../body/index.js";
import type { DiagnosticConfig } from "../lsp/config.js";

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
	/** Enable flags. Defaults to all-on. */
	config: DiagnosticConfig;
	/** Active vendor — drives wrong-vendor-pragma vs unknown-pragma distinction. */
	activeVendor?: Vendor;
	/** Per-body BodyModel produced by the language-appropriate parser
	 *  (`body/index.ts`). Required by body-dependent checks
	 *  (currently only `unresolved-identifier`). Empty Map is OK —
	 *  body-dependent checks just skip. */
	bodyModels?: Map<BodySpan, BodyModel>;
}

export function computeSemanticDiagnostics(args: DiagnosticsArgs): DiagnosticItem[] {
	const out: DiagnosticItem[] = [];
	const cfg = args.config;

	if (
		cfg.reservedKeyword ||
		cfg.doubleUnderscore ||
		cfg.consecutiveUnderscores ||
		cfg.duplicateDeclaration
	) {
		walkDeclarations(args.parseResult, args.project, cfg, out);
	}

	if (cfg.unresolvedIdentifier) {
		checkUnresolvedIdentifiers(args.parseResult, args.project, args.bodyModels, out);
	}

	if (
		cfg.unknownPragma ||
		cfg.wrongVendorPragma ||
		cfg.pragmaMissingCompanion ||
		cfg.pragmaConflict ||
		cfg.initSlotCollision ||
		cfg.messagePragmas ||
		cfg.orphanConditionalPragma
	) {
		analyzePragmas(args.source, args.parseResult, cfg, args.activeVendor, out);
	}

	if (cfg.fbLifecycleSignature) {
		checkLifecycleSignatures(args.parseResult, out);
	}

	if (cfg.shadowingDeclaration) {
		checkShadowing(args.project, out);
	}

	if (cfg.conversionSourceMismatch) {
		checkConversionCalls(args.parseResult, args.project, out);
	}

	if (cfg.assignmentTypeMismatch) {
		checkAssignmentTypes(args.parseResult, args.project, out);
	}

	if (cfg.missingInterfaceImplementation) {
		checkInterfaceImplementations(args.parseResult, args.project, out);
	}

	if (cfg.binaryOperatorTypeMismatch) {
		checkBinaryOperators(args.parseResult, args.project, out);
	}

	if (cfg.varSectionPlacement) {
		checkVarSectionPlacement(args.parseResult, out);
	}

	if (cfg.derefOnNonPointer) {
		checkDerefOnNonPointer(args.parseResult, args.project, out);
	}

	if (cfg.vendorOnlyOperator) {
		checkVendorOnlyOperators(args.parseResult, args.activeVendor, args.source, out);
	}

	return out;
}
