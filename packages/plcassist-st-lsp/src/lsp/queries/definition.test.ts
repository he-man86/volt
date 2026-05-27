import { describe, expect, it } from "vitest";
import { Workspace } from "../workspace.js";
import { definition } from "./definition.js";
import { offsetFromPosition } from "../position.js";

function positionOf(src: string, marker: string) {
	const idx = src.indexOf(marker);
	if (idx < 0) throw new Error(`marker not found: ${marker}`);
	// translate offset back to line/character
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

describe("definition", () => {
	it("resolves a project-level type referenced in another FB's body to the defining file", () => {
		const src = `
FUNCTION_BLOCK FB_X
VAR
	state : E_State;
END_VAR
	state := E_State.Idle;
END_FUNCTION_BLOCK
`;
		const enumSrc = `TYPE E_State : (Idle, Running) END_TYPE`;
		const ws = new Workspace();
		ws.openDocument("file:///fb.st", src, 1);
		ws.openDocument("file:///e_state.st", enumSrc, 1);

		// Click on the second `E_State` (inside the body)
		const bodyOccurrence = src.indexOf("E_State", src.indexOf("END_VAR"));
		const pos = positionOf(src, src.slice(bodyOccurrence, bodyOccurrence + 7));

		const result = definition({
			doc: ws.getDocument("file:///fb.st")!,
			position: pos,
			project: ws.getProjectScope(),
		});

		expect(result.length).toBeGreaterThan(0);
		// Cross-file: the symbol was declared in e_state.st, not in fb.st.
		expect(result[0]?.uri).toBe("file:///e_state.st");
	});

	it("returns the same-file URI when the symbol IS declared in the requesting doc", () => {
		const src = `FUNCTION_BLOCK FB_Y
VAR
	count : INT;
END_VAR
	count := count + 1;
END_FUNCTION_BLOCK`;
		const ws = new Workspace();
		ws.openDocument("file:///y.st", src, 1);
		// Click on the second `count` (inside the body)
		const bodyOccurrence = src.indexOf("count", src.indexOf("END_VAR"));
		const pos = positionOf(src, src.slice(bodyOccurrence, bodyOccurrence + 5));
		const result = definition({
			doc: ws.getDocument("file:///y.st")!,
			position: pos,
			project: ws.getProjectScope(),
		});
		expect(result[0]?.uri).toBe("file:///y.st");
	});

	it("returns empty array when no identifier is at the cursor", () => {
		const ws = new Workspace();
		ws.openDocument("file:///x.st", `FUNCTION_BLOCK FB_X\n\tx := 1;\nEND_FUNCTION_BLOCK`, 1);
		const result = definition({
			doc: ws.getDocument("file:///x.st")!,
			position: { line: 0, character: 0 }, // on F of FUNCTION_BLOCK — not in a body
			project: ws.getProjectScope(),
		});
		expect(result).toEqual([]);
	});

	it("uses LSP 0-based positions correctly", () => {
		const src = `FUNCTION_BLOCK FB_X
\tcount := 1;
END_FUNCTION_BLOCK`;
		const ws = new Workspace();
		ws.openDocument("file:///x.st", src, 1);
		// "count" starts at line 1 column 1 (0-based), since the line begins with a tab.
		expect(offsetFromPosition(src, { line: 1, character: 1 })).toBe(src.indexOf("count"));
	});
});
