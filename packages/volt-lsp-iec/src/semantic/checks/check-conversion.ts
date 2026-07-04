/**
 * Conversion-source-mismatch — scan each POU body for
 * `<NAME>(<simple_ident>)` patterns where `<NAME>` looks like a
 * type-conversion (`<SRC>_TO_<DST>` or `TRUNC`/`TRUNC_INT`). Resolve
 * the inner identifier; if its declared type doesn't match `<SRC>`,
 * emit an error with a suggested replacement.
 *
 * Limitations (deliberate — we don't type-check expressions):
 *   - Only simple-identifier args. `INT_TO_DINT(a + b)` is skipped.
 *   - Only resolves names visible in the project / containing POU scope.
 *   - `TO_<DST>` overloaded form is skipped (source type is "ANY").
 *   - When the inner identifier can't be resolved, we skip (so the
 *     unresolved-identifier diagnostic handles it, not us).
 */
import type { BodySpan, Expr, ParseResult } from "../../parser/ast.js";
import type { Scope } from "../symbol-table.js";
import { lookup as resolverLookup } from "../resolver.js";
import { parseStatements } from "../../parser/statements.js";
import { walkAllExprs } from "../../parser/ast-walk.js";
import { inferExprType } from "../type-infer.js";
import {
	conversionsForSource,
	getConversion,
	isAcceptableSource,
} from "../../reference/type-conversion.js";
import {
	type DiagnosticItem,
	getBody,
	findScopeForUnit,
	isLexerTrivia,
} from "./_shared.js";

/** Source-like text of a conversion argument, for the diagnostic message. */
function renderArg(expr: Expr): string {
	switch (expr.kind) {
		case "ident_expr":
			return expr.name;
		case "member":
			return `${renderArg(expr.base)}.${expr.member.name}`;
		case "index":
			return `${renderArg(expr.base)}[…]`;
		case "deref":
			return `${renderArg(expr.base)}^`;
		case "paren":
			return renderArg(expr.inner);
		default:
			return "argument";
	}
}

export function checkConversionCalls(
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
		if (parsed.ok) {
			walkAllExprs(parsed.statements, (e) => {
				if (e.kind !== "call" || e.callee.kind !== "ident_expr") return;
				const conv = getConversion(e.callee.name);
				if (conv === undefined || conv.sourceType === "ANY") return;
				if (e.args.length !== 1 || e.args[0]!.param !== undefined) return; // single positional arg
				const arg = e.args[0]!.value;
				if (arg === undefined) return;
				const t = inferExprType(arg, scope, project);
				if (t.kind !== "elementary" || t.name === undefined) return; // only elementary args (matches old)
				const argType = t.name;
				if (isAcceptableSource(conv, argType)) return;
				const argText = renderArg(arg);
				const replacements = conversionsForSource(argType, conv.destType);
				const suggestion = replacements.length > 0 ? ` Use \`${replacements[0]?.name}(${argText})\` instead.` : "";
				out.push({
					severity: "error",
					span: e.callee.span,
					source: "volt-lsp-iec",
					code: "conversion-source-mismatch",
					message: `Conversion '${conv.name}' expects ${conv.sourceType}, but '${argText}' is declared ${argType}.${suggestion}`,
				});
			});
			continue;
		}
		checkTokenScan(body, scope, project, out);
	}
}

/** Original token-scan path — used verbatim when a body doesn't parse to a clean statement tree. */
function checkTokenScan(body: BodySpan, scope: Scope, project: Scope, out: DiagnosticItem[]): void {
	{
		const meaningful = body.tokens.filter((t) => !isLexerTrivia(t.kind));
		for (let i = 0; i < meaningful.length; i++) {
			const callTok = meaningful[i];
			if (callTok === undefined || callTok.kind !== "identifier") continue;

			const conv = getConversion(callTok.text);
			if (conv === undefined) continue;
			if (conv.sourceType === "ANY") continue; // TO_<DST> form — can't validate

			// Need `(` next.
			const lparen = meaningful[i + 1];
			if (lparen?.kind !== "punct" || lparen.text !== "(") continue;
			// Need simple identifier as the single arg.
			const argTok = meaningful[i + 2];
			if (argTok?.kind !== "identifier") continue;
			const rparen = meaningful[i + 3];
			if (rparen?.kind !== "punct" || rparen.text !== ")") continue;

			// Resolve the inner identifier.
			const r = resolverLookup(scope, argTok.text);
			if (r === undefined) continue; // unresolved → other diagnostic handles
			const typeExpr = r.symbol.typeExpr;
			if (typeExpr === undefined) continue;
			// Extract a comparable type name. We only check the
			// straightforward cases — array / pointer / reference /
			// implicit-enum get skipped (composite types can't easily
			// match a conversion's source).
			let argType: string;
			if (typeExpr.kind === "named_type") {
				argType = typeExpr.name.text;
			} else if (typeExpr.kind === "string_type") {
				argType = typeExpr.wide ? "WSTRING" : "STRING";
			} else {
				continue;
			}

			if (isAcceptableSource(conv, argType)) continue;

			// Suggest a replacement: same destination, source matching
			// the argument's actual type. Prefer the strictly-named form.
			const replacements = conversionsForSource(argType, conv.destType);
			const suggestion =
				replacements.length > 0
					? ` Use \`${replacements[0]?.name}(${argTok.text})\` instead.`
					: "";

			out.push({
				// Error — TC refuses to compile these ("Cannot convert
				// type X to type Y"). Matching the TC severity keeps
				// the IDE squiggle red where the IDE squiggle is red.
				severity: "error",
				span: callTok.span,
				source: "volt-lsp-iec",
				code: "conversion-source-mismatch",
				message:
					`Conversion '${conv.name}' expects ${conv.sourceType}, ` +
					`but '${argTok.text}' is declared ${argType}.${suggestion}`,
			});
		}
	}
}
