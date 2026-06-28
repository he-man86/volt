/**
 * Pointer-deref applied to a non-pointer — flag `<id>^` patterns
 * where `id` is declared as a simple (non-pointer) type. Mirrors
 * TC's `'^' is not defined for type ...` compile error.
 *
 * Conservative: only the simple `<id>^` shape (single identifier
 * followed immediately by `^`) is checked. Composite LHS (member
 * access `obj.field^`, array element `arr[i]^`, parenthesized
 * `(expr)^`) is skipped — would need expression typing.
 *
 * When the identifier is unresolved or its type is composite
 * (array / reference / etc.), the check stays silent: the
 * unresolved-id or assignment-type checks already cover those cases.
 */
import type { ParseResult } from "../../parser/ast.js";
import type { Scope } from "../symbol-table.js";
import { lookup as resolverLookup } from "../resolver.js";
import {
	type DiagnosticItem,
	getBody,
	findScopeForUnit,
	isLexerTrivia,
} from "./_shared.js";

export function checkDerefOnNonPointer(
	parseResult: ParseResult,
	project: Scope,
	out: DiagnosticItem[],
): void {
	for (const unit of parseResult.units) {
		const body = getBody(unit);
		if (body === undefined) continue;
		const scope = findScopeForUnit(project, unit);
		if (scope === undefined) continue;

		const meaningful = body.tokens.filter((t) => !isLexerTrivia(t.kind));
		for (let i = 0; i + 1 < meaningful.length; i++) {
			const idTok = meaningful[i]!;
			const caret = meaningful[i + 1]!;
			if (idTok.kind !== "identifier") continue;
			if (caret.kind !== "punct" || caret.text !== "^") continue;
			// Skip member-access shapes: a leading `.` means we're
			// inside `obj.field` — RHS typing isn't tracked, so we
			// can't decide whether the field is a pointer.
			const prev = meaningful[i - 1];
			if (prev?.kind === "punct" && prev.text === ".") continue;
			// Skip ARRAY indexing: `arr[i]^` — also a typing-unknown
			// shape. Index pattern: `<id> [ ... ] ^` — but we're at
			// `<id>^` only, so `arr` followed by `^` directly already
			// caught here. Good.

			const r = resolverLookup(scope, idTok.text);
			if (r === undefined) continue; // unresolved-id handles this
			const t = r.symbol.typeExpr;
			if (t === undefined) continue;
			// Allow on actual pointers — that's the legal case.
			if (t.kind === "pointer_type") continue;
			// REFERENCE TO ... auto-dereferences; `^` is not used on
			// references. TC rejects `^` on a REFERENCE TO INT the
			// same way as on a plain INT — flag the same way.
			// Unknown / composite shapes (array / implicit-enum /
			// string) are not legal deref targets either. Surface
			// the same diagnostic.
			let typeLabel: string;
			if (t.kind === "named_type") typeLabel = t.name.text;
			else if (t.kind === "string_type") typeLabel = t.wide ? "WSTRING" : "STRING";
			else if (t.kind === "array_type") typeLabel = "ARRAY";
			else if (t.kind === "reference_type") typeLabel = "REFERENCE";
			else if (t.kind === "implicit_enum_type") typeLabel = "(implicit enum)";
			else continue;

			out.push({
				severity: "error",
				span: caret.span,
				source: "volt-lsp-codesys",
				code: "deref-non-pointer",
				message: `Cannot dereference '${idTok.text}': '${typeLabel}' is not a pointer type.`,
			});
		}
	}
}
