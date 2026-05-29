/**
 * Simple assignment-type-mismatch — walks each method body, finds
 * `<id> := <rhs> ;` patterns where RHS is a single identifier or
 * typed literal, looks up both sides' types, and emits an error when
 * TC would refuse the assignment (BOOL ↔ numeric, narrowing,
 * STRING ↔ numeric).
 *
 * Skipped — silently — when RHS is more complex (binary expression,
 * conversion call, member access, parenthesized). Without full
 * expression type-inference we'd guess wrong and false-positive.
 * Conservative by design.
 */
import type { ParseResult } from "../../parser/ast.js";
import type { Scope } from "../symbol-table.js";
import type { Token } from "../../lexer/tokens.js";
import {
	type DiagnosticItem,
	getBody,
	findScopeForUnit,
	simpleIdentifierType,
	isLexerTrivia,
} from "./_shared.js";

export function checkAssignmentTypes(
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
		for (let i = 0; i < meaningful.length; i++) {
			// Pattern: <ident> := <single-rhs> ;
			const lhsTok = meaningful[i];
			if (lhsTok === undefined || lhsTok.kind !== "identifier") continue;
			const assign = meaningful[i + 1];
			if (assign?.kind !== "punct" || assign.text !== ":=") continue;
			// Find the terminating `;`. Capture everything between as RHS.
			let semicolonAt = -1;
			for (let j = i + 2; j < meaningful.length && j < i + 8; j++) {
				const t = meaningful[j];
				if (t?.kind === "punct" && t.text === ";") {
					semicolonAt = j;
					break;
				}
			}
			if (semicolonAt < 0) continue;
			const rhsTokens = meaningful.slice(i + 2, semicolonAt);

			// LHS type lookup. Skip if LHS is itself a member access
			// (`x.field`) — we don't track member types.
			const lhsType = simpleIdentifierType(scope, lhsTok.text);
			if (lhsType === undefined) continue;

			// RHS type — only the simple shapes we trust.
			const rhsType = classifyRhs(rhsTokens, scope);
			if (rhsType === undefined) continue;

			if (isAssignable(lhsType, rhsType)) continue;

			out.push({
				// Error — TC refuses to compile a mismatched assignment
				// ("Cannot convert type X to type Y"). Matching the TC
				// severity gives the IDE a consistent red squiggle.
				severity: "error",
				span: lhsTok.span,
				source: "volt-lsp-st",
				code: "assignment-type-mismatch",
				message: `Cannot assign ${rhsType} value to '${lhsTok.text}' (declared ${lhsType}).`,
			});
		}
	}
}

/**
 * Classify RHS tokens into an elementary type when the shape is
 * trustworthy — single identifier, single string/time/date/bool
 * literal, typed-literal `TYPE#value`. Anything else returns
 * undefined.
 */
function classifyRhs(rhs: readonly Token[], scope: Scope): string | undefined {
	if (rhs.length === 0) return undefined;
	if (rhs.length === 1) {
		const t = rhs[0]!;
		if (t.kind === "identifier") return simpleIdentifierType(scope, t.text);
		if (t.kind === "string_lit") return "STRING";
		if (t.kind === "wstring_lit") return "WSTRING";
		if (t.kind === "time_lit") return "TIME";
		if (t.kind === "date_lit") return "DATE";
		if (t.kind === "datetime_lit") return "DT";
		if (t.kind === "keyword" && (t.text.toUpperCase() === "TRUE" || t.text.toUpperCase() === "FALSE")) return "BOOL";
		// Numeric literals (`int_lit`, `real_lit`) are intentionally
		// SKIPPED. TC types them polymorphically: `bValue : BYTE :=
		// 2#10101010` is valid because 170 fits in BYTE; the same
		// literal assigned to INT or DINT is also valid. Without
		// parsing the literal's numeric value we'd false-positive on
		// every hex/binary-to-narrow-numeric assignment. The
		// typed-literal form `BYTE#170` (handled below) is the
		// explicit alternative when assignment-type rigor matters.
		return undefined;
	}
	// `TYPE#literal` pattern → length 3: identifier or keyword for
	// type, `#`, then literal.
	if (rhs.length === 3) {
		const head = rhs[0]!;
		const hash = rhs[1]!;
		if (
			(head.kind === "identifier" || head.kind === "keyword") &&
			hash.kind === "punct" &&
			hash.text === "#"
		) {
			return head.text.toUpperCase();
		}
	}
	return undefined;
}

/**
 * IEC 61131-3 assignment compatibility (simplified — only the rules
 * the simple-assignment check exercises).
 *
 *   - Same type → always OK.
 *   - BOOL is isolated: only BOOL accepts BOOL, BOOL rejects every
 *     other type, every other type rejects BOOL.
 *   - STRING / WSTRING / TIME / DATE / TOD / DT-family are isolated
 *     from numerics.
 *   - Numeric types form a widening hierarchy by byte-width: a
 *     narrower type can flow into a wider one (INT → DINT → LINT →
 *     REAL → LREAL). The reverse (DINT → INT) is narrowing — not
 *     accepted implicitly.
 *
 * Returns true when unsure (unknown type names) — we'd rather miss a
 * bug than flag valid code as broken.
 */
function isAssignable(lhs: string, rhs: string): boolean {
	if (lhs === rhs) return true;
	const ISOLATED = new Set([
		"BOOL",
		"STRING",
		"WSTRING",
		"TIME",
		"LTIME",
		"DATE",
		"TIME_OF_DAY",
		"TOD",
		"DATE_AND_TIME",
		"DT",
		"LDATE",
		"LDATE_AND_TIME",
		"LDT",
		"LTOD",
	]);
	if (ISOLATED.has(lhs) || ISOLATED.has(rhs)) return false;
	const NUMERIC_RANK: Record<string, number> = {
		SINT: 1,
		USINT: 1,
		BYTE: 1,
		INT: 2,
		UINT: 2,
		WORD: 2,
		DINT: 3,
		UDINT: 3,
		DWORD: 3,
		LINT: 4,
		ULINT: 4,
		LWORD: 4,
		REAL: 5,
		LREAL: 6,
	};
	const lr = NUMERIC_RANK[lhs];
	const rr = NUMERIC_RANK[rhs];
	if (lr === undefined || rr === undefined) return true; // unknown — don't flag
	return rr <= lr;
}
