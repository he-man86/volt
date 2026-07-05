/**
 * Shared test harness for semantic-diagnostics + inference tests — one
 * place to build a project and run `computeSemanticDiagnostics`, so the
 * per-check test files carry only their cases (not copy-pasted setup).
 */
import { parseSource } from "../../parser/parser.js";
import { buildSymbolTable } from "../../semantic/symbol-table-build.js";
import { computeSemanticDiagnostics } from "../../semantic/diagnostics.js";
import { buildBodyModelsForParseResult } from "../../semantic/body.js";
import { DEFAULT_DIAGNOSTIC_CONFIG, type DiagnosticConfig } from "../../lsp/config/index.js";
import type { DiagnosticItem } from "../../semantic/checks/_shared.js";
import type { ParseResult } from "../../parser/ast.js";
import type { Scope } from "../../semantic/symbol-table.js";
import type { BodyModel } from "../../semantic/body.js";
import type { BodySpan } from "../../parser/ast.js";

export interface BuiltProject {
	source: string;
	parseResult: ParseResult;
	project: Scope;
	bodyModels: Map<BodySpan, BodyModel>;
}

/** Parse + build the symbol table + body models for a single ST source string. */
export function buildProject(source: string): BuiltProject {
	const parseResult = parseSource(source);
	const project = buildSymbolTable([{ uri: "file:///t.fb", parseResult, source }]);
	const bodyModels = buildBodyModelsForParseResult(parseResult, source);
	return { source, parseResult, project, bodyModels };
}

export interface DiagOptions {
	configOverrides?: Partial<DiagnosticConfig>;
	activeVendor?: "codesys" | "twincat";
	/** When set, only diagnostics carrying this `code` are returned. */
	code?: string;
}

/** Run semantic diagnostics over an already-built project. */
export function runDiagnostics(built: BuiltProject, opts: DiagOptions = {}): DiagnosticItem[] {
	const config: DiagnosticConfig = { ...DEFAULT_DIAGNOSTIC_CONFIG, ...opts.configOverrides };
	const diags = computeSemanticDiagnostics({
		parseResult: built.parseResult,
		source: built.source,
		project: built.project,
		config,
		activeVendor: opts.activeVendor,
		bodyModels: built.bodyModels,
	});
	return opts.code === undefined ? diags : diags.filter((d) => d.code === opts.code);
}

/** Build + run diagnostics for an ST source in one call. */
export function diagnosticsFor(source: string, opts: DiagOptions = {}): DiagnosticItem[] {
	return runDiagnostics(buildProject(source), opts);
}
