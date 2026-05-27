/**
 * Resolver tests: lookup() walks parent scopes; scanReferencesInBody
 * finds identifier occurrences with call-site / member-access flags.
 */
import { describe, expect, it } from "vitest";
import { parseSource } from "../parser/parser.js";
import type { FunctionBlock } from "../parser/ast.js";
import { buildSymbolTable, lookupLocal, type Scope } from "./symbol-table.js";
import {
	identifierAtOffset,
	lookup,
	scanReferencesInBody,
} from "./resolver.js";

function setup(src: string): { project: Scope; fb: FunctionBlock } {
	const result = parseSource(src);
	const project = buildSymbolTable([result]);
	const fb = result.units[0] as FunctionBlock;
	return { project, fb };
}

describe("resolver: lookup", () => {
	it("finds a local var in its own POU scope", () => {
		const { project } = setup(`
			FUNCTION_BLOCK FB_X
			VAR
				count : INT;
			END_VAR
			END_FUNCTION_BLOCK
		`);
		const fbScope = project.children[0] as Scope;
		const r = lookup(fbScope, "count");
		expect(r?.symbol.kind).toBe("var");
		expect(r?.symbol.name).toBe("count");
	});

	it("walks outward to find a project-level type from a POU scope", () => {
		const { project } = setup(`
			TYPE T_State : (Idle, Running) END_TYPE
		`);
		// Manufacture a child scope and look up the type from there.
		const childScope: Scope = {
			kind: "method",
			name: "fake",
			parent: project,
			symbols: new Map(),
			children: [],
		};
		const r = lookup(childScope, "T_State");
		expect(r?.symbol.kind).toBe("type");
	});

	it("is case-insensitive", () => {
		const { project } = setup(`FUNCTION_BLOCK FB_Foo END_FUNCTION_BLOCK`);
		expect(lookup(project, "FB_FOO")?.symbol.name).toBe("FB_Foo");
		expect(lookup(project, "fb_foo")?.symbol.name).toBe("FB_Foo");
	});

	it("returns undefined when not found", () => {
		const { project } = setup(`FUNCTION_BLOCK FB_X END_FUNCTION_BLOCK`);
		expect(lookup(project, "Nonexistent")).toBeUndefined();
	});

	it("inner scope shadows outer", () => {
		// project has FB_X; FB_X has a local "FB_X" var (unusual but legal-ish)
		const { project } = setup(`
			FUNCTION_BLOCK FB_X
			VAR
				FB_X : BOOL;
			END_VAR
			END_FUNCTION_BLOCK
		`);
		const fbScope = project.children[0] as Scope;
		// Inside FB_X scope, FB_X resolves to the local var, not the FB type.
		expect(lookup(fbScope, "FB_X")?.symbol.kind).toBe("var");
		// At project scope, it resolves to the FB.
		expect(lookup(project, "FB_X")?.symbol.kind).toBe("function_block");
	});
});

describe("resolver: scanReferencesInBody", () => {
	it("finds an identifier reference in a body", () => {
		const { fb } = setup(`
			FUNCTION_BLOCK FB_X
			VAR
				count : INT;
			END_VAR
				count := count + 1;
			END_FUNCTION_BLOCK
		`);
		const occs = scanReferencesInBody(fb.body, "count");
		// Body should contain `count := count + 1;` → two occurrences
		expect(occs).toHaveLength(2);
		expect(occs.every((o) => !o.isCall)).toBe(true);
	});

	it("classifies call sites", () => {
		const { fb } = setup(`
			FUNCTION_BLOCK FB_X
				Execute();
				count := 5;
			END_FUNCTION_BLOCK
		`);
		const execOccs = scanReferencesInBody(fb.body, "Execute");
		expect(execOccs).toHaveLength(1);
		expect(execOccs[0]?.isCall).toBe(true);
		const countOccs = scanReferencesInBody(fb.body, "count");
		expect(countOccs).toHaveLength(1);
		expect(countOccs[0]?.isCall).toBe(false);
	});

	it("classifies member access", () => {
		const { fb } = setup(`
			FUNCTION_BLOCK FB_X
				motor.Start();
				flag := obj.value;
			END_FUNCTION_BLOCK
		`);
		const start = scanReferencesInBody(fb.body, "Start");
		expect(start[0]?.isMemberAccess).toBe(true);
		expect(start[0]?.isCall).toBe(true);
		const value = scanReferencesInBody(fb.body, "value");
		expect(value[0]?.isMemberAccess).toBe(true);
	});

	it("is case-insensitive", () => {
		const { fb } = setup(`
			FUNCTION_BLOCK FB_X
				count := 1;
				COUNT := 2;
			END_FUNCTION_BLOCK
		`);
		const occs = scanReferencesInBody(fb.body, "count");
		expect(occs).toHaveLength(2);
	});

	it("skips trivia tokens between identifiers", () => {
		// The body contains comments — they shouldn't affect occurrence counts
		const { fb } = setup(`
			FUNCTION_BLOCK FB_X
				count := 0;  // initialize
				(* one block comment *)
				count := count + 1;
			END_FUNCTION_BLOCK
		`);
		const occs = scanReferencesInBody(fb.body, "count");
		expect(occs).toHaveLength(3);
	});
});

describe("resolver: identifierAtOffset", () => {
	it("returns the identifier covering the given offset", () => {
		const src = `FUNCTION_BLOCK FB_X
		count := 0;
		END_FUNCTION_BLOCK`;
		const { fb } = setup(src);
		const countOffset = src.indexOf("count");
		const t = identifierAtOffset(fb.body, countOffset);
		expect(t?.text).toBe("count");
	});

	it("returns undefined for whitespace positions", () => {
		const src = `FUNCTION_BLOCK FB_X
		   count := 0;
		END_FUNCTION_BLOCK`;
		const { fb } = setup(src);
		// First space inside the body
		const spaceOffset = src.indexOf("   count");
		const t = identifierAtOffset(fb.body, spaceOffset);
		expect(t).toBeUndefined();
	});
});
