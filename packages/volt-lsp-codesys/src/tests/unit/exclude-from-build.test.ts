/**
 * The build-exclusion diagnostic gate: objects the IDE won't compile (excluded from build) have no
 * ground truth, so the LSP must skip SEMANTIC diagnostics on them (parse diagnostics still surface).
 * Exclusion is keyed by the item's full name (the URI basename), loaded from the pull sidecar.
 */
import { describe, expect, test } from "bun:test";
import { Workspace } from "../../lsp/workspace.js";
import { computeDiagnostics } from "../../lsp/server/diagnostics-push.js";

const uri = "file:///proj/src/Foo.prg";
const source = "PROGRAM Foo\nVAR\n\ta : INT;\nEND_VAR\na := undefinedThing;\nEND_PROGRAM\n"; // `undefinedThing` unresolved

describe("exclude-from-build diagnostic gate", () => {
	test("a built object is diagnosed", () => {
		const ws = new Workspace();
		ws.openDocument(uri, source, 1);
		expect(computeDiagnostics(ws, uri).some((d) => d.code === "unresolved-identifier")).toBe(true);
	});

	test("an excluded object gets no semantic diagnostics", () => {
		const ws = new Workspace();
		ws.openDocument(uri, source, 1);
		ws.setExcludedFromBuild(["Foo.prg"]); // matches the URI basename
		expect(computeDiagnostics(ws, uri).some((d) => d.code === "unresolved-identifier")).toBe(false);
	});
});
