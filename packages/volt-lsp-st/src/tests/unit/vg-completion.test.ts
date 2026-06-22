/**
 * Phase E tests — VG completion (pin names inside an FB-instance call)
 * and signature help (FB-instance + function calls).
 */
import { describe, expect, it } from "bun:test";
import { parseSource } from "../../parser/parser.js";
import { buildSymbolTable } from "../../semantic/symbol-table-build.js";
import { buildBodyModelsForParseResult } from "../../semantic/body.js";
import { completion } from "../../lsp/queries/completion.js";
import { signatureHelp } from "../../lsp/queries/signature-help.js";
import type { Document } from "../../lsp/workspace.js";

const SRC = `FUNCTION_BLOCK TON
VAR_INPUT
	IN : BOOL;
	PT : TIME;
END_VAR
VAR_OUTPUT
	Q : BOOL;
	ET : TIME;
END_VAR
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_Use
VAR
	t1 : TON;
	start : BOOL;
	pt : TIME;
	done : BOOL;
END_VAR
NETWORK 0 FBD
	t1(IN := start, PT := pt);
	done := t1.Q;
END_NETWORK
END_FUNCTION_BLOCK`;

function ctx(src: string) {
	const parseResult = parseSource(src);
	const project = buildSymbolTable([{ uri: "file:///t.st", parseResult }]);
	const bodyModels = buildBodyModelsForParseResult(parseResult);
	const doc = { uri: "file:///t.st", source: src, version: 1, parseResult, bodyModels } as unknown as Document;
	return { doc, project };
}

/** Position just after `needle` in `src`. */
function posAfter(src: string, needle: string): { line: number; character: number } {
	const idx = src.indexOf(needle) + needle.length;
	const line = src.slice(0, idx).split("\n").length - 1;
	const character = idx - (src.lastIndexOf("\n", idx - 1) + 1);
	return { line, character };
}

describe("vg completion: pin names", () => {
	it("offers FB input pins inside an instance call", () => {
		const { doc, project } = ctx(SRC);
		// cursor right after the `(` of `t1(`
		const items = completion({ doc, position: posAfter(SRC, "t1("), project });
		const labels = items.filter((i) => i.detail?.startsWith("pin")).map((i) => i.label);
		expect(labels).toContain("IN");
		expect(labels).toContain("PT");
	});
});

describe("vg signature help", () => {
	it("resolves an FB instance to its type's pins", () => {
		const { doc, project } = ctx(SRC);
		const sig = signatureHelp({ doc, position: posAfter(SRC, "t1("), project });
		expect(sig).not.toBeNull();
		expect(sig!.signatures[0]!.label).toContain("IN : BOOL");
		expect(sig!.signatures[0]!.label).toContain("PT : TIME");
	});

	it("advances active parameter past a comma", () => {
		const { doc, project } = ctx(SRC);
		const sig = signatureHelp({ doc, position: posAfter(SRC, "t1(IN := start, ") , project });
		expect(sig!.activeParameter).toBe(1);
	});
});
