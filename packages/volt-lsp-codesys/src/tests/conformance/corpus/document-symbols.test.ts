/**
 * Document-symbol corpus: snapshot the outline (`buildDocumentSymbols`)
 * for every ST construct in the conformance catalog. Catches regressions
 * where a parser change silently drops a symbol or restructures the
 * outline tree — a snapshot diff lands on the specific test whose ST
 * construct broke.
 *
 * Position-free: runs the query on whole `source`, no cursor positioning
 * needed. Pairs with `language.test.ts` (diagnostics-vs-TC) to cover the
 * outline shape side of the LSP surface.
 */
import { describe, expect, it } from "bun:test";
import { parseSource } from "../../../parser/parser.js";
import { buildDocumentSymbols } from "../../../lsp/queries/document-symbol.js";
import { ALL_TESTS } from "../fixtures/index.js";

describe("documentSymbol corpus (every conformance test)", () => {
	for (const t of ALL_TESTS) {
		it(t.name, () => {
			const symbols = buildDocumentSymbols(parseSource(t.source));
			expect(symbols).toMatchSnapshot();
		});
	}
});
