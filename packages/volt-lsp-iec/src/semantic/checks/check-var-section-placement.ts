/**
 * VAR-section placement — flag VAR-section kinds + modifiers that
 * aren't allowed for the containing POU kind. Mirrors TC's
 * `VAR_TEMP declaration not allowed in this place`, `VAR_GLOBAL ...`,
 * and the NON_RETAIN parse-cascade errors.
 *
 * Current rules:
 *   - VAR_TEMP allowed in PROGRAM, FUNCTION, FUNCTION_BLOCK.
 *     Rejected in METHOD, ACTION, INTERFACE method signatures.
 *   - VAR_GLOBAL allowed only in a GVL. Rejected everywhere else.
 *   - NON_RETAIN modifier only meaningful in retain contexts; TC
 *     rejects bare `VAR NON_RETAIN` with a parse cascade. Without
 *     scope tracking we conservatively flag every NON_RETAIN outside
 *     a GVL (where retain inheritance from an enclosing GVL declaration
 *     makes NON_RETAIN semantically valid).
 *
 * Other restrictions exist in IEC 61131-3 (e.g. VAR_INST being FB/METHOD
 * only) but TC's enforcement of them is uneven across versions and
 * we'd false-positive without harvesting evidence first. Add rules
 * here as the conformance harness flags new gaps.
 */
import type { ParseResult, TopLevel, VarSection } from "../../parser/ast.js";
import type { Vendor } from "../../reference/index.js";
import type { DiagnosticItem } from "./_shared.js";

export function checkVarSectionPlacement(
	parseResult: ParseResult,
	activeVendor: Vendor | undefined,
	out: DiagnosticItem[],
): void {
	for (const unit of parseResult.units) {
		if (!("varSections" in unit)) continue;
		for (const section of unit.varSections) {
			const violation = sectionViolation(unit, section, activeVendor);
			if (violation === undefined) continue;
			out.push({
				severity: "error",
				span: section.span,
				source: "volt-lsp-iec",
				code: "var-section-placement",
				message: violation,
			});
		}
	}
}

/** The compilers' generic misplaced-section message. TwinCAT quotes the section name, CODESYS doesn't. */
function notAllowedHere(sectionKind: string, activeVendor: Vendor | undefined): string {
	return activeVendor === "twincat"
		? `'${sectionKind}' declaration not allowed in this place`
		: `${sectionKind} declaration not allowed in this place`;
}

function sectionViolation(unit: TopLevel, section: VarSection, activeVendor: Vendor | undefined): string | undefined {
	if (section.sectionKind === "VAR_TEMP") {
		if (unit.kind === "method" || unit.kind === "action" || unit.kind === "interface") {
			return notAllowedHere("VAR_TEMP", activeVendor);
		}
	}
	if (section.sectionKind === "VAR_GLOBAL") {
		if (unit.kind !== "global_var_list") {
			return notAllowedHere("VAR_GLOBAL", activeVendor);
		}
	}
	if (section.nonRetain === true && unit.kind !== "global_var_list") {
		// TC parses bare `VAR NON_RETAIN ... END_VAR` outside a retain-
		// context cascade as a malformed VAR section (it expects a type
		// after `VAR NON`). The NON_RETAIN modifier only earns its keep
		// when an enclosing scope's RETAIN inheritance would otherwise
		// apply — i.e. inside a GVL declared as RETAIN, or on a member
		// of an FB instance that's itself RETAIN.
		return "NON_RETAIN is only meaningful in retain-cascade contexts (e.g. inside a GVL that's RETAIN). Bare 'VAR NON_RETAIN' is rejected by TC.";
	}
	return undefined;
}
