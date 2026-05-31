/**
 * FBD body parser tests.
 *
 * Tests use a real CODESYS FBD export (the
 * F_SumComparison_FBD_short fixture from the user's reference
 * project) to lock in identifier extraction, call-site detection,
 * member-access qualifier chains, and graph-edge enumeration.
 *
 * "Don't reverse-engineer the contract from the parser" — every
 * assertion below traces to an observable element in the fixture
 * file, so changes that break expected behavior fail loudly.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { parseSource } from "../../parser/parser.js";
import { fbdBodyParser } from "./parser.js";
import { parseXml } from "./xml.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FIXTURE_DIR = join(HERE, "..", "..", "..", "conformance", "fixtures", "fbd");

function loadFixture(name: string): string {
	return readFileSync(join(FIXTURE_DIR, name), "utf8").replace(/^﻿/, "");
}

function locateBodyRegion(source: string): { start: number; end: number } {
	// The .fbd files have ST declaration on top, then `<body...>...</body>`,
	// then `END_FUNCTION` / `END_FUNCTION_BLOCK`. The body region is the
	// XML island. We use the same offset-based approach the LSP workspace
	// will use in P2's migration.
	const bodyOpen = source.indexOf("<body");
	const bodyClose = source.indexOf("</body>");
	if (bodyOpen < 0 || bodyClose < 0) {
		throw new Error("fixture missing <body>...</body>");
	}
	return { start: bodyOpen, end: bodyClose + "</body>".length };
}

describe("fbdBodyParser — F_SumComparison_FBD_short fixture", () => {
	const source = loadFixture("F_SumComparison_FBD_short.fbd");
	const bodyRegion = locateBodyRegion(source);
	const model = fbdBodyParser.parse({ source, bodyRegion });

	test("emits languageId='plc-fbd' and a graph", () => {
		expect(model.languageId).toBe("plc-fbd");
		expect(model.graph).toBeDefined();
	});

	test("no parse errors on real CODESYS export", () => {
		expect(model.graph?.parseDiagnostics).toEqual([]);
	});

	test("extracts every <expression> identifier (nInput1, nInput2, GVL_Basic.cSumComparisonLimit, return name)", () => {
		const names = model.identifiers.map((i) => i.name);
		expect(names).toContain("nInput1");
		expect(names).toContain("nInput2");
		// Member access: both qualifier and leaf are emitted.
		expect(names).toContain("GVL_Basic");
		expect(names).toContain("cSumComparisonLimit");
		// Return value assignment in outVariable
		expect(names).toContain("F_SumComparison_FBD_short");
	});

	test("classifies member access correctly (GVL_Basic.cSumComparisonLimit)", () => {
		const leaf = model.identifiers.find((i) => i.name === "cSumComparisonLimit");
		expect(leaf).toBeDefined();
		expect(leaf!.isMemberAccess).toBe(true);
		expect(leaf!.qualifier).toEqual(["GVL_Basic"]);

		const qualifier = model.identifiers.find((i) => i.name === "GVL_Basic");
		expect(qualifier).toBeDefined();
		expect(qualifier!.isMemberAccess).toBe(false);
	});

	test("extracts every <block typeName> as both an IdentifierRef (isCall=true) and a CallSite", () => {
		const callNames = model.calls.map((c) => c.name);
		expect(callNames).toContain("ADD");
		expect(callNames).toContain("GT");

		const add = model.identifiers.find((i) => i.name === "ADD");
		expect(add).toBeDefined();
		expect(add!.isCall).toBe(true);
	});

	test("call-site spans point at the typeName VALUE inside the quotes (not the opening <)", () => {
		const add = model.calls.find((c) => c.name === "ADD");
		expect(add).toBeDefined();
		const sliced = source.slice(add!.span.start, add!.span.end);
		expect(sliced).toBe("ADD");
	});

	test("identifier spans point at the identifier inside the <expression> (not the opening <expression>)", () => {
		const nInput1 = model.identifiers.find((i) => i.name === "nInput1");
		expect(nInput1).toBeDefined();
		const sliced = source.slice(nInput1!.span.start, nInput1!.span.end);
		expect(sliced).toBe("nInput1");
	});

	test("enumerates all graph nodes (4 in/out variables + 2 blocks + vendorElement skipped)", () => {
		const nodes = model.graph!.nodes;
		const inVars = nodes.filter((n) => n.kind === "inVariable");
		const outVars = nodes.filter((n) => n.kind === "outVariable");
		const blocks = nodes.filter((n) => n.kind === "block");
		expect(inVars.length).toBe(3); // nInput1, nInput2, GVL_Basic.c...
		expect(outVars.length).toBe(1); // F_SumComparison_FBD_short
		expect(blocks.length).toBe(2); // ADD, GT
	});

	test("captures block ports (inputs + outputs)", () => {
		const addBlock = model.graph!.nodes.find(
			(n) => n.kind === "block" && n.typeName === "ADD",
		);
		expect(addBlock).toBeDefined();
		const inputNames = addBlock!.inputs!.map((p) => p.formalParameter);
		expect(inputNames).toContain("In1");
		expect(inputNames).toContain("In2");
		const outputNames = addBlock!.outputs!.map((p) => p.formalParameter);
		expect(outputNames).toContain("Out1");
	});

	test("collects every connection refLocalId (data-flow edges)", () => {
		// The fixture has 5 connections: 2 into ADD, 1 from ADD's Out1
		// into GT.In1, 1 from inVariable(10000000004) into GT.In2, and
		// 1 from GT.Out1 into the outVariable.
		const conns = model.graph!.connections;
		expect(conns.length).toBe(5);
		// At least one connection carries a formalParameter for the
		// block-to-block edge (refLocalId from ADD's Out1 to GT.In1).
		const withFormal = conns.filter((c) => c.formalParameter !== undefined);
		expect(withFormal.length).toBeGreaterThan(0);
	});

	test("ignores vendor metadata (<vendorElement>, <addData>, <position>, <alternativeText>)", () => {
		const noiseNames = ["vendorElement", "addData", "position", "alternativeText"];
		for (const noise of noiseNames) {
			const present = model.graph!.nodes.some((n) => n.kind === (noise as never));
			expect(present).toBe(false);
		}
		// And no identifier text leaks from vendor metadata
		// (BoxInputFlagsSupported, BoxInputFlags, fbdcalltype, etc.)
		const idNames = model.identifiers.map((i) => i.name);
		expect(idNames).not.toContain("BoxInputFlagsSupported");
		expect(idNames).not.toContain("fbdcalltype");
		expect(idNames).not.toContain("OutputParamTypes");
	});
});

describe("fbdBodyParser — empty body region", () => {
	test("returns an empty model when the region contains no <body>", () => {
		const source = "no xml here just text";
		const model = fbdBodyParser.parse({
			source,
			bodyRegion: { start: 0, end: source.length },
		});
		expect(model.languageId).toBe("plc-fbd");
		expect(model.identifiers).toEqual([]);
		expect(model.calls).toEqual([]);
		expect(model.graph!.nodes).toEqual([]);
	});

	test("returns an empty model when <body> has no <FBD> child", () => {
		const source = '<body xmlns="..."><LD/></body>';
		const model = fbdBodyParser.parse({
			source,
			bodyRegion: { start: 0, end: source.length },
		});
		expect(model.graph!.nodes).toEqual([]);
	});
});

describe("xml reader — sanity", () => {
	test("parses minimal element + attrs", () => {
		const r = parseXml('<foo x="1"><bar/></foo>');
		expect(r.root?.tag).toBe("foo");
		expect(r.root?.attrs.x).toBe("1");
		expect(r.root?.children[0]?.tag).toBe("bar");
	});

	test("captures textSpan for leaf text", () => {
		const src = "<foo>nInput1</foo>";
		const r = parseXml(src);
		expect(r.root?.text).toBe("nInput1");
		expect(r.root?.textSpan).toBeDefined();
		expect(src.slice(r.root!.textSpan!.start, r.root!.textSpan!.end)).toBe(
			"nInput1",
		);
	});

	test("skips comments and processing instructions", () => {
		const r = parseXml('<?xml version="1.0"?><!-- ignore --><foo/>');
		expect(r.root?.tag).toBe("foo");
		expect(r.errors).toEqual([]);
	});

	test("decodes entities in text and attributes", () => {
		const r = parseXml('<foo x="a&amp;b">x&lt;y</foo>');
		expect(r.root?.attrs.x).toBe("a&b");
		expect(r.root?.text).toBe("x<y");
	});
});

describe("registry integration", () => {
	test("buildBodyModel routes 'plc-fbd' to fbdBodyParser", async () => {
		const { bodyParsers, buildBodyModel } = await import("../index.js");
		expect(bodyParsers.get("plc-fbd")).toBe(fbdBodyParser);

		const source = loadFixture("F_SumComparison_FBD_short.fbd");
		const bodyRegion = locateBodyRegion(source);
		const model = buildBodyModel("plc-fbd", { source, bodyRegion });
		expect(model.languageId).toBe("plc-fbd");
		expect(model.graph).toBeDefined();
	});

	test("the LSP workspace's parseSource still treats .fbd source on top correctly (declaration parses, body opaque)", () => {
		const source = loadFixture("F_SumComparison_FBD_short.fbd");
		const result = parseSource(source);
		// First top-level should be the FUNCTION declaration.
		const unit = result.units[0];
		expect(unit).toBeDefined();
		expect(unit!.kind).toBe("function");
	});
});
