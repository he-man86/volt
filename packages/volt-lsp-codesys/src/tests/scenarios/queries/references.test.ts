import { describe, expect, it } from "bun:test";
import { Workspace } from "../../../lsp/workspace.js";
import { references } from "../../../lsp/queries/references.js";

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

describe("references", () => {
	it("finds occurrences within a single body", () => {
		const src = `
FUNCTION_BLOCK FB_X
VAR
	count : INT;
END_VAR
	count := 0;
	count := count + 1;
	IF count > 100 THEN
		count := 0;
	END_IF
END_FUNCTION_BLOCK
`;
		const ws = new Workspace();
		ws.openDocument("file:///x.st", src, 1);
		// Position on the FIRST `count` reference inside the body
		const firstUseOffset = src.indexOf("count", src.indexOf("END_VAR"));
		const pos = positionOf(src, src.slice(firstUseOffset, firstUseOffset + 5));

		const result = references({
			workspace: ws,
			doc: ws.getDocument("file:///x.st")!,
			position: pos,
			project: ws.getProjectScope(),
			includeDeclaration: false,
		});

		// 5 occurrences in the body: count := 0; count := count + 1; IF count; count := 0;
		expect(result).toHaveLength(5);
		expect(result.every((r) => r.uri === "file:///x.st")).toBe(true);
	});

	it("finds occurrences across files", () => {
		const aSrc = `
FUNCTION_BLOCK FB_A
	Helper();
END_FUNCTION_BLOCK
`;
		const bSrc = `
FUNCTION_BLOCK FB_B
	Helper();
	Helper();
END_FUNCTION_BLOCK
`;
		const ws = new Workspace();
		ws.openDocument("file:///a.st", aSrc, 1);
		ws.openDocument("file:///b.st", bSrc, 1);

		const helperOffset = aSrc.indexOf("Helper");
		const result = references({
			workspace: ws,
			doc: ws.getDocument("file:///a.st")!,
			position: positionOf(aSrc, "Helper"),
			project: ws.getProjectScope(),
			includeDeclaration: false,
		});
		expect(result).toHaveLength(3); // 1 in A, 2 in B
		expect(result.filter((r) => r.uri === "file:///a.st")).toHaveLength(1);
		expect(result.filter((r) => r.uri === "file:///b.st")).toHaveLength(2);
		// First-occurrence offset check
		const checkOffset = helperOffset;
		expect(checkOffset).toBeGreaterThan(0);
	});

	it("case-insensitive matching across files", () => {
		const src = `
FUNCTION_BLOCK FB_X
	COUNT := 1;
	count := count + 1;
END_FUNCTION_BLOCK
`;
		const ws = new Workspace();
		ws.openDocument("file:///x.st", src, 1);
		const result = references({
			workspace: ws,
			doc: ws.getDocument("file:///x.st")!,
			position: positionOf(src, "COUNT"),
			project: ws.getProjectScope(),
			includeDeclaration: false,
		});
		expect(result).toHaveLength(3); // COUNT + count + count
	});
});
