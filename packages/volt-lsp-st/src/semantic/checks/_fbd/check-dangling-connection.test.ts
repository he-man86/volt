/**
 * Tests for `checkDanglingConnections` — FBD-specific diagnostic
 * that flags `<connection refLocalId="N">` referencing a node N
 * that doesn't exist in the body.
 */
import { describe, expect, test } from "bun:test";
import { fbdBodyParser } from "../../../body/fbd/parser.js";
import { spanFromOffsets } from "../../../lexer/span.js";
import type { BodySpan } from "../../../declarations/ast.js";
import { checkDanglingConnections } from "./check-dangling-connection.js";

function bodyFromSource(source: string) {
	// Locate the <body>...</body> region the same way the LSP would.
	const start = source.indexOf("<body");
	const end = source.indexOf("</body>") + "</body>".length;
	if (start < 0 || end < "</body>".length) {
		throw new Error("fixture missing <body>...</body>");
	}
	const model = fbdBodyParser.parse({
		source,
		bodyRegion: { start, end },
	});
	// Synthesize a fake BodySpan key — checkDanglingConnections only
	// walks values, doesn't use the key for anything.
	const fakeKey: BodySpan = {
		kind: "body",
		tokens: [],
		span: spanFromOffsets(source, start, end),
	};
	return new Map<BodySpan, typeof model>([[fakeKey, model]]);
}

describe("checkDanglingConnections", () => {
	test("clean FBD body — no diagnostics", () => {
		const source = `
<body xmlns="http://www.plcopen.org/xml/tc6_0200"><FBD>
  <inVariable localId="1"><connectionPointOut/><expression>a</expression></inVariable>
  <inVariable localId="2"><connectionPointOut/><expression>b</expression></inVariable>
  <block localId="3" typeName="ADD">
    <inputVariables>
      <variable formalParameter="In1"><connectionPointIn><connection refLocalId="1"/></connectionPointIn></variable>
      <variable formalParameter="In2"><connectionPointIn><connection refLocalId="2"/></connectionPointIn></variable>
    </inputVariables>
    <outputVariables><variable formalParameter="Out1"><connectionPointOut/></variable></outputVariables>
  </block>
</FBD></body>`;
		const bodies = bodyFromSource(source);
		const out: any[] = [];
		checkDanglingConnections(bodies, out);
		expect(out).toEqual([]);
	});

	test("dangling refLocalId — emits one diagnostic per bad connection", () => {
		const source = `
<body xmlns="http://www.plcopen.org/xml/tc6_0200"><FBD>
  <inVariable localId="1"><connectionPointOut/><expression>a</expression></inVariable>
  <block localId="3" typeName="ADD">
    <inputVariables>
      <variable formalParameter="In1"><connectionPointIn><connection refLocalId="1"/></connectionPointIn></variable>
      <variable formalParameter="In2"><connectionPointIn><connection refLocalId="999"/></connectionPointIn></variable>
    </inputVariables>
    <outputVariables><variable formalParameter="Out1"><connectionPointOut/></variable></outputVariables>
  </block>
</FBD></body>`;
		const bodies = bodyFromSource(source);
		const out: any[] = [];
		checkDanglingConnections(bodies, out);
		expect(out.length).toBe(1);
		expect(out[0].code).toBe("graphical-dangling-connection");
		expect(out[0].severity).toBe("error");
		expect(out[0].message).toContain('refLocalId="999"');
	});

	test("multiple dangling connections — one diagnostic each", () => {
		const source = `
<body xmlns="http://www.plcopen.org/xml/tc6_0200"><FBD>
  <block localId="3" typeName="ADD">
    <inputVariables>
      <variable formalParameter="In1"><connectionPointIn><connection refLocalId="998"/></connectionPointIn></variable>
      <variable formalParameter="In2"><connectionPointIn><connection refLocalId="999"/></connectionPointIn></variable>
    </inputVariables>
    <outputVariables><variable formalParameter="Out1"><connectionPointOut/></variable></outputVariables>
  </block>
</FBD></body>`;
		const bodies = bodyFromSource(source);
		const out: any[] = [];
		checkDanglingConnections(bodies, out);
		expect(out.length).toBe(2);
		const refs = out.map((d) => d.message);
		expect(refs.some((m) => m.includes('"998"'))).toBe(true);
		expect(refs.some((m) => m.includes('"999"'))).toBe(true);
	});

	test("diagnostic span points at the <connection> element (not the block)", () => {
		const source = `
<body xmlns="http://www.plcopen.org/xml/tc6_0200"><FBD>
  <block localId="3" typeName="ADD">
    <inputVariables>
      <variable formalParameter="In1"><connectionPointIn><connection refLocalId="999"/></connectionPointIn></variable>
    </inputVariables>
    <outputVariables><variable formalParameter="Out1"><connectionPointOut/></variable></outputVariables>
  </block>
</FBD></body>`;
		const bodies = bodyFromSource(source);
		const out: any[] = [];
		checkDanglingConnections(bodies, out);
		expect(out.length).toBe(1);
		const sliced = source.slice(out[0].span.start, out[0].span.end);
		expect(sliced).toContain("connection");
		expect(sliced).toContain("999");
	});

	test("ST bodies are skipped (no graph, can't have dangling connection)", () => {
		// stBodyParser produces languageId === 'structured-text'. The
		// check must short-circuit before touching `model.graph`
		// (which doesn't exist on STBodyModel).
		const fakeKey: BodySpan = {
			kind: "body",
			tokens: [],
			span: { start: 0, end: 0, startLine: 1, startCol: 0, endLine: 1, endCol: 0 },
		};
		const bodies = new Map<BodySpan, any>([
			[fakeKey, {
				languageId: "structured-text",
				span: fakeKey.span,
				identifiers: [],
				calls: [],
				st: fakeKey,
			}],
		]);
		const out: any[] = [];
		checkDanglingConnections(bodies, out);
		expect(out).toEqual([]);
	});
});
