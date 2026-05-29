/**
 * Vendor-only system-operator / type check — flag CODESYS-only
 * `__`-prefixed identifiers (`__VARINFO`, `__NEW`, `__TRY`,
 * `__QUERYINTERFACE`, `__VECTOR`, …) when the active vendor is
 * TwinCAT. TC's compiler rejects these as unknown tokens; mirroring
 * the rejection at LSP level lets users see the issue without waiting
 * for a build.
 *
 * `__ISVALIDREF` is TC-compatible and stays silent (verified live
 * via conformance recording).
 *
 * Scans the full source (re-lexed) — not just POU bodies — because
 * type-position usages (`vec4 : __VECTOR[4] OF REAL;`) live inside
 * VAR sections, not in body tokens.
 */
import type { ParseResult } from "../../parser/ast.js";
import { lex } from "../../lexer/lexer.js";
import { OPERATORS } from "../../reference/operators.js";
import type { Vendor } from "../../reference/index.js";
import type { DiagnosticItem } from "./_shared.js";

/**
 * CODESYS-only identifiers that appear in TYPE position rather than
 * operator position. Kept here so the same scan catches both
 * varieties — the OPERATORS reference table is for operators that
 * appear in expressions; types live in their own catalog.
 */
const CODESYS_ONLY_TYPES = new Map<string, { hint: string }>([
	["__vector", {
		hint: "TwinCAT has no SIMD primitive — use `ARRAY[0..N-1] OF T` for fixed-size containers.",
	}],
]);

export function checkVendorOnlyOperators(
	parseResult: ParseResult,
	activeVendor: Vendor | undefined,
	source: string,
	out: DiagnosticItem[],
): void {
	// Only meaningful when targeting TwinCAT — CODESYS accepts its
	// own operators by definition.
	if (activeVendor !== "twincat") return;

	// parseResult is unused now (kept for signature stability; future
	// AST-driven variant could narrow the scope to e.g. body-only
	// scans for opt-in users) but the simple source-lex catches both
	// expression-position operators AND type-position __VECTOR.
	void parseResult;

	for (const tok of lex(source)) {
		// CODESYS `__`-prefixed operators get tokenized as `keyword`
		// (lexer keyword table) OR `identifier` (unknown to the
		// lexer). Either kind can carry the name we're matching.
		if (tok.kind !== "identifier" && tok.kind !== "keyword") continue;
		if (!tok.text.startsWith("__")) continue;
		const key = tok.text.toLowerCase();

		const opEntry = OPERATORS.get(key);
		if (opEntry !== undefined && opEntry.vendor === "codesys") {
			const eq =
				opEntry.equivalentIn?.twincat !== undefined
					? ` Equivalent in twincat: '${opEntry.equivalentIn.twincat.name}'` +
					  (opEntry.equivalentIn.twincat.note !== undefined ? ` (${opEntry.equivalentIn.twincat.note})` : "") +
					  "."
					: "";
			out.push({
				severity: "error",
				span: tok.span,
				source: "volt-lsp-st",
				code: "vendor-only-operator",
				message: `Operator '${tok.text}' is CODESYS-only and not supported by TwinCAT.${eq}`,
			});
			continue;
		}

		const typeEntry = CODESYS_ONLY_TYPES.get(key);
		if (typeEntry !== undefined) {
			out.push({
				severity: "error",
				span: tok.span,
				source: "volt-lsp-st",
				code: "vendor-only-type",
				message: `Type '${tok.text}' is CODESYS-only and not supported by TwinCAT. ${typeEntry.hint}`,
			});
		}
	}
}
