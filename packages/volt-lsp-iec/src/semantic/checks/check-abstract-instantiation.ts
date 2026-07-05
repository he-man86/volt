/**
 * Instantiating an ABSTRACT function block — `VAR x : FB_Abstract;`.
 *
 * CODESYS rejects this at compile time ("Function block '<FB>' is ABSTRACT"); TwinCAT accepts it (no
 * compile-time enforcement — see the `oop_abstract_instantiated` conformance fixture). Hence CODESYS-only
 * via RULE_VENDOR_APPLICABILITY.
 *
 * Conservative — flags only a DIRECT named-type declaration whose type resolves to a project FB symbol
 * carrying `abstract` in its AST. Arrays/pointers of an abstract FB and library abstract FBs are not
 * flagged (no fixture/ground truth) → zero FP.
 */
import type { FunctionBlock, ParseResult, TypeExpr } from "../../parser/ast.js";
import type { Scope } from "../symbol-table.js";
import { lookupLocal } from "../symbol-table.js";
import { type DiagnosticItem } from "./_shared.js";

export function checkAbstractInstantiation(
	parseResult: ParseResult,
	project: Scope,
	out: DiagnosticItem[],
): void {
	for (const unit of parseResult.units) {
		if (!("varSections" in unit)) continue;
		for (const section of unit.varSections) {
			for (const decl of section.decls) {
				const t: TypeExpr = decl.type;
				if (t.kind !== "named_type") continue; // direct instance only
				const fbSym = lookupLocal(project, t.name.text).find((s) => s.kind === "function_block");
				if (fbSym === undefined) continue;
				if ((fbSym.ast as FunctionBlock).abstract !== true) continue;
				for (const name of decl.names) {
					out.push({
						severity: "error",
						span: name.span,
						source: "volt-lsp-iec",
						code: "abstract-instantiation",
						message: `Cannot instantiate '${t.name.text}': it is an ABSTRACT function block.`,
					});
				}
			}
		}
	}
}
