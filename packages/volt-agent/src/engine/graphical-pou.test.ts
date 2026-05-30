/**
 * Disk-format round-trip tests for graphical POUs (FBD/LD/SFC/CFC).
 *
 * Pure data tests — no bridge required. Verify that the embed → parse
 * loop preserves both the textual declaration and the PLCopenXML body
 * byte-for-byte (modulo whitespace at the join points). This is the
 * round-trip contract push depends on.
 */
import { describe, expect, it } from "bun:test";
import { embedGraphicalBody, extractGraphicalBody } from "./graphical-pou.js";

const SAMPLE_DECL = `PROGRAM POU_X
VAR
	a: BOOL;
	b: BOOL;
END_VAR

END_PROGRAM
`;

const SAMPLE_BODY_NS = `<ns0:body xmlns:ns0="http://www.plcopen.org/xml/tc6_0200">
  <ns0:FBD>
    <ns0:inVariable localId="1">
      <ns0:expression>a</ns0:expression>
    </ns0:inVariable>
  </ns0:FBD>
</ns0:body>`;

const SAMPLE_BODY_DEFAULT_NS = `<body xmlns="http://www.plcopen.org/xml/tc6_0200">
  <FBD>
    <inVariable localId="1">
      <expression>a</expression>
    </inVariable>
  </FBD>
</body>`;

describe("graphical POU disk format", () => {
	it("embeds the body XML between END_VAR and END_PROGRAM", () => {
		const embedded = embedGraphicalBody(SAMPLE_DECL, SAMPLE_BODY_NS);
		// Body appears after END_VAR
		expect(embedded.indexOf(SAMPLE_BODY_NS)).toBeGreaterThan(
			embedded.indexOf("END_VAR"),
		);
		// Body appears before END_PROGRAM
		expect(embedded.indexOf(SAMPLE_BODY_NS)).toBeLessThan(
			embedded.indexOf("END_PROGRAM"),
		);
	});

	it("extracts decl + body from embedded form", () => {
		const embedded = embedGraphicalBody(SAMPLE_DECL, SAMPLE_BODY_NS);
		const parsed = extractGraphicalBody(embedded);
		expect(parsed).not.toBeNull();
		expect(parsed!.bodyXml).toBe(SAMPLE_BODY_NS);
		expect(parsed!.declarationText.trim()).toContain("PROGRAM POU_X");
		expect(parsed!.declarationText.trim()).toContain("END_PROGRAM");
	});

	it("handles default-namespace bodies (no ns: prefix)", () => {
		const embedded = embedGraphicalBody(SAMPLE_DECL, SAMPLE_BODY_DEFAULT_NS);
		const parsed = extractGraphicalBody(embedded);
		expect(parsed).not.toBeNull();
		expect(parsed!.bodyXml).toBe(SAMPLE_BODY_DEFAULT_NS);
	});

	it("round-trips byte-identical (embed → parse → embed)", () => {
		const first = embedGraphicalBody(SAMPLE_DECL, SAMPLE_BODY_NS);
		const parsed = extractGraphicalBody(first);
		expect(parsed).not.toBeNull();
		const second = embedGraphicalBody(parsed!.declarationText, parsed!.bodyXml);
		expect(second).toBe(first);
	});

	it("returns null when no body present (treat as plain ST)", () => {
		expect(extractGraphicalBody("PROGRAM Foo\nVAR x: BOOL; END_VAR\nx := TRUE;\nEND_PROGRAM\n")).toBeNull();
	});

	it("supports FUNCTION_BLOCK and FUNCTION end-markers", () => {
		const fbDecl = `FUNCTION_BLOCK FB_X
VAR_INPUT
	a: BOOL;
END_VAR

END_FUNCTION_BLOCK
`;
		const embedded = embedGraphicalBody(fbDecl, SAMPLE_BODY_NS);
		expect(embedded).toContain("END_FUNCTION_BLOCK");
		expect(embedded.indexOf(SAMPLE_BODY_NS)).toBeLessThan(
			embedded.indexOf("END_FUNCTION_BLOCK"),
		);
		const parsed = extractGraphicalBody(embedded);
		expect(parsed?.bodyXml).toBe(SAMPLE_BODY_NS);
	});
});
