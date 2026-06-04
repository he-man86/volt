/**
 * Workspace-symbol corpus: per-test workspace search. For each catalog
 * entry, open the POU + PLC_PRG and run `workspaceSymbol` with the
 * test's pouName as the query. Verifies the index finds the entry
 * point of every documented ST construct.
 *
 * Snapshot per test: list of `{name, kind, file}` for each matched
 * symbol. A regression where workspace-symbol stops indexing a POU
 * kind (e.g. interface, GVL) surfaces here.
 */
import { describe, expect, it } from "bun:test";
import { workspaceSymbol } from "../../../lsp/queries/workspace-symbol.js";
import { buildCorpusWorkspace } from "../../_shared.js";
import { ALL_TESTS } from "../../fixtures/index.js";

describe("workspaceSymbol corpus (search by pouName)", () => {
	for (const t of ALL_TESTS) {
		it(t.name, () => {
			const { ws } = buildCorpusWorkspace(t);
			const matches = workspaceSymbol({
				workspace: ws,
				project: ws.getProjectScope(),
				query: t.pouName,
			});
			expect(
				matches.map((m) => ({
					name: m.name,
					kind: m.kind,
					file: m.location.uri.replace("file:///conformance/", ""),
				})),
			).toMatchSnapshot();
		});
	}
});
