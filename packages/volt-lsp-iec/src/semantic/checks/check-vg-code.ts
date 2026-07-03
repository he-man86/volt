/**
 * VG code-correctness diagnostics — the checks the bridge does NOT do
 * (it owns format; the LSP owns code correctness, vg-language.md §11):
 *
 *   - vg-undeclared-identifier: an operand names something not declared in
 *     the POU (the VG analogue of unresolved-identifier).
 *   - vg-undefined-label: a `JMP` targets a label not defined in its network.
 *   - vg-unknown-pin: an FB-instance call passes a pin the FB doesn't declare.
 *
 * All operate on the parsed VG tree + the resolved POU scope.
 */
import type { ParseResult } from "../../parser/ast.js";
import type { BodyModel } from "../body.js";
import type { BodySpan } from "../../parser/ast.js";
import type { Scope } from "../symbol-table.js";
import { lookup as resolverLookup } from "../resolver.js";
import { getConversion } from "../../reference/type-conversion.js";
import { lookup as referenceLookup } from "../../reference/index.js";
import type { DiagnosticConfig } from "../../lsp/config/index.js";
import type { VgNetwork, VgStatement } from "../../vg/index.js";
import { type DiagnosticItem, KEYWORD_SET, getAnyBody, findScopeForUnit } from "./_shared.js";

export function checkVgCode(
	parseResult: ParseResult,
	project: Scope,
	bodyModels: Map<BodySpan, BodyModel>,
	config: DiagnosticConfig,
	out: DiagnosticItem[],
): void {
	for (const unit of parseResult.units) {
		const body = getAnyBody(unit);
		if (body === undefined) continue;
		const model = bodyModels.get(body);
		if (model?.language !== "vg" || model.vg === undefined) continue;
		const scope = findScopeForUnit(project, unit);
		if (scope === undefined) continue;

		if (config.vgUndeclaredIdentifier) checkUndeclared(model, scope, out);
		for (const network of model.vg.networks) {
			if (config.vgUndefinedLabel) checkLabels(network, out);
			if (config.vgUnknownPin) checkPins(network, project, scope, out);
		}
	}
}

function checkUndeclared(model: BodyModel, scope: Scope, out: DiagnosticItem[]): void {
	for (const ref of model.identifiers) {
		if (ref.isNamedParam || ref.isMemberAccess) continue;
		const name = ref.name;
		if (KEYWORD_SET.has(name.toLowerCase())) continue; // operator-words / function-words
		if (getConversion(name) !== undefined) continue;
		// Standard IEC / CODESYS library names — operators (SEL/MUX), standard FBs (TON), standard functions
		// (CONCAT/DELETE/REPLACE/INSERT/FIND/…), builtin types — live in the reference catalog, not the project
		// scope. The ST unresolved-identifier check consults it the same way; the VG analogue must too.
		if (referenceLookup(name) !== undefined) continue;
		if (resolverLookup(scope, name) !== undefined) continue;
		out.push({
			severity: "warning",
			span: ref.span,
			source: "volt-lsp-iec",
			code: "vg-undeclared-identifier",
			message: `'${name}' is not defined in any reachable scope`,
		});
	}
}

function checkLabels(network: VgNetwork, out: DiagnosticItem[]): void {
	const labels = new Set<string>();
	for (const stmt of network.statements) {
		if (stmt.kind === "label") labels.add(stmt.name.text);
	}
	for (const stmt of network.statements) {
		if (stmt.kind === "jump" && !labels.has(stmt.target.text)) {
			out.push({
				severity: "error",
				span: stmt.target.span,
				source: "volt-lsp-iec",
				code: "vg-undefined-label",
				message: `jump target '${stmt.target.text}' is not a label in this network`,
			});
		}
	}
}

function checkPins(network: VgNetwork, project: Scope, scope: Scope, out: DiagnosticItem[]): void {
	const visit = (stmt: VgStatement): void => {
		if (stmt.kind === "en_eno_if") {
			visit(stmt.body);
			return;
		}
		if (stmt.kind !== "fb_call") return;
		// The full instance path (`a.b.c`); resolving a member path to its FB type isn't supported yet, so
		// inputPins returns undefined and pin-checking is (correctly) skipped for nested instances.
		const instancePath = [stmt.instance, ...stmt.members].map((n) => n.text).join(".");
		const pins = inputPins(project, scope, instancePath);
		if (pins === undefined) return; // FB type unresolved → don't guess
		for (const arg of stmt.args) {
			if (arg.pin === undefined) continue;
			if (!pins.has(arg.pin.text.toLowerCase())) {
				out.push({
					severity: "warning",
					span: arg.pin.span,
					source: "volt-lsp-iec",
					code: "vg-unknown-pin",
					message: `'${arg.pin.text}' is not an input pin of '${instancePath}'`,
				});
			}
		}
	};
	for (const stmt of network.statements) visit(stmt);
}

interface AstWithVarSections {
	varSections?: ReadonlyArray<{ sectionKind: string; decls: ReadonlyArray<{ names: ReadonlyArray<{ text: string }> }> }>;
}

/** Lowercased set of an FB instance's input-pin names, or undefined when
 *  the instance / its type can't be resolved. */
function inputPins(project: Scope, scope: Scope, instance: string): Set<string> | undefined {
	const r = resolverLookup(scope, instance);
	const typeExpr = r?.symbol.typeExpr;
	if (typeExpr === undefined || typeExpr.kind !== "named_type") return undefined;
	const ast = findTypeAst(project, typeExpr.name.text);
	if (ast === undefined) return undefined;
	const out = new Set<string>();
	for (const section of ast.varSections ?? []) {
		if (section.sectionKind !== "VAR_INPUT" && section.sectionKind !== "VAR_IN_OUT") continue;
		for (const decl of section.decls) {
			for (const n of decl.names) out.add(n.text.toLowerCase());
		}
	}
	return out;
}

function findTypeAst(project: Scope, typeName: string): AstWithVarSections | undefined {
	const target = typeName.toLowerCase();
	const stack: Scope[] = [project];
	while (stack.length > 0) {
		const sc = stack.pop()!;
		for (const [, syms] of sc.symbols) {
			for (const sym of syms) {
				if (sym.name.toLowerCase() === target) {
					const ast = sym.ast as AstWithVarSections | undefined;
					if (ast !== undefined && Array.isArray(ast.varSections)) return ast;
				}
			}
		}
		stack.push(...sc.children);
	}
	return undefined;
}
