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
import type { Vendor } from "../../reference/index.js";
import type { DiagnosticItem } from "./_shared.js";

export function checkLifecycleSignatures(
	parseResult: ParseResult,
	activeVendor: Vendor | undefined,
	out: DiagnosticItem[],
): void {
	for (const unit of parseResult.units) {
		if (unit.kind !== "method") continue;
		const spec = getLifecycle(unit.name.text);
		if (spec === undefined) continue;

		// The compiler emits ONE canned message per lifecycle method (describing the whole required
		// signature), regardless of which/how many params are wrong — so we flag once per method, not
		// once per missing param, and mirror the exact per-vendor wording.
		const inputs = collectVarInputParams(unit);
		const violated = spec.requiredParams.some((required, i) => {
			const got = inputs[i];
			return got === undefined || got.name.toLowerCase() !== required.name.toLowerCase();
		});
		if (violated) {
			out.push({
				severity: "error",
				span: unit.name.span,
				source: "volt-lsp-iec",
				code: "fb-lifecycle-signature",
				message: lifecycleMessage(spec.name, activeVendor),
			});
		}
	}
}

/** The compilers' exact canned message per lifecycle method. TwinCAT and CODESYS phrase these differently. */
function lifecycleMessage(method: string, activeVendor: Vendor | undefined): string {
	const tc = activeVendor === "twincat";
	if (method === "FB_Init") {
		return tc
			? "An 'FB_Init'-Method of a functionblock or struct needs two inputs 'bInitRetains' and 'bInCopyCode' of type BOOL."
			: "The FB_Init method of a function block or struct needs two inputs 'bInitRetains' and 'bInCopyCode' of type BOOL";
	}
	if (method === "FB_Exit") {
		return tc
			? "An 'FB_Exit'-Method of a functionblock or struct needs an input 'bInCopyCode' of type BOOL."
			: "The FB_Exit method of a function block or struct must have a single input 'bInCopyCode' of type BOOL and a return value of type BOOL.";
	}
	// FB_Reinit has no required params, so it never reaches here — defensive fallback only.
	return tc ? `An '${method}'-Method has an invalid signature.` : `The ${method} method has an invalid signature.`;
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
