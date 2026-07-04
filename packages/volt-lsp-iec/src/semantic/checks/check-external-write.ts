/**
 * External write to a non-`VAR_INPUT` member of an FB instance — `fb.internalVar := x`.
 *
 * Per IEC/CODESYS (docs 02-variables): only `VAR_INPUT` is writable externally via the instance path;
 * `VAR` / `VAR_OUTPUT` are read-only externally. CODESYS rejects such a write with "'X' is no input of
 * '<FB>'". Conservative — flags only when it is DEFINITELY illegal AND reliably knowable:
 *   - the target is a member access `base.member`,
 *   - `base` is NOT internal (`THIS`/`SUPER`) — writing your own members is legal,
 *   - `base` infers to a FUNCTION_BLOCK (struct fields are freely writable → skipped),
 *   - the member is PROJECT-LOCAL (library-signature members flatten their sections → unreliable → skipped),
 *   - the member has a declared var section that is not `VAR_INPUT`.
 * Anything uncertain (unknown base type, no section, library member, method/property) is skipped → zero FP.
 */
import type { Expr, ParseResult } from "../../parser/ast.js";
import type { Scope } from "../symbol-table.js";
import { parseStatements } from "../../parser/statements.js";
import { walkStatements } from "../../parser/ast-walk.js";
import { inferExprType, resolveMemberChain } from "../type-infer.js";
import { type DiagnosticItem, getBody, findScopeForUnit, isLibrarySymbol } from "./_shared.js";

/** True when the member base is the enclosing instance itself (`THIS` / `THIS^` / `SUPER^`) — an internal
 *  write, always legal. A chain rooted at THIS but ending on ANOTHER instance (`THIS^.subFb`) is NOT internal. */
function isInternalBase(expr: Expr): boolean {
	let e = expr;
	if (e.kind === "paren") e = e.inner;
	if (e.kind === "deref") e = e.base;
	return e.kind === "ident_expr" && (e.name.toUpperCase() === "THIS" || e.name.toUpperCase() === "SUPER");
}

export function checkExternalNonInputWrite(
	parseResult: ParseResult,
	project: Scope,
	out: DiagnosticItem[],
): void {
	for (const unit of parseResult.units) {
		const body = getBody(unit);
		if (body === undefined) continue;
		const scope = findScopeForUnit(project, unit);
		if (scope === undefined) continue;

		const parsed = parseStatements(body);
		if (!parsed.ok) continue;
		walkStatements(parsed.statements, (s) => {
			if (s.kind !== "assign" || s.op !== undefined) return; // plain `:=` only (S=/R=/REF= differ)
			if (s.target.kind !== "member") return;
			if (isInternalBase(s.target.base)) return; // writing your own member (THIS/SUPER) is legal
			if (inferExprType(s.target.base, scope, project).kind !== "function_block") return; // struct/unknown → skip
			const sym = resolveMemberChain(s.target, scope, project);
			if (sym === undefined || isLibrarySymbol(sym)) return; // library sections are lossy → can't decide
			const section = sym.varSection;
			if (section === undefined || section === "VAR_INPUT") return; // legal input write, or not a var
			out.push({
				severity: "error",
				span: s.target.span,
				source: "volt-lsp-iec",
				code: "external-non-input-write",
				message: `Cannot write '${s.target.member.name}' externally: only VAR_INPUT members are writable via the instance path ('${s.target.member.name}' is ${section}).`,
			});
		});
	}
}
