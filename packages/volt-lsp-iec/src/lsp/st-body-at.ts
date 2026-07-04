/**
 * Locate the ST statement tree at a document offset — the shared entry
 * point for member-chain navigation (definition / hover / completion /
 * references). Returns the body's statements only when it parsed cleanly
 * (`statementsOk`); callers fall back to name-based resolution otherwise.
 */
import type { BodySpan, StatementList } from "../parser/ast.js";
import type { BodyModel } from "../semantic/body.js";

export function stStatementsAtOffset(
	bodyModels: Map<BodySpan, BodyModel>,
	offset: number,
): StatementList | undefined {
	for (const m of bodyModels.values()) {
		if (
			m.language === "st" &&
			m.statementsOk === true &&
			m.statements !== undefined &&
			offset >= m.span.start &&
			offset < m.span.end
		) {
			return m.statements;
		}
	}
	return undefined;
}
