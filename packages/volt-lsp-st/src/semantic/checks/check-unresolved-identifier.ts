/**
 * Unresolved-identifier diagnostic — walks each POU body, looks up
 * every identifier via the resolver, warns when nothing is found in
 * any reachable scope.
 *
 * Bodies that contain conditional-compile pragmas
 * ({IF}/{ELSIF}/{ELSE}/{END_IF}) are SKIPPED entirely: TC strips dead
 * branches before semantic analysis, but we have no preprocessor, so
 * checking would false-positive on stripped-branch references.
 */
import type { BodySpan, ParseResult } from "../../parser/ast.js";
import type { BodyModel } from "../../semantic/body.js";
import type { Scope } from "../symbol-table.js";
import { lookup as resolverLookup } from "../resolver.js";
import { getConversion } from "../../reference/type-conversion.js";
import { type DiagnosticItem, KEYWORD_SET, getBody, findScopeForUnit } from "./_shared.js";

/**
 * Match the start of any conditional-compile pragma directive
 * (`{IF ...}`, `{ELSIF ...}`, `{ELSE}`, `{END_IF}`). Permissive on
 * leading whitespace inside the braces.
 */
const CONDITIONAL_PRAGMA_RE = /^\{\s*(?:IF|ELSIF|ELSE|END_IF)\b/i;

function bodyContainsConditionalPragma(body: BodySpan): boolean {
	for (const tok of body.tokens) {
		if (tok.kind === "pragma" && CONDITIONAL_PRAGMA_RE.test(tok.text)) return true;
	}
	return false;
}

export function checkUnresolvedIdentifiers(
	parseResult: ParseResult,
	project: Scope,
	bodyModels: Map<BodySpan, BodyModel> | undefined,
	out: DiagnosticItem[],
): void {
	for (const unit of parseResult.units) {
		const body = getBody(unit);
		if (body === undefined) continue;
		const scope = findScopeForUnit(project, unit);
		if (scope === undefined) continue;
		// Pragma tokens are kept in body.tokens by the parser (with
		// kind="pragma"). Scan them directly for conditional-compile
		// directives that gate this skip.
		if (bodyContainsConditionalPragma(body)) continue;
		// Identifier list populated by the ST body parser. If no
		// bodyModel was built (defensive — the workspace builds one
		// for every body it parses), skip the check rather than
		// misreport.
		const model = bodyModels?.get(body);
		if (model === undefined) continue;
		for (const ref of model.identifiers) {
			if (ref.isMemberAccess) {
				// `x.member` — we don't resolve members yet (requires type
				// inference). Skip to avoid false positives.
				continue;
			}
			if (ref.isNamedParam) {
				// `FB(paramName := value)` — the LHS is a parameter name in
				// the callee's declaration, not a variable in the calling
				// scope. Skip: no resolution needed.
				continue;
			}
			const name = ref.name;
			if (KEYWORD_SET.has(name.toLowerCase())) continue;
			// Built-in conversion operators (`INT_TO_REAL`, etc.) are
			// implicit lexical tokens, not symbols in any scope. Skip
			// them here — `checkConversionCalls` validates their own
			// source-type. Without this skip, every conversion call
			// would surface a false-positive unresolved-identifier.
			if (getConversion(name) !== undefined) continue;
			if (resolverLookup(scope, name) !== undefined) continue;
			out.push({
				severity: "warning",
				span: ref.span,
				source: "volt-lsp-st",
				code: "unresolved-identifier",
				message: `'${name}' is not defined in any reachable scope`,
			});
		}
	}
}
