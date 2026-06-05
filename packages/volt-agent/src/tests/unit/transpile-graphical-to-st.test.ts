/**
 * Transpiler snapshot tests — XML → ST per fixture.
 *
 * Phase 2A scope: operator blocks (AND/OR/NOT/ADD/GT/…), single-output
 * FB instance calls (R_TRIG/TON/…), basic LD rungs with modifiers.
 *
 * Each fixture's body XML is extracted from the .source field and
 * transpiled. Output is snapshotted via Bun's expect(snapshot).
 *
 * Failures here are EXPECTED for fixtures that exercise Phase 2B/2C
 * features (chained blocks, parallel branches, feedback loops). The
 * test asserts the result.ok flag — Phase 2A fixtures must succeed,
 * later-phase fixtures must fail loudly with a readable reason.
 */
import { describe, expect, test } from "bun:test";
import { transpileGraphicalBodyToST } from "../../engine/transpile-graphical-to-st.js";

// Inline fixtures so the test doesn't depend on the volt-lsp-st
// conformance package. These mirror a few key entries from
// `volt-lsp-st/src/conformance/fixtures/fbd-element.ts` and
// `ld-element.ts` — verbatim XML for the body part.

function bodyOf(fileSource: string): string {
	// Extract the <body>…</body> block from a fixture's full ST file.
	const m = fileSource.match(/<body[\s\S]*<\/body>/);
	if (m === null) throw new Error("fixture missing <body>");
	return m[0];
}

const FBD_AND_TWO_INPUTS = `FUNCTION_BLOCK FB
VAR
END_VAR

<body xmlns="http://www.plcopen.org/xml/tc6_0200">
  <FBD>
      <inVariable localId="1">
        <position x="0" y="0" />
        <connectionPointOut />
        <expression>TRUE</expression>
      </inVariable>
      <inVariable localId="2">
        <position x="0" y="0" />
        <connectionPointOut />
        <expression>FALSE</expression>
      </inVariable>
      <block localId="3" typeName="AND">
        <position x="0" y="0" />
        <inputVariables>
          <variable formalParameter="In1">
            <connectionPointIn>
              <connection refLocalId="1" />
            </connectionPointIn>
          </variable>
          <variable formalParameter="In2">
            <connectionPointIn>
              <connection refLocalId="2" />
            </connectionPointIn>
          </variable>
        </inputVariables>
        <inOutVariables />
        <outputVariables>
          <variable formalParameter="Out1">
            <connectionPointOut />
          </variable>
        </outputVariables>
      </block>
      <outVariable localId="4">
        <position x="0" y="0" />
        <connectionPointIn>
          <connection refLocalId="3" />
        </connectionPointIn>
        <expression>result</expression>
      </outVariable>
  </FBD>
</body>

END_FUNCTION_BLOCK
`;

const FBD_ASSIGNMENT_LITERAL = `FUNCTION_BLOCK FB
VAR
  result : BOOL;
END_VAR

<body xmlns="http://www.plcopen.org/xml/tc6_0200">
  <FBD>
      <inVariable localId="1">
        <position x="0" y="0" />
        <connectionPointOut />
        <expression>TRUE</expression>
      </inVariable>
      <outVariable localId="2">
        <position x="0" y="0" />
        <connectionPointIn>
          <connection refLocalId="1" />
        </connectionPointIn>
        <expression>result</expression>
      </outVariable>
  </FBD>
</body>

END_FUNCTION_BLOCK
`;

const FBD_FB_INSTANCE_CALL = `FUNCTION_BLOCK FB
VAR
  trig : R_TRIG;
END_VAR

<body xmlns="http://www.plcopen.org/xml/tc6_0200">
  <FBD>
      <inVariable localId="1">
        <position x="0" y="0" />
        <connectionPointOut />
        <expression>TRUE</expression>
      </inVariable>
      <block localId="2" typeName="R_TRIG" instanceName="trig">
        <position x="0" y="0" />
        <inputVariables>
          <variable formalParameter="CLK">
            <connectionPointIn>
              <connection refLocalId="1" />
            </connectionPointIn>
          </variable>
        </inputVariables>
        <inOutVariables />
        <outputVariables>
          <variable formalParameter="Q">
            <connectionPointOut />
          </variable>
        </outputVariables>
      </block>
  </FBD>
</body>

END_FUNCTION_BLOCK
`;

const FBD_MOVE_ASSIGNMENT = `FUNCTION_BLOCK FB
VAR
  target : INT;
END_VAR

<body xmlns="http://www.plcopen.org/xml/tc6_0200">
  <FBD>
      <inVariable localId="1">
        <position x="0" y="0" />
        <connectionPointOut />
        <expression>INT#42</expression>
      </inVariable>
      <block localId="2" typeName="MOVE">
        <position x="0" y="0" />
        <inputVariables>
          <variable formalParameter="In">
            <connectionPointIn>
              <connection refLocalId="1" />
            </connectionPointIn>
          </variable>
        </inputVariables>
        <inOutVariables />
        <outputVariables>
          <variable formalParameter="Out">
            <connectionPointOut />
          </variable>
        </outputVariables>
      </block>
      <outVariable localId="3">
        <position x="0" y="0" />
        <connectionPointIn>
          <connection refLocalId="2" formalParameter="Out" />
        </connectionPointIn>
        <expression>target</expression>
      </outVariable>
  </FBD>
</body>

END_FUNCTION_BLOCK
`;

const FBD_NOT_UNARY = `FUNCTION_BLOCK FB
VAR
END_VAR

<body xmlns="http://www.plcopen.org/xml/tc6_0200">
  <FBD>
      <inVariable localId="1">
        <position x="0" y="0" />
        <connectionPointOut />
        <expression>TRUE</expression>
      </inVariable>
      <block localId="2" typeName="NOT">
        <position x="0" y="0" />
        <inputVariables>
          <variable formalParameter="In">
            <connectionPointIn>
              <connection refLocalId="1" />
            </connectionPointIn>
          </variable>
        </inputVariables>
        <inOutVariables />
        <outputVariables>
          <variable formalParameter="Out">
            <connectionPointOut />
          </variable>
        </outputVariables>
      </block>
      <outVariable localId="3">
        <connectionPointIn>
          <connection refLocalId="2" />
        </connectionPointIn>
        <expression>result</expression>
      </outVariable>
  </FBD>
</body>

END_FUNCTION_BLOCK
`;

const LD_MINIMAL_RUNG = `FUNCTION_BLOCK FB
VAR
END_VAR

<body xmlns="http://www.plcopen.org/xml/tc6_0200">
  <LD>
    <leftPowerRail localId="1">
      <position x="0" y="0" />
      <connectionPointOut formalParameter="none" />
    </leftPowerRail>
    <contact localId="2">
      <position x="0" y="0" />
      <connectionPointIn>
        <connection refLocalId="1" />
      </connectionPointIn>
      <connectionPointOut />
      <variable>switch_a</variable>
    </contact>
    <coil localId="3">
      <position x="0" y="0" />
      <connectionPointIn>
        <connection refLocalId="2" />
      </connectionPointIn>
      <connectionPointOut />
      <variable>lamp_a</variable>
    </coil>
  </LD>
</body>

END_FUNCTION_BLOCK
`;

const LD_NEGATED_CONTACT = `FUNCTION_BLOCK FB
VAR
END_VAR

<body xmlns="http://www.plcopen.org/xml/tc6_0200">
  <LD>
    <leftPowerRail localId="1">
      <position x="0" y="0" />
      <connectionPointOut formalParameter="none" />
    </leftPowerRail>
    <contact localId="2" negated="true">
      <position x="0" y="0" />
      <connectionPointIn>
        <connection refLocalId="1" />
      </connectionPointIn>
      <connectionPointOut />
      <variable>stop</variable>
    </contact>
    <coil localId="3">
      <position x="0" y="0" />
      <connectionPointIn>
        <connection refLocalId="2" />
      </connectionPointIn>
      <connectionPointOut />
      <variable>run</variable>
    </coil>
  </LD>
</body>

END_FUNCTION_BLOCK
`;

const LD_SET_COIL = `FUNCTION_BLOCK FB
VAR
END_VAR

<body xmlns="http://www.plcopen.org/xml/tc6_0200">
  <LD>
    <leftPowerRail localId="1">
      <position x="0" y="0" />
      <connectionPointOut formalParameter="none" />
    </leftPowerRail>
    <contact localId="2">
      <position x="0" y="0" />
      <connectionPointIn>
        <connection refLocalId="1" />
      </connectionPointIn>
      <connectionPointOut />
      <variable>start_btn</variable>
    </contact>
    <coil localId="3" storage="set">
      <position x="0" y="0" />
      <connectionPointIn>
        <connection refLocalId="2" />
      </connectionPointIn>
      <connectionPointOut />
      <variable>running</variable>
    </coil>
  </LD>
</body>

END_FUNCTION_BLOCK
`;

const LD_SERIES_CONTACTS = `FUNCTION_BLOCK FB
VAR
END_VAR

<body xmlns="http://www.plcopen.org/xml/tc6_0200">
  <LD>
    <leftPowerRail localId="1">
      <position x="0" y="0" />
      <connectionPointOut formalParameter="none" />
    </leftPowerRail>
    <contact localId="2">
      <position x="0" y="0" />
      <connectionPointIn>
        <connection refLocalId="1" />
      </connectionPointIn>
      <connectionPointOut />
      <variable>a</variable>
    </contact>
    <contact localId="3">
      <position x="0" y="0" />
      <connectionPointIn>
        <connection refLocalId="2" />
      </connectionPointIn>
      <connectionPointOut />
      <variable>b</variable>
    </contact>
    <coil localId="4">
      <position x="0" y="0" />
      <connectionPointIn>
        <connection refLocalId="3" />
      </connectionPointIn>
      <connectionPointOut />
      <variable>out</variable>
    </coil>
  </LD>
</body>

END_FUNCTION_BLOCK
`;

describe("transpile FBD common cases", () => {
	test("AND with two inVariable inputs → outVariable", () => {
		const result = transpileGraphicalBodyToST(bodyOf(FBD_AND_TWO_INPUTS));
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.st).toMatchSnapshot();
	});

	test("inVariable literal → outVariable (pure assignment)", () => {
		const result = transpileGraphicalBodyToST(bodyOf(FBD_ASSIGNMENT_LITERAL));
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.st).toMatchSnapshot();
	});

	test("FB instance call (R_TRIG) — emits call statement", () => {
		const result = transpileGraphicalBodyToST(bodyOf(FBD_FB_INSTANCE_CALL));
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.st).toMatchSnapshot();
	});

	test("Unary NOT operator", () => {
		const result = transpileGraphicalBodyToST(bodyOf(FBD_NOT_UNARY));
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.st).toMatchSnapshot();
	});

	test("MOVE block collapses to plain assignment (passthrough, no fn call)", () => {
		// MOVE is FBD's visual assignment marker — its single input flows
		// unchanged to the output. In ST that's just `:=`, NOT `MOVE(x)`.
		// Per IEC 61131-3: "MOVE is the same as the assignment operator."
		const result = transpileGraphicalBodyToST(bodyOf(FBD_MOVE_ASSIGNMENT));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.st).toBe("target := INT#42;\n");
			expect(result.st).not.toContain("MOVE");
		}
	});
});

describe("transpile LD common cases", () => {
	test("minimal rung: contact → coil", () => {
		const result = transpileGraphicalBodyToST(bodyOf(LD_MINIMAL_RUNG));
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.st).toMatchSnapshot();
	});

	test("negated contact → coil", () => {
		const result = transpileGraphicalBodyToST(bodyOf(LD_NEGATED_CONTACT));
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.st).toMatchSnapshot();
	});

	test("set coil with single contact", () => {
		const result = transpileGraphicalBodyToST(bodyOf(LD_SET_COIL));
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.st).toMatchSnapshot();
	});

	test("series contacts (AND)", () => {
		const result = transpileGraphicalBodyToST(bodyOf(LD_SERIES_CONTACTS));
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.st).toMatchSnapshot();
	});
});

describe("transpile failure modes", () => {
	test("body with neither FBD nor LD → unknown bodyLanguage failure", () => {
		const result = transpileGraphicalBodyToST(`<body xmlns="http://www.plcopen.org/xml/tc6_0200"><SFC></SFC></body>`);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.bodyLanguage).toBe("unknown");
	});

	test("FBD outVariable with no incoming connection → fail", () => {
		const noIncoming = `<body xmlns="http://www.plcopen.org/xml/tc6_0200">
  <FBD>
    <outVariable localId="1">
      <position x="0" y="0" />
      <expression>result</expression>
    </outVariable>
  </FBD>
</body>`;
		const result = transpileGraphicalBodyToST(noIncoming);
		expect(result.ok).toBe(false);
	});
});

describe("determinism", () => {
	test("same input produces byte-identical output across N invocations", () => {
		const fixtures = [
			FBD_AND_TWO_INPUTS,
			FBD_ASSIGNMENT_LITERAL,
			FBD_FB_INSTANCE_CALL,
			LD_MINIMAL_RUNG,
			LD_NEGATED_CONTACT,
		];
		for (const fixture of fixtures) {
			const body = bodyOf(fixture);
			const first = transpileGraphicalBodyToST(body);
			for (let i = 0; i < 5; i++) {
				const next = transpileGraphicalBodyToST(body);
				expect(next).toEqual(first);
			}
		}
	});
});
