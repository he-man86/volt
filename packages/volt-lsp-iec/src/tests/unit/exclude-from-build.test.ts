/**
 * The build-exclusion diagnostic gate: objects the IDE won't compile (excluded from build) have no
 * ground truth, so the LSP must skip SEMANTIC diagnostics on them (parse diagnostics still surface).
 * Exclusion is signalled by the in-file `(* @volt-exclude-from-build *)` marker (no side manifest).
 */
import { describe, expect, test } from "bun:test";
import { Workspace } from "../../lsp/workspace.js";
import { computeDiagnostics } from "../../lsp/server/diagnostics-push.js";
import { EXCLUDE_MARKER } from "../../semantic/exclude-marker.js";

const uri = "file:///proj/src/Foo.prg";
const source = "PROGRAM Foo\nVAR\n\ta : INT;\nEND_VAR\na := undefinedThing;\nEND_PROGRAM\n"; // `undefinedThing` unresolved

describe("exclude-from-build diagnostic gate", () => {
	test("a built object is diagnosed", () => {
		const ws = new Workspace();
		ws.openDocument(uri, source, 1);
		expect(computeDiagnostics(ws, uri).some((d) => d.code === "unresolved-identifier")).toBe(true);
	});

	test("an object marked excluded-from-build gets no semantic diagnostics", () => {
		const ws = new Workspace();
		ws.openDocument(uri, `${EXCLUDE_MARKER}\n${source}`, 1);
		expect(computeDiagnostics(ws, uri).some((d) => d.code === "unresolved-identifier")).toBe(false);
	});
});
