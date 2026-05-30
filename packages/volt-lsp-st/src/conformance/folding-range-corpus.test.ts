/**
 * Folding-range corpus: snapshot the foldable region list for every
 * ST construct in the conformance catalog. Position-free (whole-file
 * query). A regression that drops a fold or shifts a fold's range
 * lands as a per-test snapshot diff.
 */
import { describe, expect, it } from "bun:test";
import { parseSource } from "../parser/parser.js";
import { foldingRanges } from "../lsp/queries/folding-range.js";
import { ALL_TESTS } from "./index.js";

describe("foldingRange corpus (every conformance test)", () => {
	for (const t of ALL_TESTS) {
		it(t.name, () => {
			const parseResult = parseSource(t.source);
			expect(foldingRanges({ parseResult, source: t.source })).toMatchSnapshot();
		});
	}
});
