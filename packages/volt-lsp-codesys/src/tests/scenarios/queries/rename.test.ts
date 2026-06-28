/**
 * Rename query tests.
 *
 * Verifies that `rename` produces text edits covering the declaration
 * site (VAR / METHOD / FB / etc.) AND every body usage across the
 * workspace via the BodyModel scan. `prepareRename` is exercised with
 * both happy and unhappy inputs so the editor's pre-prompt path is
 * reliable.
 */
import { describe, expect, test } from "bun:test";
import { Workspace } from "../../../lsp/workspace.js";
import { rename, prepareRename } from "../../../lsp/queries/rename.js";

function makeWorkspace(): Workspace {
	const ws = new Workspace();
	return ws;
}

describe("rename — ST body across files", () => {
	test("renaming a global VAR updates declaration + every ST usage", () => {
		const ws = makeWorkspace();
		ws.openDocument(
			"file:///GVL.gvl",
			`VAR_GLOBAL
\tcounter: INT;
END_VAR
`,
			1,
			"plc-gvl",
		);
		ws.openDocument(
			"file:///PLC_PRG.st",
			`PROGRAM PLC_PRG
VAR
\tx: INT;
END_VAR
x := counter + 1;
counter := counter + x;
END_PROGRAM
`,
			1,
			"structured-text",
		);
		const doc = ws.getDocument("file:///GVL.gvl")!;
		const result = rename({
			workspace: ws,
			doc,
			// position the cursor on `counter` in the GVL declaration
			position: { line: 1, character: 2 },
			project: ws.getProjectScope(),
			newName: "tick",
		});
		expect(result).not.toBeNull();
		const changesByFile = result!.changes;
		const gvlEdits = changesByFile["file:///GVL.gvl"] ?? [];
		const stEdits = changesByFile["file:///PLC_PRG.st"] ?? [];
		// One declaration edit + 3 usages in PLC_PRG.
		expect(gvlEdits.length).toBe(1);
		expect(stEdits.length).toBe(3);
		expect(gvlEdits[0]!.newText).toBe("tick");
		expect(stEdits.every((e) => e.newText === "tick")).toBe(true);
	});
});

describe("prepareRename", () => {
	test("returns the identifier range at a renameable position", () => {
		const ws = makeWorkspace();
		const source = `PROGRAM P
VAR
\tname: INT;
END_VAR
END_PROGRAM
`;
		ws.openDocument("file:///P.st", source, 1, "structured-text");
		const doc = ws.getDocument("file:///P.st")!;
		const offset = source.indexOf("name");
		const pos = doc.textDocument.positionAt(offset);
		const r = prepareRename({ doc, position: pos });
		expect(r).not.toBeNull();
		expect(r!.start.line).toBe(pos.line);
	});

	test("returns null on whitespace", () => {
		const ws = makeWorkspace();
		ws.openDocument(
			"file:///P.st",
			"PROGRAM P\n\nEND_PROGRAM\n",
			1,
			"structured-text",
		);
		const doc = ws.getDocument("file:///P.st")!;
		const r = prepareRename({
			doc,
			position: { line: 1, character: 0 },
		});
		expect(r).toBeNull();
	});
});

describe("rename — edge cases", () => {
	test("returns null when newName is empty / whitespace", () => {
		const ws = makeWorkspace();
		ws.openDocument(
			"file:///P.st",
			"PROGRAM P\nVAR\n\tx: INT;\nEND_VAR\nEND_PROGRAM\n",
			1,
			"structured-text",
		);
		const doc = ws.getDocument("file:///P.st")!;
		const pos = doc.textDocument.positionAt(
			"PROGRAM P\nVAR\n\tx".length - 1,
		);
		const result = rename({
			workspace: ws,
			doc,
			position: pos,
			project: ws.getProjectScope(),
			newName: "   ",
		});
		expect(result).toBeNull();
	});

	test("returns null when newName == oldName (no-op rename)", () => {
		const ws = makeWorkspace();
		const source = "PROGRAM P\nVAR\n\tx: INT;\nEND_VAR\nEND_PROGRAM\n";
		ws.openDocument("file:///P.st", source, 1, "structured-text");
		const doc = ws.getDocument("file:///P.st")!;
		const pos = doc.textDocument.positionAt(source.indexOf("x:"));
		const result = rename({
			workspace: ws,
			doc,
			position: pos,
			project: ws.getProjectScope(),
			newName: "x",
		});
		expect(result).toBeNull();
	});
});
