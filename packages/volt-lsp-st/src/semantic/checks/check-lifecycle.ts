/**
 * FB lifecycle signature validation. Method names matching a known
 * lifecycle hook (FB_init, FB_reinit, FB_exit) must take the required
 * VAR_INPUT parameters in order. Mirrors TC's enforcement: TC errors
 * when a required param is missing but PERMITS deviations on return
 * type and extra params (verified live via conformance: TC accepts
 * `METHOD FB_Init : INT` and `FB_Reinit` with extra params). The LSP
 * matches TC's behavior — if TC accepts it, we accept it.
 */
import type { ParseResult } from "../../parser/ast.js";
import { getLifecycle } from "../../reference/lifecycle.js";
import type { DiagnosticItem } from "./_shared.js";

export function checkLifecycleSignatures(parseResult: ParseResult, out: DiagnosticItem[]): void {
	for (const unit of parseResult.units) {
		if (unit.kind !== "method") continue;
		const spec = getLifecycle(unit.name.text);
		if (spec === undefined) continue;

		const inputs = collectVarInputParams(unit);
		for (let i = 0; i < spec.requiredParams.length; i++) {
			const required = spec.requiredParams[i]!;
			const got = inputs[i];
			if (got === undefined || got.name.toLowerCase() !== required.name.toLowerCase()) {
				out.push({
					severity: "error",
					span: unit.name.span,
					source: "volt-lsp-st",
					code: "fb-lifecycle-signature",
					message: `${unit.name.text} requires VAR_INPUT parameter '${required.name} : ${required.type}' at position ${i + 1}.`,
				});
			}
		}
	}
}

function collectVarInputParams(
	unit: { varSections: Array<{ sectionKind: string; decls: Array<{ names: Array<{ text: string }> }> }> },
): Array<{ name: string }> {
	const out: Array<{ name: string }> = [];
	for (const section of unit.varSections) {
		if (section.sectionKind !== "VAR_INPUT") continue;
		for (const decl of section.decls) {
			for (const id of decl.names) {
				out.push({ name: id.text });
			}
		}
	}
	return out;
}
