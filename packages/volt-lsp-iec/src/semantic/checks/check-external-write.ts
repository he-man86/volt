/**
 * External write to a non-`VAR_INPUT` member of an FB instance — `fb.internalVar := x`.
 *
 * Per the CODESYS reference (docs 02-variables L81): external `fb.varName` read/write works ONLY for
 * `VAR_INPUT` / `VAR_OUTPUT`; a plain `VAR` (or VAR_STAT/VAR_TEMP/VAR_INST) is internal and NOT externally
 * writable. CODESYS rejects such a write with "'X' is no input of '<FB>'".
 *
 * BOTH VENDORS. Verified by the fresh live conformance recordings (2026-07-05): for the same
 * `fb.internalVar := x`, CODESYS AND TwinCAT both reject with the identical text `'X' is no input of '<FB>'`.
 * (An earlier stale-bridge TC snapshot made TC look permissive; it isn't.) So the check runs on both, and its
 * message mirrors the compilers' wording exactly.
 *
 * Conservative — flags only when it is DEFINITELY illegal AND reliably knowable:
 *   - the target is a member access `base.member`,
 *   - `base` is NOT internal (`THIS`/`SUPER`) — writing your own members is legal,
 *   - `base` infers to a FUNCTION_BLOCK (struct fields are freely writable → skipped),
 *   - the member is PROJECT-LOCAL (library-signature members flatten their sections → unreliable → skipped),
 *   - the member's section is neither `VAR_INPUT` nor `VAR_OUTPUT` (both externally writable per the doc).
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
			const baseType = inferExprType(s.target.base, scope, project);
			if (baseType.kind !== "function_block") return; // struct/unknown → skip
			const sym = resolveMemberChain(s.target, scope, project);
			if (sym === undefined || isLibrarySymbol(sym)) return; // library sections are lossy → can't decide
			const section = sym.varSection;
			// VAR_INPUT and VAR_OUTPUT are both externally writable via `fb.x` (doc 02-variables L81);
			// no section = not a variable. Everything else (VAR, VAR_STAT, VAR_TEMP, VAR_INST) is internal.
			if (section === undefined || section === "VAR_INPUT" || section === "VAR_OUTPUT") return;
			// Message mirrors the compilers' exact wording (both CODESYS and TwinCAT: `'X' is no input of '<FB>'`),
			// so the diagnostic reads identically in the editor and the IDE. `scope.name` is the FB's declared
			// name in original case (InferredType.name is uppercased — don't use it here).
			const fbName = baseType.scope?.name ?? baseType.name ?? "";
			out.push({
				severity: "error",
				span: s.target.span,
				source: "volt-lsp-iec",
				code: "external-non-input-write",
				message: `'${s.target.member.name}' is no input of '${fbName}'`,
			});
		});
	}
}
