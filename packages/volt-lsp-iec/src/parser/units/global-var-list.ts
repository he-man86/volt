/**
 * Top-level GVL file — one or more VAR_GLOBAL / VAR_CONFIG sections
 * with nothing wrapping them.
 *
 * VAR_CONFIG is the IEC address-binding block; same outer shape as a
 * GVL file (single section + END_VAR), so we route both keyword
 * variants through this same parser. The captured VarSection
 * preserves its sectionKind so downstream consumers can distinguish.
 */
import type { GlobalVarList, VarSection } from "../ast.js";
import type { Cursor } from "../cursor.js";
import { collectVarSections, joinSpans } from "../util.js";

export function parseGlobalVarList(c: Cursor): GlobalVarList | undefined {
	const start = c.peek();
	const varSections = collectVarSections(c);
	if (varSections.length === 0) return undefined;
	const last = varSections[varSections.length - 1] as VarSection;
	return {
		kind: "global_var_list",
		varSections,
		span: joinSpans(start.span, last.span),
	};
}
