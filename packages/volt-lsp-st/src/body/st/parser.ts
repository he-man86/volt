/**
 * ST body parser — wraps the existing token-scan path so the rest
 * of the LSP can consume ST bodies through the same `BodyModel`
 * surface as graphical languages.
 *
 * In P1 this is purely an adapter: it forwards to the existing
 * `scanAllIdentifiersInBody` (`semantic/resolver.ts:109-125`)
 * so the output is bit-for-bit identical to what callers were
 * computing inline. In P2 the LSP queries migrate to read
 * `BodyModel.identifiers` instead of re-scanning, at which point
 * this adapter becomes the single source of truth for ST.
 */
import { scanAllIdentifiersInBody } from "../../semantic/resolver.js";
import type {
	BodyModel,
	BodyParser,
	BodyParseInput,
	CallSite,
	IdentifierRef,
} from "../types.js";

export const stBodyParser: BodyParser = {
	languageId: "structured-text",
	parse(input: BodyParseInput): BodyModel {
		const st = input.st;
		if (st === undefined) {
			// Invariant: `buildBodyModelsForParseResult` always passes
			// `st` for ST documents (it's pulled from the AST). If we
			// reach here, a caller has misrouted a non-ST body to the
			// ST parser — fail loud so the routing bug surfaces
			// instead of producing silent empty results.
			throw new Error(
				"stBodyParser invoked without BodyParseInput.st — route via buildBodyModel(languageId, ...) which forwards the AST's BodySpan",
			);
		}
		const occurrences = scanAllIdentifiersInBody(st);
		const identifiers: IdentifierRef[] = occurrences.map((o) => ({
			name: o.token.text,
			span: o.span,
			isCall: o.isCall,
			isMemberAccess: o.isMemberAccess,
		}));
		// Call sites are the subset where the next significant token
		// is `(` — already classified by scanAllIdentifiersInBody.
		const calls: CallSite[] = identifiers
			.filter((i) => i.isCall)
			.map((i) => ({ name: i.name, span: i.span }));
		return {
			languageId: "structured-text",
			span: st.span,
			identifiers,
			calls,
			st,
		};
	},
};
