/**
 * VG (graphical) coverage for the LSP features that have NO `queries/vg/`
 * handler — they run off the generic ST path against the symbol table +
 * the BodyModel that a `NETWORK` body populates. These guard that call
 * hierarchy, document highlight, selection range, and code actions all
 * behave when the body is graphical, not just ST.
 */
import { describe, expect, it } from "bun:test";
import { parseSource } from "../../parser/parser.js";
import { buildSymbolTable } from "../../semantic/symbol-table-build.js";
import { buildBodyModelsForParseResult } from "../../semantic/body.js";
import { prepareCallHierarchy, incomingCalls, outgoingCalls } from "../../lsp/queries/call-hierarchy.js";
import { documentHighlight } from "../../lsp/queries/document-highlight.js";
import { selectionRanges } from "../../lsp/queries/selection-range.js";
import { codeActions } from "../../lsp/queries/code-action.js";
import type { Diagnostic } from "vscode-languageserver-protocol";
import type { Document, Workspace } from "../../lsp/workspace.js";

function ctx(src: string) {
	const parseResult = parseSource(src);
	const project = buildSymbolTable([{ uri: "file:///t.st", parseResult }]);
	const bodyModels = buildBodyModelsForParseResult(parseResult);
	const doc = { uri: "file:///t.st", source: src, version: 1, parseResult, bodyModels } as unknown as Document;
	const workspace = {
		allDocuments: () => [doc],
		getDocument: (uri: string) => (uri === doc.uri ? doc : undefined),
	} as unknown as Workspace;
	return { doc, project, workspace };
}

/** LSP position of the Nth occurrence (0-based) of `needle` in `src`. */
function posOf(src: string, needle: string, occurrence = 0): { line: number; character: number } {
	let idx = -1;
	for (let i = 0; i <= occurrence; i++) idx = src.indexOf(needle, idx + 1);
	const line = src.slice(0, idx).split("\n").length - 1;
	const character = idx - (src.lastIndexOf("\n", idx - 1) + 1);
	return { line, character };
}

// A FUNCTION called from a graphical (FBD) network — the call lives in a VG body (a box).
const CALLS = `FUNCTION F_Double : INT
VAR_INPUT
	x : INT;
END_VAR
F_Double := x * 2;
END_FUNCTION

FUNCTION_BLOCK FB_Caller
VAR
	n : INT;
	r : INT;
END_VAR
NETWORK 0 FBD
	r := F_Double(n);
END_NETWORK
END_FUNCTION_BLOCK`;

describe("vg shared features: call hierarchy", () => {
	it("incomingCalls finds the graphical-body caller of a function", () => {
		const { doc, project, workspace } = ctx(CALLS);
		const items = prepareCallHierarchy({ doc, position: posOf(CALLS, "F_Double(n)"), project });
		expect(items).toHaveLength(1);
		const incoming = incomingCalls({ workspace, item: items[0]! });
		expect(incoming.map((c) => c.from.name)).toContain("FB_Caller");
	});

	it("outgoingCalls finds the function called from a graphical body", () => {
		const { doc, project, workspace } = ctx(CALLS);
		const items = prepareCallHierarchy({ doc, position: posOf(CALLS, "FB_Caller"), project });
		expect(items).toHaveLength(1);
		const outgoing = outgoingCalls({ workspace, project, item: items[0]! });
		expect(outgoing.map((c) => c.to.name)).toContain("F_Double");
	});
});

// A wire used three times + a nested expression — for highlight + selection range.
const LOGIC = `FUNCTION_BLOCK FB_Logic
VAR
	a : BOOL;
	b : BOOL;
	c : BOOL;
	out : BOOL;
	out2 : BOOL;
END_VAR
NETWORK 0 FBD
	LET g1 := (a AND b);
	out  := (a OR c);
	out2 := (g1 AND c);
END_NETWORK
END_FUNCTION_BLOCK`;

describe("vg shared features: document highlight", () => {
	it("highlights a network-local wire across the network", () => {
		const { doc } = ctx(LOGIC);
		// g1 appears in `LET g1` and `(g1 AND c)` → 2, resolved via the same VG seam references uses.
		const hl = documentHighlight({ doc, position: posOf(LOGIC, "g1", 0) });
		expect(hl).toHaveLength(2);
	});

	it("highlights a real variable referenced inside the network", () => {
		const { doc } = ctx(LOGIC);
		// `a` is used twice in the graphical body (`a AND b`, `a OR c`).
		const hl = documentHighlight({ doc, position: posOf(LOGIC, "a OR") });
		expect(hl.length).toBeGreaterThanOrEqual(2);
	});
});

describe("vg shared features: selection range", () => {
	it("expands from an identifier in the network out to the POU", () => {
		const { doc } = ctx(LOGIC);
		const aPos = posOf(LOGIC, "a AND", 0);
		const [sel] = selectionRanges({ doc, positions: [aPos] });
		expect(sel).toBeDefined();
		// innermost range starts at the `a` identifier...
		expect(sel!.range.start.line).toBe(aPos.line);
		// ...and there is an outer range (the POU) to expand to.
		expect(sel!.parent).toBeDefined();
	});
});

// A `<id>^` deref on a non-pointer, inside a graphical body — a fixable diagnostic.
const DEREF = `FUNCTION_BLOCK FB_Deref
VAR
	flag : BOOL;
	out : BOOL;
END_VAR
NETWORK 0 FBD
	out := flag^;
END_NETWORK
END_FUNCTION_BLOCK`;

function rangeOf(src: string, needle: string) {
	const idx = src.indexOf(needle);
	const start = {
		line: src.slice(0, idx).split("\n").length - 1,
		character: idx - (src.lastIndexOf("\n", idx - 1) + 1),
	};
	return { start, end: { line: start.line, character: start.character + needle.length } };
}

describe("vg shared features: code action", () => {
	it("applies a quick-fix to a fixable diagnostic over graphical-body content", () => {
		// VG bodies themselves emit only structural codes (VG_BAD_EXPRESSION, vg-undefined-label),
		// none auto-fixable. The real code-action contract is: the client passes the diagnostics in
		// CodeActionParams and the server returns fixes. This guards that codeActions handles a
		// graphical-body document — here a deref-non-pointer over the network's `flag^`.
		const { doc, project } = ctx(DEREF);
		const range = rangeOf(DEREF, "flag^");
		const diag = { code: "deref-non-pointer", message: "'^' on a non-pointer", severity: 1, range } as Diagnostic;
		const actions = codeActions({
			doc,
			params: { textDocument: { uri: doc.uri }, range, context: { diagnostics: [diag] } },
			project,
		});
		expect(actions.length).toBeGreaterThan(0);
	});
});
