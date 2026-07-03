/**
 * NAMESPACE-specific LSP unit tests.
 *
 * The bridge has no NAMESPACE POU kind so the conformance recorder
 * can't push a namespace `.st` file to TC — meaning the LSP code paths
 * for namespace name lookup, inner-unit recursion, and document-symbol
 * output stay uncovered if we rely on the catalog alone. These direct
 * unit tests close the loop without needing a live bridge.
 *
 * Targets specifically:
 *   - find-identifier.ts:141-151 (namespace dispatch + name + recursion)
 *   - document-symbol.ts:63-73 (namespace symbol building)
 *   - parser.ts namespace branches (already covered by parser.test.ts
 *     but exercised here too via parseSource)
 */
import { describe, expect, it } from "bun:test";
import { parseSource } from "../../../parser/parser.js";
import type { Namespace } from "../../../parser/ast.js";
import { Workspace } from "../../../lsp/workspace.js";
import { buildDocumentSymbols } from "../../../lsp/queries/document-symbol.js";
import { findIdentifierAtOffset } from "../../../lsp/identifier-at.js";

const NAMESPACE_SRC = `NAMESPACE LANG_MyNs

FUNCTION_BLOCK FB_NSChild
VAR
	x : INT;
END_VAR

END_FUNCTION_BLOCK

END_NAMESPACE
`;

describe("NAMESPACE: parser", () => {
	it("parses as a single namespace unit containing one inner FB", () => {
		const r = parseSource(NAMESPACE_SRC);
		expect(r.errors).toEqual([]);
		expect(r.units).toHaveLength(1);
		const ns = r.units[0] as Namespace;
		expect(ns.kind).toBe("namespace");
		expect(ns.name.text).toBe("LANG_MyNs");
		expect(ns.units).toHaveLength(1);
		expect(ns.units[0]?.kind).toBe("function_block");
	});
});

describe("NAMESPACE: documentSymbol", () => {
	it("produces a namespace symbol with the inner FB as a child", () => {
		const symbols = buildDocumentSymbols(parseSource(NAMESPACE_SRC));
		expect(symbols).toHaveLength(1);
		expect(symbols[0]?.name).toBe("LANG_MyNs");
		const children = symbols[0]?.children ?? [];
		expect(children.map((c) => c.name)).toContain("FB_NSChild");
	});
});

describe("NAMESPACE: findIdentifierAtOffset", () => {
	const parseResult = parseSource(NAMESPACE_SRC);

	it("matches on the namespace name itself", () => {
		const offset = NAMESPACE_SRC.indexOf("LANG_MyNs");
		const tok = findIdentifierAtOffset(parseResult, offset);
		expect(tok?.text).toBe("LANG_MyNs");
	});

	it("recurses into inner units to match the inner FB name", () => {
		const offset = NAMESPACE_SRC.indexOf("FB_NSChild");
		const tok = findIdentifierAtOffset(parseResult, offset);
		expect(tok?.text).toBe("FB_NSChild");
	});

	it("recurses further to match a var inside the inner FB", () => {
		// "x" appears at the var decl `x : INT;`
		const offset = NAMESPACE_SRC.indexOf("x : INT");
		const tok = findIdentifierAtOffset(parseResult, offset);
		expect(tok?.text).toBe("x");
	});
});

describe("NAMESPACE: Workspace open doesn't crash", () => {
	it("opens a namespace-containing document and builds a project scope", () => {
		const ws = new Workspace();
		ws.openDocument("file:///conformance/LANG_MyNs.st", NAMESPACE_SRC, 1);
		const project = ws.getProjectScope();
		// We're not asserting the exact symbol-table layout (which is an
		// implementation choice). Just that the project builds without
		// throwing and contains at least one entry — either a top-level
		// namespace symbol or its inner units flattened.
		const totalSymbols = [...project.symbols.values()].reduce((n, list) => n + list.length, 0);
		expect(totalSymbols + project.children.length).toBeGreaterThan(0);
	});
});
