/**
 * Assignment-type-mismatch — for each `target := value;`, infers both
 * sides' types and emits an error when TC would refuse the assignment
 * (BOOL ↔ numeric, narrowing, STRING ↔ numeric, incompatible enums).
 *
 * Primary path walks the statement AST (`st-body-ast`) and types each
 * side via the shared inference engine (`type-infer.ts`), so member/
 * index/deref/call operands are typed rather than skipped. When a body
 * doesn't parse to a clean tree it falls back to the original token
 * scan, so behavior is unchanged there. Conservative throughout — any
 * side that infers to `unknown` skips the check (never a false positive).
 */
import type { BodySpan, Expr, ParseResult } from "../../parser/ast.js";
import type { Scope } from "../symbol-table.js";
import type { Token } from "../../lexer/tokens.js";
import { resolveTypeExpr } from "../type-resolver.js";
import { lookup as resolverLookup } from "../resolver.js";
import { parseStatements } from "../../parser/statements.js";
import { walkStatements } from "../../parser/ast-walk.js";
import { inferExprType } from "../type-infer.js";
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
	// project is passed through to isAssignable for ENUM-kind resolution.
	for (const unit of parseResult.units) {
		const body = getBody(unit);
		if (body === undefined) continue;
		const scope = findScopeForUnit(project, unit);
		if (scope === undefined) continue;

		const parsed = parseStatements(body);
		if (parsed.ok) {
			walkStatements(parsed.statements, (s) => {
				if (s.kind !== "assign") return;
				if (s.op !== undefined) return; // S= / R= (BOOL latch) / REF= (reference bind) — different rules
				const lhs = assignKey(s.target, scope, project);
				if (lhs === undefined) return;
				const rhs = assignKey(s.value, scope, project);
				if (rhs === undefined) return;
				if (isAssignable(lhs, rhs, scope, project)) return;
				out.push({
					severity: "error",
					span: s.target.span,
					source: "volt-lsp-iec",
					code: "assignment-type-mismatch",
					message: `Cannot assign ${rhs} value to '${renderTarget(s.target)}' (declared ${lhs}).`,
				});
			});
			continue;
		}
		checkTokenScan(body, scope, project, out);
	}
}

/** The type key of an expression for `isAssignable` — an enum-value reference is tagged (like the token
 *  path's `resolveRhsIdentifierType`); otherwise the inferred type name, or undefined to skip. */
function assignKey(expr: Expr, scope: Scope, project: Scope): string | undefined {
	if (expr.kind === "ident_expr") {
		const r = resolverLookup(scope, expr.name);
		if (r?.symbol.kind === "enum_value") return `${ENUM_PREFIX}${r.foundIn.name}`;
	}
	const t = inferExprType(expr, scope, project);
	// Only reason about types we actually know: elementary (incl. alias-resolved) and enum. A struct/FB,
	// a composite (array/pointer), or an unresolved library type (e.g. FILENAME) infers to a non-checkable
	// category — skip, so we never flag a type we can't reason about (zero-FP).
	return t.kind === "elementary" || t.kind === "enum" ? t.name : undefined;
}

/** Source-like text of an assignment target, for the diagnostic message. */
function renderTarget(expr: Expr): string {
	switch (expr.kind) {
		case "ident_expr":
			return expr.name;
		case "member":
			return `${renderTarget(expr.base)}.${expr.member.name}`;
		case "index":
			return `${renderTarget(expr.base)}[…]`;
		case "deref":
			return `${renderTarget(expr.base)}^`;
		case "paren":
			return renderTarget(expr.inner);
		default:
			return "target";
	}
}

/** Original token-scan path — used verbatim when a body doesn't parse to a clean statement tree. */
function checkTokenScan(body: BodySpan, scope: Scope, project: Scope, out: DiagnosticItem[]): void {
	{
		const meaningful = body.tokens.filter((t) => !isLexerTrivia(t.kind));
		for (let i = 0; i < meaningful.length; i++) {
			// Pattern: <ident> := <single-rhs> ;
			const lhsTok = meaningful[i];
			if (lhsTok === undefined || lhsTok.kind !== "identifier") continue;
			// Skip a member/bit-access target (`x.field := …` or `word.bit := …`): the identifier after a `.`
			// is resolved against the LHS expression's type, not the global scope. Matching a same-named
			// global would false-positive — e.g. `xuUnitVacuum.Vacuum01 := TRUE` is a WORD bit access (the
			// bit index named by the constant Vacuum01), not an assignment to the WORD global `Vacuum01`.
			const prev = meaningful[i - 1];
			if (prev?.kind === "punct" && prev.text === ".") continue;
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

			if (isAssignable(lhsType, rhsType, scope, project)) continue;

			out.push({
				// Error — TC refuses to compile a mismatched assignment
				// ("Cannot convert type X to type Y"). Matching the TC
				// severity gives the IDE a consistent red squiggle.
				severity: "error",
				span: lhsTok.span,
				source: "volt-lsp-iec",
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
		if (t.kind === "identifier") return resolveRhsIdentifierType(scope, t.text);
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

/** Sentinel prefix used in isAssignable to mark an enum type name. */
const ENUM_PREFIX = "__enum__:";

/**
 * Look up an identifier in scope and return a comparable type key:
 * - For enum-value symbols: returns `"__enum__:<EnumTypeName>"` so we
 *   can distinguish different enum types in isAssignable.
 * - For var/param symbols with a named type: returns the uppercased type name.
 * - Everything else: delegates to simpleIdentifierType (returns the type name string).
 */
function resolveRhsIdentifierType(scope: Scope, name: string): string | undefined {
	const r = resolverLookup(scope, name);
	if (r === undefined) return undefined;
	if (r.symbol.kind === "enum_value") {
		// The enum_value's owning scope has the enum type name.
		return `${ENUM_PREFIX}${r.foundIn.name}`;
	}
	return simpleIdentifierType(scope, name);
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
 *   - Enum types: only STRING, BOOL, REAL/LREAL, TIME/DATE families
 *     are flagged as clearly incompatible. Numeric↔enum and
 *     enum↔same-enum-type follow the existing equality check above.
 *
 * Returns true when unsure (unknown type names) — we'd rather miss a
 * bug than flag valid code as broken.
 */
export function isAssignable(lhs: string, rhs: string, scope: Scope, project: Scope): boolean {
	// BIT — a 1-bit field type valid only inside STRUCT/FB — is boolean storage: freely assignable to and
	// from BOOL (CODESYS treats `bitField := boolExpr` / `boolVar := bitField` as compatible).
	if (lhs.toUpperCase() === "BIT") lhs = "BOOL";
	if (rhs.toUpperCase() === "BIT") rhs = "BOOL";
	if (lhs === rhs) return true;

	// Enum handling: lhs or rhs may be tagged with ENUM_PREFIX.
	const lhsIsEnum = lhs.startsWith(ENUM_PREFIX);
	const rhsIsEnum = rhs.startsWith(ENUM_PREFIX);

	if (lhsIsEnum || rhsIsEnum) {
		// Two different enum types → not assignable.
		if (lhsIsEnum && rhsIsEnum) return false;
		// Enum ↔ scalar: only reject BOOL, STRING, WSTRING, REAL/LREAL, TIME/DATE families.
		// TC allows integer↔enum but rejects the above. We stay conservative.
		const scalar = lhsIsEnum ? rhs : lhs;
		const ENUM_ISOLATED = new Set([
			"BOOL", "STRING", "WSTRING",
			"REAL", "LREAL",
			"TIME", "LTIME", "DATE", "LDATE", "TIME_OF_DAY", "TOD",
			"DATE_AND_TIME", "DT", "LDT", "LDATE_AND_TIME", "LTOD",
		]);
		return !ENUM_ISOLATED.has(scalar.toUpperCase());
	}

	// Non-enum path: resolve named types to check enum/struct kinds.
	// If LHS is a named type that resolves to enum, treat it like ENUM_PREFIX.
	const lhsSymbol = resolverLookup(scope, lhs);
	if (lhsSymbol !== undefined && lhsSymbol.symbol.typeExpr !== undefined) {
		const lhsKind = resolveTypeExpr(lhsSymbol.symbol.typeExpr, project).kind;
		if (lhsKind === "enum") {
			const ENUM_ISOLATED = new Set([
				"BOOL", "STRING", "WSTRING",
				"REAL", "LREAL",
				"TIME", "LTIME", "DATE", "LDATE", "TIME_OF_DAY", "TOD",
				"DATE_AND_TIME", "DT", "LDT", "LDATE_AND_TIME", "LTOD",
			]);
			return !ENUM_ISOLATED.has(rhs.toUpperCase());
		}
	}

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
	// REAL ↔ LREAL: assignable in both directions. LREAL→REAL is a "possible loss of information"
	// WARNING, not an error (the code compiles) — the narrowing-conversion check surfaces it. So the
	// assignment check must NOT error it here, or the site would double-report.
	if ((lhs === "REAL" && rhs === "LREAL") || (lhs === "LREAL" && rhs === "REAL")) return true;
	const lr = NUMERIC_RANK[lhs];
	const rr = NUMERIC_RANK[rhs];
	if (lr === undefined || rr === undefined) return true; // unknown — don't flag
	return rr <= lr;
}
