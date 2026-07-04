/**
 * Assignment-type-mismatch — for each `target := value;`, infers both
 * sides' types and emits an error when TC would refuse the assignment
 * (BOOL ↔ numeric, narrowing, STRING ↔ numeric, incompatible enums).
 *
 * Walks the statement AST (`st-body-ast`) and types each side via the
 * shared inference engine (`type-infer.ts`), so member/index/deref/call
 * operands are typed rather than skipped. A body that doesn't parse to a
 * clean tree is skipped (the treewalker is 100% on real code, so this
 * only affects genuinely malformed input). Conservative throughout — any
 * side that infers to `unknown` skips the check (never a false positive).
 */
import type { Expr, ParseResult } from "../../parser/ast.js";
import type { Scope } from "../symbol-table.js";
import { resolveTypeExpr } from "../type-resolver.js";
import { lookup as resolverLookup } from "../resolver.js";
import { parseStatements } from "../../parser/statements.js";
import { walkStatements } from "../../parser/ast-walk.js";
import { inferExprType } from "../type-infer.js";
import { type DiagnosticItem, getBody, findScopeForUnit } from "./_shared.js";

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
		if (!parsed.ok) continue; // body-AST is 100% on real code; skip a non-parsing body (conservative, zero-FP)
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

/** Sentinel prefix used in isAssignable to mark an enum type name. */
const ENUM_PREFIX = "__enum__:";

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
