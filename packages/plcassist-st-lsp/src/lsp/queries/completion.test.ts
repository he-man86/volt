/**
 * Unit tests for `textDocument/completion` and `completionItem/resolve`.
 */
import { describe, expect, it } from "vitest";
import { Workspace } from "../workspace.js";
import { completion, resolveCompletion } from "./completion.js";

function positionOf(src: string, marker: string) {
	const idx = src.indexOf(marker);
	if (idx < 0) throw new Error(`marker not found: ${marker}`);
	let line = 0;
	let col = 0;
	for (let i = 0; i < idx; i++) {
		if (src[i] === "\n") {
			line += 1;
			col = 0;
		} else {
			col += 1;
		}
	}
	return { line, character: col };
}

describe("completion: default context", () => {
	it("includes elementary type names", () => {
		const ws = new Workspace();
		ws.openDocument("file:///a.st", `FUNCTION_BLOCK FB_X\nVAR\n  x : ▎\nEND_VAR\nEND_FUNCTION_BLOCK`, 1);
		const items = completion({
			doc: ws.getDocument("file:///a.st")!,
			position: positionOf(`FUNCTION_BLOCK FB_X\nVAR\n  x : ▎\nEND_VAR\nEND_FUNCTION_BLOCK`, "▎"),
			project: ws.getProjectScope(),
		});
		expect(items.some((i) => i.label === "INT")).toBe(true);
		expect(items.some((i) => i.label === "BOOL")).toBe(true);
	});

	it("includes local symbols visible in scope", () => {
		const src = `FUNCTION_BLOCK FB_Y
VAR
\tmyVar : INT;
\totherVar : BOOL;
END_VAR
▎
END_FUNCTION_BLOCK`;
		const ws = new Workspace();
		ws.openDocument("file:///b.st", src, 1);
		const items = completion({
			doc: ws.getDocument("file:///b.st")!,
			position: positionOf(src, "▎"),
			project: ws.getProjectScope(),
		});
		expect(items.some((i) => i.label === "myVar")).toBe(true);
		expect(items.some((i) => i.label === "otherVar")).toBe(true);
	});
});

describe("completion: pragma-attribute context", () => {
	it("offers pragma names after `{attribute '`", () => {
		const src = `FUNCTION_BLOCK FB_X
{attribute '▎
END_FUNCTION_BLOCK`;
		const ws = new Workspace();
		ws.openDocument("file:///c.st", src, 1);
		const items = completion({
			doc: ws.getDocument("file:///c.st")!,
			position: positionOf(src, "▎"),
			project: ws.getProjectScope(),
		});
		expect(items.some((i) => i.label === "qualified_only")).toBe(true);
		expect(items.some((i) => i.label === "no_check")).toBe(true);
	});

	it("does NOT include local symbols in pragma context", () => {
		const src = `FUNCTION_BLOCK FB_X
VAR
\tmyVar : INT;
END_VAR
{attribute '▎
END_FUNCTION_BLOCK`;
		const ws = new Workspace();
		ws.openDocument("file:///d.st", src, 1);
		const items = completion({
			doc: ws.getDocument("file:///d.st")!,
			position: positionOf(src, "▎"),
			project: ws.getProjectScope(),
		});
		expect(items.some((i) => i.label === "myVar")).toBe(false);
	});
});

describe("completionItem/resolve", () => {
	it("fills in markdown documentation for a reference item", () => {
		const resolved = resolveCompletion({
			label: "INT",
			data: { source: "reference", refName: "INT" },
		});
		expect(resolved.documentation).toBeDefined();
		const doc = resolved.documentation as { kind: string; value: string };
		expect(doc.kind).toBe("markdown");
		expect(doc.value).toContain("INT");
	});

	it("respects showSource=false", () => {
		const resolved = resolveCompletion(
			{ label: "INT", data: { source: "reference", refName: "INT" } },
			{ showSource: false },
		);
		const doc = resolved.documentation as { kind: string; value: string };
		expect(doc.value).not.toContain("helpme-codesys.com");
	});
});
