/**
 * Body-language parser registry.
 *
 * Add a new body language by:
 *   1. Implementing a `BodyParser` under `body/<lang>/parser.ts`
 *   2. Registering it in the `bodyParsers` map below
 *
 * The LSP `workspace.ts` calls `buildBodyModel(languageId, ...)` to
 * route to the right parser based on the document's languageId.
 * Unknown languages fall back to the ST parser so behavior matches
 * the pre-dispatch era (zero regression risk).
 */
import type { BodySpan, TopLevel } from "../parser/ast.js";
import { fbdBodyParser } from "./fbd/parser.js";
import { stBodyParser } from "./st/parser.js";
import {
	BODY_LANGUAGE_IDS,
	type BodyLanguageId,
	type BodyModel,
	type BodyParseInput,
	type BodyParser,
	type IdentifierRef,
} from "./types.js";

export type {
	BodyLanguageId,
	BodyModel,
	BodyParseDiagnostic,
	BodyParser,
	BodyParseInput,
	CallSite,
	Connection,
	GraphBody,
	GraphicalBodyModel,
	GraphicalLanguageId,
	GraphNode,
	IdentifierRef,
	PortRef,
	STBodyModel,
} from "./types.js";
export { BODY_LANGUAGE_IDS, GRAPHICAL_LANGUAGE_IDS } from "./types.js";

/**
 * Registry: languageId → BodyParser. The set grows phase by phase
 * (P2 adds plc-fbd, P4 adds plc-ld/plc-sfc/plc-cfc). Until a
 * parser is registered for a language, `buildBodyModel` falls
 * through to ST so the file at least gets opened — graphical
 * features just won't fire.
 */
export const bodyParsers: Map<string, BodyParser> = new Map([
	["structured-text", stBodyParser],
	["plc-fbd", fbdBodyParser],
]);

/**
 * Pick the right parser for a languageId and produce a BodyModel.
 * Returns the ST parser's output when languageId is unknown — this
 * matches pre-P1 behavior (everything went through the ST path).
 */
export function buildBodyModel(
	languageId: string,
	input: BodyParseInput,
): BodyModel {
	const parser = bodyParsers.get(languageId) ?? stBodyParser;
	return parser.parse(input);
}

/**
 * Coerce an arbitrary string (e.g. `textDocument.languageId` from
 * the LSP client) to a known `BodyLanguageId`. Unknown values fall
 * back to `"structured-text"` — keeps the LSP open to misbehaving
 * clients while constraining the rest of the codebase to the
 * narrow union.
 */
export function coerceBodyLanguageId(value: string): BodyLanguageId {
	return (BODY_LANGUAGE_IDS as readonly string[]).includes(value)
		? (value as BodyLanguageId)
		: "structured-text";
}

/**
 * Walk a parse result and build a BodyModel for every body span it
 * contains (POU bodies, method bodies, action bodies, property
 * getter/setter bodies, nested-namespace contents recursively).
 *
 * Returns a Map keyed by BodySpan reference identity — callers
 * look up by the SAME object reference they got from the AST.
 *
 * Bodies with kind === "body" but zero tokens (declaration-only
 * POUs like INTERFACE / TYPE / GVL) skip the model build.
 */
export function buildBodyModelsForParseResult(
	languageId: string,
	source: string,
	parseResult: { units: readonly TopLevel[] },
): Map<BodySpan, BodyModel> {
	const out = new Map<BodySpan, BodyModel>();
	const visit = (units: readonly TopLevel[]): void => {
		for (const u of units) {
			const bodies = collectBodySpans(u);
			for (const body of bodies) {
				const model = buildBodyModel(languageId, {
					source,
					bodyRegion: { start: body.span.start, end: body.span.end },
					st: body,
				});
				out.set(body, model);
			}
			if (u.kind === "namespace") visit(u.units);
		}
	};
	visit(parseResult.units);
	return out;
}

/**
 * Convenience: every IdentifierRef in a BodyModel whose name
 * matches the given target (case-insensitive).
 *
 * Replaces the inline `scanReferencesInBody(body, name)` pattern
 * that LSP queries used to do — now driven by the language-
 * appropriate BodyModel, so the same query works for ST + FBD
 * (and LD/SFC/CFC after P4) without per-caller language branches.
 */
export function findIdentifiersByName(
	model: BodyModel,
	name: string,
): readonly IdentifierRef[] {
	const target = name.toLowerCase();
	return model.identifiers.filter((i) => i.name.toLowerCase() === target);
}

/** Return every BodySpan attached directly to a top-level unit
 *  (does NOT recurse into namespaces — caller handles that). */
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
