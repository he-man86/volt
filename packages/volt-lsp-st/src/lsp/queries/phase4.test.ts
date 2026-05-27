/**
 * Bundled tests for Phase-4 queries: hover, workspace/symbol,
 * call hierarchy, type hierarchy.
 */
import { describe, expect, it } from "bun:test";
import { Workspace } from "../workspace.js";
import { hover } from "./hover.js";
import { workspaceSymbol } from "./workspace-symbol.js";
import {
	incomingCalls,
	outgoingCalls,
	prepareCallHierarchy,
} from "./call-hierarchy.js";
import {
	prepareTypeHierarchy,
	subtypes,
	supertypes,
} from "./type-hierarchy.js";
import { implementation } from "./implementation.js";

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

describe("hover", () => {
	it("reports the kind of a function block", () => {
		const ws = new Workspace();
		ws.openDocument("file:///fb.st", `FUNCTION_BLOCK FB_Motor END_FUNCTION_BLOCK`, 1);
		const result = hover({
			doc: ws.getDocument("file:///fb.st")!,
			position: positionOf(`FUNCTION_BLOCK FB_Motor END_FUNCTION_BLOCK`, "FB_Motor"),
			project: ws.getProjectScope(),
		});
		expect(result).not.toBeNull();
		expect(result?.contents.value).toContain("FUNCTION_BLOCK FB_Motor");
		expect(result?.contents.value).toContain("function block");
	});

	it("reports type for a var declaration", () => {
		const src = `FUNCTION_BLOCK FB_X
VAR
	count : INT;
END_VAR
END_FUNCTION_BLOCK`;
		const ws = new Workspace();
		ws.openDocument("file:///x.st", src, 1);
		const result = hover({
			doc: ws.getDocument("file:///x.st")!,
			position: positionOf(src, "count"),
			project: ws.getProjectScope(),
		});
		expect(result?.contents.value).toContain("count : INT");
	});

	it("returns null when no identifier under cursor", () => {
		const ws = new Workspace();
		ws.openDocument("file:///x.st", `FUNCTION_BLOCK FB_X END_FUNCTION_BLOCK`, 1);
		const result = hover({
			doc: ws.getDocument("file:///x.st")!,
			position: { line: 99, character: 99 },
			project: ws.getProjectScope(),
		});
		expect(result).toBeNull();
	});
});

describe("workspace/symbol", () => {
	it("finds FBs and types matching the query", () => {
		const ws = new Workspace();
		ws.openDocument("file:///a.st", `FUNCTION_BLOCK FB_Motor END_FUNCTION_BLOCK`, 1);
		ws.openDocument("file:///b.st", `FUNCTION_BLOCK FB_Pump END_FUNCTION_BLOCK`, 1);
		ws.openDocument("file:///c.st", `TYPE T_State : (Idle, Running) END_TYPE`, 1);
		const results = workspaceSymbol({
			workspace: ws,
			project: ws.getProjectScope(),
			query: "motor",
		});
		expect(results.map((r) => r.name)).toEqual(["FB_Motor"]);
		expect(results[0]?.location.uri).toBe("file:///a.st");
	});

	it("empty query returns all symbols", () => {
		const ws = new Workspace();
		ws.openDocument("file:///a.st", `FUNCTION_BLOCK FB_A END_FUNCTION_BLOCK`, 1);
		ws.openDocument("file:///b.st", `FUNCTION_BLOCK FB_B END_FUNCTION_BLOCK`, 1);
		const results = workspaceSymbol({
			workspace: ws,
			project: ws.getProjectScope(),
			query: "",
		});
		expect(results.length).toBeGreaterThanOrEqual(2);
	});

	it("substring + case-insensitive", () => {
		const ws = new Workspace();
		ws.openDocument("file:///a.st", `FUNCTION_BLOCK FB_HighSpeed END_FUNCTION_BLOCK`, 1);
		const results = workspaceSymbol({
			workspace: ws,
			project: ws.getProjectScope(),
			query: "SPEED",
		});
		expect(results.map((r) => r.name)).toContain("FB_HighSpeed");
	});
});

describe("call hierarchy", () => {
	it("prepare resolves to a method item", () => {
		const ws = new Workspace();
		ws.openDocument(
			"file:///m.st",
			`METHOD PUBLIC Execute : BOOL END_METHOD`,
			1,
		);
		const items = prepareCallHierarchy({
			doc: ws.getDocument("file:///m.st")!,
			position: positionOf(`METHOD PUBLIC Execute : BOOL END_METHOD`, "Execute"),
			project: ws.getProjectScope(),
		});
		expect(items).toHaveLength(1);
		expect(items[0]?.name).toBe("Execute");
	});

	it("incomingCalls finds callers across files", () => {
		const ws = new Workspace();
		ws.openDocument(
			"file:///helper.st",
			`METHOD PUBLIC Helper : BOOL END_METHOD`,
			1,
		);
		ws.openDocument(
			"file:///fb.st",
			`FUNCTION_BLOCK FB_X
	Helper();
	Helper();
END_FUNCTION_BLOCK`,
			1,
		);
		const item = prepareCallHierarchy({
			doc: ws.getDocument("file:///helper.st")!,
			position: positionOf(`METHOD PUBLIC Helper : BOOL END_METHOD`, "Helper"),
			project: ws.getProjectScope(),
		})[0]!;
		const incoming = incomingCalls({ workspace: ws, item });
		expect(incoming).toHaveLength(1);
		expect(incoming[0]?.from.name).toBe("FB_X");
		expect(incoming[0]?.fromRanges).toHaveLength(2);
	});

	it("outgoingCalls scans the body for call sites", () => {
		const ws = new Workspace();
		ws.openDocument(
			"file:///fb.st",
			`FUNCTION_BLOCK FB_Caller
	Helper();
	Other();
END_FUNCTION_BLOCK`,
			1,
		);
		ws.openDocument(
			"file:///helper.st",
			`METHOD Helper : BOOL END_METHOD`,
			1,
		);
		ws.openDocument(
			"file:///other.st",
			`METHOD Other : BOOL END_METHOD`,
			1,
		);
		const callerItem = prepareCallHierarchy({
			doc: ws.getDocument("file:///fb.st")!,
			position: positionOf(
				`FUNCTION_BLOCK FB_Caller
	Helper();
	Other();
END_FUNCTION_BLOCK`,
				"FB_Caller",
			),
			project: ws.getProjectScope(),
		})[0]!;
		const outgoing = outgoingCalls({
			workspace: ws,
			project: ws.getProjectScope(),
			item: callerItem,
		});
		expect(outgoing.map((o) => o.to.name).sort()).toEqual(["Helper", "Other"]);
	});
});

describe("type hierarchy", () => {
	it("prepare on FB returns item", () => {
		const ws = new Workspace();
		ws.openDocument("file:///fb.st", `FUNCTION_BLOCK FB_Motor END_FUNCTION_BLOCK`, 1);
		const items = prepareTypeHierarchy({
			doc: ws.getDocument("file:///fb.st")!,
			position: positionOf(`FUNCTION_BLOCK FB_Motor END_FUNCTION_BLOCK`, "FB_Motor"),
			project: ws.getProjectScope(),
		});
		expect(items[0]?.name).toBe("FB_Motor");
	});

	it("supertypes walks EXTENDS + IMPLEMENTS", () => {
		const ws = new Workspace();
		ws.openDocument(
			"file:///fb.st",
			`FUNCTION_BLOCK FB_Motor EXTENDS FB_Base IMPLEMENTS IFoo, IBar END_FUNCTION_BLOCK`,
			1,
		);
		ws.openDocument("file:///base.st", `FUNCTION_BLOCK FB_Base END_FUNCTION_BLOCK`, 1);
		ws.openDocument("file:///ifoo.st", `INTERFACE IFoo END_INTERFACE`, 1);
		ws.openDocument("file:///ibar.st", `INTERFACE IBar END_INTERFACE`, 1);
		const item = prepareTypeHierarchy({
			doc: ws.getDocument("file:///fb.st")!,
			position: positionOf(
				`FUNCTION_BLOCK FB_Motor EXTENDS FB_Base IMPLEMENTS IFoo, IBar END_FUNCTION_BLOCK`,
				"FB_Motor",
			),
			project: ws.getProjectScope(),
		})[0]!;
		const supers = supertypes({
			workspace: ws,
			project: ws.getProjectScope(),
			item,
		});
		expect(supers.map((s) => s.name).sort()).toEqual(["FB_Base", "IBar", "IFoo"]);
	});

	it("subtypes scans workspace for descendants", () => {
		const ws = new Workspace();
		ws.openDocument(
			"file:///base.st",
			`FUNCTION_BLOCK FB_Base END_FUNCTION_BLOCK`,
			1,
		);
		ws.openDocument(
			"file:///a.st",
			`FUNCTION_BLOCK FB_A EXTENDS FB_Base END_FUNCTION_BLOCK`,
			1,
		);
		ws.openDocument(
			"file:///b.st",
			`FUNCTION_BLOCK FB_B EXTENDS FB_Base END_FUNCTION_BLOCK`,
			1,
		);
		const item = prepareTypeHierarchy({
			doc: ws.getDocument("file:///base.st")!,
			position: positionOf(
				`FUNCTION_BLOCK FB_Base END_FUNCTION_BLOCK`,
				"FB_Base",
			),
			project: ws.getProjectScope(),
		})[0]!;
		const subs = subtypes({
			workspace: ws,
			project: ws.getProjectScope(),
			item,
		});
		expect(subs.map((s) => s.name).sort()).toEqual(["FB_A", "FB_B"]);
	});

	it("interface EXTENDS chain", () => {
		const ws = new Workspace();
		ws.openDocument(
			"file:///a.st",
			`INTERFACE IBase END_INTERFACE`,
			1,
		);
		ws.openDocument(
			"file:///b.st",
			`INTERFACE IDerived EXTENDS IBase END_INTERFACE`,
			1,
		);
		const item = prepareTypeHierarchy({
			doc: ws.getDocument("file:///b.st")!,
			position: positionOf(
				`INTERFACE IDerived EXTENDS IBase END_INTERFACE`,
				"IDerived",
			),
			project: ws.getProjectScope(),
		})[0]!;
		const supers = supertypes({
			workspace: ws,
			project: ws.getProjectScope(),
			item,
		});
		expect(supers.map((s) => s.name)).toEqual(["IBase"]);
	});
});

describe("textDocument/implementation", () => {
	it("returns every FB implementing the interface under the cursor", () => {
		const ws = new Workspace();
		const ifaceSrc = `INTERFACE IFoo END_INTERFACE`;
		ws.openDocument("file:///ifoo.st", ifaceSrc, 1);
		ws.openDocument(
			"file:///a.st",
			`FUNCTION_BLOCK FB_A IMPLEMENTS IFoo END_FUNCTION_BLOCK`,
			1,
		);
		ws.openDocument(
			"file:///b.st",
			`FUNCTION_BLOCK FB_B IMPLEMENTS IFoo, IBar END_FUNCTION_BLOCK`,
			1,
		);
		ws.openDocument(
			"file:///c.st",
			`FUNCTION_BLOCK FB_C IMPLEMENTS IBar END_FUNCTION_BLOCK`,
			1,
		);
		const locs = implementation({
			workspace: ws,
			doc: ws.getDocument("file:///ifoo.st")!,
			position: positionOf(ifaceSrc, "IFoo"),
			project: ws.getProjectScope(),
		});
		const uris = locs.map((l) => l.uri).sort();
		expect(uris).toEqual(["file:///a.st", "file:///b.st"]);
	});

	it("returns empty for an FB (not an interface)", () => {
		const ws = new Workspace();
		const src = `FUNCTION_BLOCK FB_X END_FUNCTION_BLOCK`;
		ws.openDocument("file:///x.st", src, 1);
		const locs = implementation({
			workspace: ws,
			doc: ws.getDocument("file:///x.st")!,
			position: positionOf(src, "FB_X"),
			project: ws.getProjectScope(),
		});
		expect(locs).toEqual([]);
	});

	it("returns empty when no FB implements the interface", () => {
		const ws = new Workspace();
		const src = `INTERFACE IOrphan END_INTERFACE`;
		ws.openDocument("file:///iorphan.st", src, 1);
		ws.openDocument(
			"file:///fb.st",
			`FUNCTION_BLOCK FB_Solo END_FUNCTION_BLOCK`,
			1,
		);
		const locs = implementation({
			workspace: ws,
			doc: ws.getDocument("file:///iorphan.st")!,
			position: positionOf(src, "IOrphan"),
			project: ws.getProjectScope(),
		});
		expect(locs).toEqual([]);
	});
});
