/**
 * Body model — the LSP's view of a POU's body region.
 *
 * A body is either ST or VG ("Volt Graphical", the textual form of an
 * FBD/LD body — a distinct language routed by its `NETWORK` first
 * token; see `src/vg/`). This thin adapter turns a BodySpan (token
 * slice from the parser) into a `BodyModel` (the identifier + call
 * list every LSP query consumes), dispatching to the VG parser for VG
 * bodies and the ST scan otherwise.
 */
import type { BodySpan, TopLevel } from "../parser/ast.js";
import type { Span } from "../lexer/span.js";
import { scanAllIdentifiersInBody } from "./identifier-scan.js";
import { isVgBody, parseVgBody, type VgBody } from "../vg/index.js";
import { collectVgIdentifierRefs } from "../vg/identifiers.js";

// ─── Types ────────────────────────────────────────────────────────

export interface BodyModel {
	/** Full body region in source coordinates. */
	span: Span;
	/** Which sublanguage this body is. A POU body is `vg` when its first
	 *  significant token is `NETWORK` (a graphical FBD/LD body rendered as
	 *  VG text); otherwise `st`. The discriminator every query/check uses
	 *  to route a body to VG-aware logic. */
	language: "st" | "vg";
	/** Every name occurrence — drives references, highlight,
	 *  completion, and the unresolved-identifier diagnostic. For a VG
	 *  body these are only declaration-scope references (real vars / FB
	 *  instances / functions), never network-local wire names. */
	identifiers: IdentifierRef[];
	/** Subset of `identifiers` where the next significant token is
	 *  `(`. Drives call hierarchy. */
	calls: CallSite[];
	/** Raw token stream from the ST lexer. Required for ST-grammar
	 *  diagnostics (assignment-type-mismatch, conversion-source-
	 *  mismatch, etc.) that walk statement structure. */
	st: BodySpan;
	/** The parsed VG body — present only when `language === "vg"`. Drives
	 *  every VG query (tokens, hover, navigation, diagnostics, …). */
	vg?: VgBody;
}

export interface IdentifierRef {
	name: string;
	span: Span;
	/** True when the next significant token is `(`. */
	isCall: boolean;
	/** True when this ref is preceded by `.` (ST member access). */
	isMemberAccess: boolean;
	/**
	 * True when this identifier is the name-side of a named-parameter
	 * argument: `FB(paramName := value)` or `FB(paramName => dest)`.
	 * These names are not variable references — skip them in
	 * unresolved-identifier resolution.
	 */
	isNamedParam: boolean;
	/** The qualifier chain (`["fb"]` for `fb.method`). Undefined when
	 *  isMemberAccess is false. */
	qualifier?: string[];
}

export interface CallSite {
	name: string;
	span: Span;
	/** Best-effort guess at the target POU name for member calls
	 *  (`fb.method` → "method", where "fb" might be a known FB type). */
	targetGuess?: string;
}

// ─── Builder ──────────────────────────────────────────────────────

/**
 * Build a BodyModel from a body's token slice. `source` (the full
 * document text) lets a VG body capture opaque-leaf text exactly; it is
 * optional so unit tests can call this without the source.
 */
export function buildBodyModel(st: BodySpan, source?: string): BodyModel {
	if (isVgBody(st.tokens)) return buildVgBodyModel(st, source);

	const occurrences = scanAllIdentifiersInBody(st);
	const identifiers: IdentifierRef[] = occurrences.map((o) => ({
		name: o.token.text,
		span: o.span,
		isCall: o.isCall,
		isMemberAccess: o.isMemberAccess,
		isNamedParam: o.isNamedParam,
	}));
	const calls: CallSite[] = identifiers
		.filter((i) => i.isCall)
		.map((i) => ({ name: i.name, span: i.span }));
	return { span: st.span, language: "st", identifiers, calls, st };
}

/** Build a BodyModel for a VG (graphical) body — parse it and collect
 *  declaration-scope references from the AST. */
function buildVgBodyModel(st: BodySpan, source?: string): BodyModel {
	const vg = parseVgBody(st.tokens, source);
	const identifiers: IdentifierRef[] = collectVgIdentifierRefs(vg).map((r) => ({
		name: r.name,
		span: r.span,
		isCall: r.isCall,
		isMemberAccess: r.isMemberAccess,
		isNamedParam: r.isNamedParam,
		qualifier: r.qualifier,
	}));
	const calls: CallSite[] = identifiers.filter((i) => i.isCall).map((i) => ({ name: i.name, span: i.span }));
	return { span: st.span, language: "vg", identifiers, calls, st, vg };
}

/**
 * Walk a parse result and build a `BodyModel` for every body span
 * it contains (POU bodies, method bodies, action bodies, property
 * getter/setter bodies, namespaces recursively).
 *
 * Keyed by `BodySpan` reference identity — callers look up by the
 * same object reference they got from the AST.
 */
export function buildBodyModelsForParseResult(
	parseResult: { units: readonly TopLevel[] },
	source?: string,
): Map<BodySpan, BodyModel> {
	const out = new Map<BodySpan, BodyModel>();
	const visit = (units: readonly TopLevel[]): void => {
		for (const u of units) {
			for (const body of collectBodySpans(u)) {
				out.set(body, buildBodyModel(body, source));
			}
			if (u.kind === "namespace") visit(u.units);
		}
	};
	visit(parseResult.units);
	return out;
}

/**
 * Every IdentifierRef in a BodyModel whose name matches the given
 * target (case-insensitive).
 */
export function findIdentifiersByName(
	model: BodyModel,
	name: string,
): readonly IdentifierRef[] {
	const target = name.toLowerCase();
	return model.identifiers.filter((i) => i.name.toLowerCase() === target);
}

/** Every BodySpan attached directly to a top-level unit (does NOT
 *  recurse into namespaces — `buildBodyModelsForParseResult` handles
 *  that). */
function collectBodySpans(u: TopLevel): BodySpan[] {
	switch (u.kind) {
		case "function_block":
		case "program":
		case "function":
		case "method":
		case "action":
			return [u.body];
		case "property": {
			const out: BodySpan[] = [];
			if (u.getter !== undefined) out.push(u.getter.body);
			if (u.setter !== undefined) out.push(u.setter.body);
			return out;
		}
		default:
			return [];
	}
}
