/**
 * FBD body fixtures — drive the graphical-to-ST transpiler tests.
 *
 * Each entry's `source` field contains a complete `.fbd` file
 * (declaration + embedded `<body><FBD>…</FBD></body>` block). The
 * transpiler test extracts the body XML and compares the resulting
 * ST against the snapshot.
 *
 * History: these were the LSP's FBD conformance fixtures. They moved
 * here when the LSP collapsed to ST-only (memory `st-only-workspace`).
 * The bodies stay as XML because that's still what the bridge sends —
 * the agent transpiles before writing to disk.
 */

/** Shape consumed by the transpiler tests. Minimal — only the fields
 *  the tests actually read. */
export interface GraphicalBodyFixture {
	name: string;
	feature: string;
	source: string;
	/** TC accepts this as a valid graphical body. False on negative
	 *  fixtures that we keep for parser-error testing. */
	expectTcAccepts: boolean;
	note?: string;
}
type LanguageTest = GraphicalBodyFixture & {
	pouName: string;
	kind: "function_block";
	fromDoc: string;
	plcPrgVar?: string;
	plcPrgBody?: string;
	recorderSkip?: boolean;
};

/**
 * Helper: assemble a graphical-POU file with empty VAR.
 *
 * Body shape uses the **CODESYS-flat** convention — elements sit
 * directly under `<FBD>` with no `<network>` wrapper. Per PLCopen
 * 2.01 XSD, `<network>` is allowed inside `<FBD>` (TwinCAT-style)
 * but NOT inside `<LD>`. To keep fixtures portable across both
 * vendors, we standardise on flat. Our body parser handles both
 * shapes (see `fbd-parser.ts:walkBody` for the `<network>` recursion),
 * so workspace round-tripping still works either way.
 */
function fbdProgram(name: string, bodyInner: string): string {
	return fbdProgramWithVar(name, "", bodyInner);
}

/** Helper: assemble a graphical-POU file with custom VAR content. */
function fbdProgramWithVar(name: string, varBody: string, bodyInner: string): string {
	return `FUNCTION_BLOCK ${name}
VAR
${varBody}END_VAR

<body xmlns="http://www.plcopen.org/xml/tc6_0200">
  <FBD>
${bodyInner}
  </FBD>
</body>

END_FUNCTION_BLOCK
`;
}

export const FBD_ELEMENT_TESTS: readonly LanguageTest[] = [
	// ────────────────────────────────────────────────────────────────────
	// Basic blocks (Box) — the most common authoring case.
	// ────────────────────────────────────────────────────────────────────

	{
		name: "fbd_box_and_two_inputs",
		pouName: "FB_LANG_fbd_box_and_two_inputs",
		kind: "function_block",
		feature: "FBD: AND block with two BOOL inputs wired to inVariables",
		fromDoc: "14-fbd-elements.md#box",
		expectTcAccepts: true,
		plcPrgVar: "fb_fbat : FB_LANG_fbd_box_and_two_inputs;",
		plcPrgBody: "fb_fbat();",
		source: fbdProgram(
			"FB_LANG_fbd_box_and_two_inputs",
			`      <inVariable localId="1">
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
      </block>`,
		),
	},

	{
		name: "fbd_assignment_output",
		pouName: "FB_LANG_fbd_assignment_output",
		kind: "function_block",
		feature: "FBD: outVariable receiving a literal — assignment shape",
		fromDoc: "14-fbd-elements.md#assignment",
		expectTcAccepts: true,
		plcPrgVar: "fb_fao : FB_LANG_fbd_assignment_output;",
		plcPrgBody: "fb_fao();",
		source: `FUNCTION_BLOCK FB_LANG_fbd_assignment_output
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
`,
	},

	{
		name: "fbd_fb_instance_call",
		pouName: "FB_LANG_fbd_fb_instance_call",
		kind: "function_block",
		feature: "FBD: instance call of a standard FB (R_TRIG) with instanceName",
		fromDoc: "14-fbd-elements.md#box",
		expectTcAccepts: true,
		plcPrgVar: "fb_ffic : FB_LANG_fbd_fb_instance_call;",
		plcPrgBody: "fb_ffic();",
		note: "Box with instanceName attribute = stateful FB instance (vs stateless operator like AND). R_TRIG is a built-in IEC FB.",
		source: `FUNCTION_BLOCK FB_LANG_fbd_fb_instance_call
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
`,
	},

	// ────────────────────────────────────────────────────────────────────
	// Network structure
	// ────────────────────────────────────────────────────────────────────

	{
		name: "fbd_empty_network",
		pouName: "FB_LANG_fbd_empty_network",
		kind: "function_block",
		feature: "FBD: empty network with no elements (degenerate but valid)",
		fromDoc: "14-fbd-elements.md#network",
		expectTcAccepts: true,
		plcPrgVar: "fb_fen : FB_LANG_fbd_empty_network;",
		plcPrgBody: "fb_fen();",
		note: "An FB with no graphical content is valid — the runtime behavior is the implicit body skeleton.",
		source: `FUNCTION_BLOCK FB_LANG_fbd_empty_network
VAR
END_VAR

<body xmlns="http://www.plcopen.org/xml/tc6_0200">
  <FBD>
  </FBD>
</body>

END_FUNCTION_BLOCK
`,
	},

	{
		name: "fbd_two_networks_stacked",
		pouName: "FB_LANG_fbd_two_networks_stacked",
		kind: "function_block",
		feature: "FBD: two <network> elements in sequence",
		fromDoc: "14-fbd-elements.md#network",
		expectTcAccepts: true,
		plcPrgVar: "fb_ftns : FB_LANG_fbd_two_networks_stacked;",
		plcPrgBody: "fb_ftns();",
		source: `FUNCTION_BLOCK FB_LANG_fbd_two_networks_stacked
VAR
	a : BOOL;
	b : BOOL;
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
        <expression>a</expression>
      </outVariable>
      <inVariable localId="3">
        <position x="0" y="0" />
        <connectionPointOut />
        <expression>FALSE</expression>
      </inVariable>
      <outVariable localId="4">
        <position x="0" y="0" />
        <connectionPointIn>
          <connection refLocalId="3" />
        </connectionPointIn>
        <expression>b</expression>
      </outVariable>
  </FBD>
</body>

END_FUNCTION_BLOCK
`,
	},

	// ────────────────────────────────────────────────────────────────────
	// Negative cases — sad paths the graphical diagnostic checks must catch.
	// ────────────────────────────────────────────────────────────────────

	{
		name: "fbd_dangling_connection_ref",
		pouName: "FB_LANG_fbd_dangling_connection_ref",
		kind: "function_block",
		recorderSkip: true,
		feature: "FBD: connection's refLocalId points at a non-existent node (must flag)",
		fromDoc: "14-fbd-elements.md#box",
		expectTcAccepts: false,
		plcPrgVar: "fb_fdcr : FB_LANG_fbd_dangling_connection_ref;",
		plcPrgBody: "fb_fdcr();",
		note: "Anchor for `_fbd/check-dangling-connection.ts`. AND's In1 connection refs localId 99 which doesn't exist.",
		source: fbdProgram(
			"FB_LANG_fbd_dangling_connection_ref",
			`      <inVariable localId="1">
        <position x="0" y="0" />
        <connectionPointOut />
        <expression>TRUE</expression>
      </inVariable>
      <block localId="2" typeName="AND">
        <position x="0" y="0" />
        <inputVariables>
          <variable formalParameter="In1">
            <connectionPointIn>
              <connection refLocalId="99" />
            </connectionPointIn>
          </variable>
          <variable formalParameter="In2">
            <connectionPointIn>
              <connection refLocalId="1" />
            </connectionPointIn>
          </variable>
        </inputVariables>
        <inOutVariables />
        <outputVariables>
          <variable formalParameter="Out1">
            <connectionPointOut />
          </variable>
        </outputVariables>
      </block>`,
		),
	},

	{
		name: "fbd_duplicate_local_id",
		pouName: "FB_LANG_fbd_duplicate_local_id",
		kind: "function_block",
		recorderSkip: true,
		feature: "FBD: two elements share localId=1 (must flag)",
		fromDoc: "14-fbd-elements.md#network",
		expectTcAccepts: false,
		plcPrgVar: "fb_fdli : FB_LANG_fbd_duplicate_local_id;",
		plcPrgBody: "fb_fdli();",
		note: "Anchor for `_fbd/check-duplicate-local-id.ts`. Two inVariables both use localId=1.",
		source: fbdProgram(
			"FB_LANG_fbd_duplicate_local_id",
			`      <inVariable localId="1">
        <position x="0" y="0" />
        <connectionPointOut />
        <expression>TRUE</expression>
      </inVariable>
      <inVariable localId="1">
        <position x="0" y="0" />
        <connectionPointOut />
        <expression>FALSE</expression>
      </inVariable>`,
		),
	},

	// ────────────────────────────────────────────────────────────────────
	// Boolean operators beyond AND
	// ────────────────────────────────────────────────────────────────────

	{
		name: "fbd_or_two_inputs",
		pouName: "FB_LANG_fbd_or_two_inputs",
		kind: "function_block",
		feature: "FBD: OR block",
		fromDoc: "14-fbd-elements.md#box",
		expectTcAccepts: true,
		plcPrgVar: "fb_fot : FB_LANG_fbd_or_two_inputs;",
		plcPrgBody: "fb_fot();",
		source: fbdProgram(
			"FB_LANG_fbd_or_two_inputs",
			`      <inVariable localId="1"><position x="0" y="0" /><connectionPointOut /><expression>TRUE</expression></inVariable>
      <inVariable localId="2"><position x="0" y="0" /><connectionPointOut /><expression>FALSE</expression></inVariable>
      <block localId="3" typeName="OR">
        <position x="0" y="0" />
        <inputVariables>
          <variable formalParameter="In1"><connectionPointIn><connection refLocalId="1" /></connectionPointIn></variable>
          <variable formalParameter="In2"><connectionPointIn><connection refLocalId="2" /></connectionPointIn></variable>
        </inputVariables>
        <inOutVariables />
        <outputVariables><variable formalParameter="Out1"><connectionPointOut /></variable></outputVariables>
      </block>`,
		),
	},

	{
		name: "fbd_not_unary",
		pouName: "FB_LANG_fbd_not_unary",
		kind: "function_block",
		feature: "FBD: NOT (unary boolean negation)",
		fromDoc: "14-fbd-elements.md#box",
		expectTcAccepts: true,
		plcPrgVar: "fb_fnu : FB_LANG_fbd_not_unary;",
		plcPrgBody: "fb_fnu();",
		source: fbdProgram(
			"FB_LANG_fbd_not_unary",
			`      <inVariable localId="1"><position x="0" y="0" /><connectionPointOut /><expression>TRUE</expression></inVariable>
      <block localId="2" typeName="NOT">
        <position x="0" y="0" />
        <inputVariables>
          <variable formalParameter="In"><connectionPointIn><connection refLocalId="1" /></connectionPointIn></variable>
        </inputVariables>
        <inOutVariables />
        <outputVariables><variable formalParameter="Out"><connectionPointOut /></variable></outputVariables>
      </block>`,
		),
	},

	{
		name: "fbd_xor_two_inputs",
		pouName: "FB_LANG_fbd_xor_two_inputs",
		kind: "function_block",
		feature: "FBD: XOR block",
		fromDoc: "14-fbd-elements.md#box",
		expectTcAccepts: true,
		plcPrgVar: "fb_fxt : FB_LANG_fbd_xor_two_inputs;",
		plcPrgBody: "fb_fxt();",
		source: fbdProgram(
			"FB_LANG_fbd_xor_two_inputs",
			`      <inVariable localId="1"><position x="0" y="0" /><connectionPointOut /><expression>TRUE</expression></inVariable>
      <inVariable localId="2"><position x="0" y="0" /><connectionPointOut /><expression>FALSE</expression></inVariable>
      <block localId="3" typeName="XOR">
        <position x="0" y="0" />
        <inputVariables>
          <variable formalParameter="In1"><connectionPointIn><connection refLocalId="1" /></connectionPointIn></variable>
          <variable formalParameter="In2"><connectionPointIn><connection refLocalId="2" /></connectionPointIn></variable>
        </inputVariables>
        <inOutVariables />
        <outputVariables><variable formalParameter="Out1"><connectionPointOut /></variable></outputVariables>
      </block>`,
		),
	},

	// ────────────────────────────────────────────────────────────────────
	// Arithmetic / numeric operators
	// ────────────────────────────────────────────────────────────────────

	{
		name: "fbd_add_int",
		pouName: "FB_LANG_fbd_add_int",
		kind: "function_block",
		feature: "FBD: ADD with INT literals — non-BOOL arithmetic",
		fromDoc: "14-fbd-elements.md#box",
		expectTcAccepts: true,
		plcPrgVar: "fb_fai : FB_LANG_fbd_add_int;",
		plcPrgBody: "fb_fai();",
		source: fbdProgramWithVar(
			"FB_LANG_fbd_add_int",
			"\tsum : INT;\n",
			`      <inVariable localId="1"><position x="0" y="0" /><connectionPointOut /><expression>INT#10</expression></inVariable>
      <inVariable localId="2"><position x="0" y="0" /><connectionPointOut /><expression>INT#20</expression></inVariable>
      <block localId="3" typeName="ADD">
        <position x="0" y="0" />
        <inputVariables>
          <variable formalParameter="In1"><connectionPointIn><connection refLocalId="1" /></connectionPointIn></variable>
          <variable formalParameter="In2"><connectionPointIn><connection refLocalId="2" /></connectionPointIn></variable>
        </inputVariables>
        <inOutVariables />
        <outputVariables><variable formalParameter="Out1"><connectionPointOut /></variable></outputVariables>
      </block>
      <outVariable localId="4"><position x="0" y="0" /><connectionPointIn><connection refLocalId="3" formalParameter="Out1" /></connectionPointIn><expression>sum</expression></outVariable>`,
		),
	},

	{
		name: "fbd_comparison_gt",
		pouName: "FB_LANG_fbd_comparison_gt",
		kind: "function_block",
		feature: "FBD: GT comparison — INT inputs, BOOL output",
		fromDoc: "14-fbd-elements.md#box",
		expectTcAccepts: true,
		plcPrgVar: "fb_fcg : FB_LANG_fbd_comparison_gt;",
		plcPrgBody: "fb_fcg();",
		source: fbdProgramWithVar(
			"FB_LANG_fbd_comparison_gt",
			"\tresult : BOOL;\n",
			`      <inVariable localId="1"><position x="0" y="0" /><connectionPointOut /><expression>INT#10</expression></inVariable>
      <inVariable localId="2"><position x="0" y="0" /><connectionPointOut /><expression>INT#5</expression></inVariable>
      <block localId="3" typeName="GT">
        <position x="0" y="0" />
        <inputVariables>
          <variable formalParameter="In1"><connectionPointIn><connection refLocalId="1" /></connectionPointIn></variable>
          <variable formalParameter="In2"><connectionPointIn><connection refLocalId="2" /></connectionPointIn></variable>
        </inputVariables>
        <inOutVariables />
        <outputVariables><variable formalParameter="Out1"><connectionPointOut /></variable></outputVariables>
      </block>
      <outVariable localId="4"><position x="0" y="0" /><connectionPointIn><connection refLocalId="3" formalParameter="Out1" /></connectionPointIn><expression>result</expression></outVariable>`,
		),
	},

	{
		name: "fbd_move_assignment",
		pouName: "FB_LANG_fbd_move_assignment",
		kind: "function_block",
		feature: "FBD: MOVE operator — explicit assignment block",
		fromDoc: "14-fbd-elements.md#box",
		expectTcAccepts: true,
		plcPrgVar: "fb_fma : FB_LANG_fbd_move_assignment;",
		plcPrgBody: "fb_fma();",
		source: fbdProgramWithVar(
			"FB_LANG_fbd_move_assignment",
			"\ttarget : INT;\n",
			`      <inVariable localId="1"><position x="0" y="0" /><connectionPointOut /><expression>INT#42</expression></inVariable>
      <block localId="2" typeName="MOVE">
        <position x="0" y="0" />
        <inputVariables>
          <variable formalParameter="In"><connectionPointIn><connection refLocalId="1" /></connectionPointIn></variable>
        </inputVariables>
        <inOutVariables />
        <outputVariables><variable formalParameter="Out"><connectionPointOut /></variable></outputVariables>
      </block>
      <outVariable localId="3"><position x="0" y="0" /><connectionPointIn><connection refLocalId="2" formalParameter="Out" /></connectionPointIn><expression>target</expression></outVariable>`,
		),
	},

	// ────────────────────────────────────────────────────────────────────
	// Standard FBs — stateful (require VAR declaration + instanceName)
	// ────────────────────────────────────────────────────────────────────

	{
		name: "fbd_sr_flipflop",
		pouName: "FB_LANG_fbd_sr_flipflop",
		kind: "function_block",
		feature: "FBD: SR set-dominant flip-flop",
		fromDoc: "14-fbd-elements.md#box",
		expectTcAccepts: true,
		plcPrgVar: "fb_fsf : FB_LANG_fbd_sr_flipflop;",
		plcPrgBody: "fb_fsf();",
		source: fbdProgramWithVar(
			"FB_LANG_fbd_sr_flipflop",
			"\tff : SR;\n",
			`      <inVariable localId="1"><position x="0" y="0" /><connectionPointOut /><expression>TRUE</expression></inVariable>
      <inVariable localId="2"><position x="0" y="0" /><connectionPointOut /><expression>FALSE</expression></inVariable>
      <block localId="3" typeName="SR" instanceName="ff">
        <position x="0" y="0" />
        <inputVariables>
          <variable formalParameter="SET1"><connectionPointIn><connection refLocalId="1" /></connectionPointIn></variable>
          <variable formalParameter="RESET"><connectionPointIn><connection refLocalId="2" /></connectionPointIn></variable>
        </inputVariables>
        <inOutVariables />
        <outputVariables><variable formalParameter="Q1"><connectionPointOut /></variable></outputVariables>
      </block>`,
		),
	},

	{
		name: "fbd_ton_timer",
		pouName: "FB_LANG_fbd_ton_timer",
		kind: "function_block",
		feature: "FBD: TON on-delay timer",
		fromDoc: "14-fbd-elements.md#box",
		expectTcAccepts: true,
		plcPrgVar: "fb_ftt : FB_LANG_fbd_ton_timer;",
		plcPrgBody: "fb_ftt();",
		source: fbdProgramWithVar(
			"FB_LANG_fbd_ton_timer",
			"\ttmr : TON;\n",
			`      <inVariable localId="1"><position x="0" y="0" /><connectionPointOut /><expression>TRUE</expression></inVariable>
      <inVariable localId="2"><position x="0" y="0" /><connectionPointOut /><expression>T#500MS</expression></inVariable>
      <block localId="3" typeName="TON" instanceName="tmr">
        <position x="0" y="0" />
        <inputVariables>
          <variable formalParameter="IN"><connectionPointIn><connection refLocalId="1" /></connectionPointIn></variable>
          <variable formalParameter="PT"><connectionPointIn><connection refLocalId="2" /></connectionPointIn></variable>
        </inputVariables>
        <inOutVariables />
        <outputVariables>
          <variable formalParameter="Q"><connectionPointOut /></variable>
          <variable formalParameter="ET"><connectionPointOut /></variable>
        </outputVariables>
      </block>`,
		),
	},

	{
		name: "fbd_ctu_counter",
		pouName: "FB_LANG_fbd_ctu_counter",
		kind: "function_block",
		feature: "FBD: CTU up-counter",
		fromDoc: "14-fbd-elements.md#box",
		expectTcAccepts: true,
		plcPrgVar: "fb_fcc : FB_LANG_fbd_ctu_counter;",
		plcPrgBody: "fb_fcc();",
		source: fbdProgramWithVar(
			"FB_LANG_fbd_ctu_counter",
			"\tcnt : CTU;\n",
			`      <inVariable localId="1"><position x="0" y="0" /><connectionPointOut /><expression>TRUE</expression></inVariable>
      <inVariable localId="2"><position x="0" y="0" /><connectionPointOut /><expression>FALSE</expression></inVariable>
      <inVariable localId="3"><position x="0" y="0" /><connectionPointOut /><expression>INT#10</expression></inVariable>
      <block localId="4" typeName="CTU" instanceName="cnt">
        <position x="0" y="0" />
        <inputVariables>
          <variable formalParameter="CU"><connectionPointIn><connection refLocalId="1" /></connectionPointIn></variable>
          <variable formalParameter="RESET"><connectionPointIn><connection refLocalId="2" /></connectionPointIn></variable>
          <variable formalParameter="PV"><connectionPointIn><connection refLocalId="3" /></connectionPointIn></variable>
        </inputVariables>
        <inOutVariables />
        <outputVariables>
          <variable formalParameter="Q"><connectionPointOut /></variable>
          <variable formalParameter="CV"><connectionPointOut /></variable>
        </outputVariables>
      </block>`,
		),
	},

	{
		name: "fbd_f_trig_edge",
		pouName: "FB_LANG_fbd_f_trig_edge",
		kind: "function_block",
		feature: "FBD: F_TRIG falling-edge detector",
		fromDoc: "14-fbd-elements.md#box",
		expectTcAccepts: true,
		plcPrgVar: "fb_ffe : FB_LANG_fbd_f_trig_edge;",
		plcPrgBody: "fb_ffe();",
		source: fbdProgramWithVar(
			"FB_LANG_fbd_f_trig_edge",
			"\ted : F_TRIG;\n",
			`      <inVariable localId="1"><position x="0" y="0" /><connectionPointOut /><expression>TRUE</expression></inVariable>
      <block localId="2" typeName="F_TRIG" instanceName="ed">
        <position x="0" y="0" />
        <inputVariables>
          <variable formalParameter="CLK"><connectionPointIn><connection refLocalId="1" /></connectionPointIn></variable>
        </inputVariables>
        <inOutVariables />
        <outputVariables><variable formalParameter="Q"><connectionPointOut /></variable></outputVariables>
      </block>`,
		),
	},

	// ────────────────────────────────────────────────────────────────────
	// Topology — chained blocks, fan-out, fan-in
	// ────────────────────────────────────────────────────────────────────

	{
		name: "fbd_chained_blocks",
		pouName: "FB_LANG_fbd_chained_blocks",
		kind: "function_block",
		feature: "FBD: output of AND wired into input of OR (chained operators)",
		fromDoc: "14-fbd-elements.md#box",
		expectTcAccepts: true,
		plcPrgVar: "fb_fcb : FB_LANG_fbd_chained_blocks;",
		plcPrgBody: "fb_fcb();",
		source: fbdProgram(
			"FB_LANG_fbd_chained_blocks",
			`      <inVariable localId="1"><position x="0" y="0" /><connectionPointOut /><expression>TRUE</expression></inVariable>
      <inVariable localId="2"><position x="0" y="0" /><connectionPointOut /><expression>FALSE</expression></inVariable>
      <inVariable localId="3"><position x="0" y="0" /><connectionPointOut /><expression>TRUE</expression></inVariable>
      <block localId="4" typeName="AND">
        <position x="0" y="0" />
        <inputVariables>
          <variable formalParameter="In1"><connectionPointIn><connection refLocalId="1" /></connectionPointIn></variable>
          <variable formalParameter="In2"><connectionPointIn><connection refLocalId="2" /></connectionPointIn></variable>
        </inputVariables>
        <inOutVariables />
        <outputVariables><variable formalParameter="Out1"><connectionPointOut /></variable></outputVariables>
      </block>
      <block localId="5" typeName="OR">
        <position x="0" y="0" />
        <inputVariables>
          <variable formalParameter="In1"><connectionPointIn><connection refLocalId="4" formalParameter="Out1" /></connectionPointIn></variable>
          <variable formalParameter="In2"><connectionPointIn><connection refLocalId="3" /></connectionPointIn></variable>
        </inputVariables>
        <inOutVariables />
        <outputVariables><variable formalParameter="Out1"><connectionPointOut /></variable></outputVariables>
      </block>`,
		),
	},

	{
		name: "fbd_fanout_one_source_two_consumers",
		pouName: "FB_LANG_fbd_fanout_one_source",
		kind: "function_block",
		feature: "FBD: one inVariable feeds two distinct block inputs (fan-out)",
		fromDoc: "14-fbd-elements.md#box",
		expectTcAccepts: true,
		plcPrgVar: "fb_ffo : FB_LANG_fbd_fanout_one_source;",
		plcPrgBody: "fb_ffo();",
		source: fbdProgram(
			"FB_LANG_fbd_fanout_one_source",
			`      <inVariable localId="1"><position x="0" y="0" /><connectionPointOut /><expression>TRUE</expression></inVariable>
      <inVariable localId="2"><position x="0" y="0" /><connectionPointOut /><expression>FALSE</expression></inVariable>
      <block localId="3" typeName="AND">
        <position x="0" y="0" />
        <inputVariables>
          <variable formalParameter="In1"><connectionPointIn><connection refLocalId="1" /></connectionPointIn></variable>
          <variable formalParameter="In2"><connectionPointIn><connection refLocalId="2" /></connectionPointIn></variable>
        </inputVariables>
        <inOutVariables />
        <outputVariables><variable formalParameter="Out1"><connectionPointOut /></variable></outputVariables>
      </block>
      <block localId="4" typeName="OR">
        <position x="0" y="0" />
        <inputVariables>
          <variable formalParameter="In1"><connectionPointIn><connection refLocalId="1" /></connectionPointIn></variable>
          <variable formalParameter="In2"><connectionPointIn><connection refLocalId="2" /></connectionPointIn></variable>
        </inputVariables>
        <inOutVariables />
        <outputVariables><variable formalParameter="Out1"><connectionPointOut /></variable></outputVariables>
      </block>`,
		),
	},

	{
		name: "fbd_block_to_outvar",
		pouName: "FB_LANG_fbd_block_to_outvar",
		kind: "function_block",
		feature: "FBD: block output → outVariable (canonical assign-result pattern)",
		fromDoc: "14-fbd-elements.md#assignment",
		expectTcAccepts: true,
		plcPrgVar: "fb_fbto : FB_LANG_fbd_block_to_outvar;",
		plcPrgBody: "fb_fbto();",
		source: fbdProgramWithVar(
			"FB_LANG_fbd_block_to_outvar",
			"\tresult : BOOL;\n",
			`      <inVariable localId="1"><position x="0" y="0" /><connectionPointOut /><expression>TRUE</expression></inVariable>
      <inVariable localId="2"><position x="0" y="0" /><connectionPointOut /><expression>FALSE</expression></inVariable>
      <block localId="3" typeName="AND">
        <position x="0" y="0" />
        <inputVariables>
          <variable formalParameter="In1"><connectionPointIn><connection refLocalId="1" /></connectionPointIn></variable>
          <variable formalParameter="In2"><connectionPointIn><connection refLocalId="2" /></connectionPointIn></variable>
        </inputVariables>
        <inOutVariables />
        <outputVariables><variable formalParameter="Out1"><connectionPointOut /></variable></outputVariables>
      </block>
      <outVariable localId="4"><position x="0" y="0" /><connectionPointIn><connection refLocalId="3" formalParameter="Out1" /></connectionPointIn><expression>result</expression></outVariable>`,
		),
	},

	// ────────────────────────────────────────────────────────────────────
	// Structural elements (control flow inside FBD)
	// ────────────────────────────────────────────────────────────────────

	{
		name: "fbd_return_statement",
		pouName: "FB_LANG_fbd_return_statement",
		kind: "function_block",
		feature: "FBD: <return> element ending a network conditional",
		fromDoc: "14-fbd-elements.md#return",
		expectTcAccepts: true,
		plcPrgVar: "fb_frs : FB_LANG_fbd_return_statement;",
		plcPrgBody: "fb_frs();",
		source: fbdProgram(
			"FB_LANG_fbd_return_statement",
			`      <inVariable localId="1"><position x="0" y="0" /><connectionPointOut /><expression>TRUE</expression></inVariable>
      <return localId="2">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="1" /></connectionPointIn>
      </return>`,
		),
	},

	{
		name: "fbd_jump_to_label",
		pouName: "FB_LANG_fbd_jump_to_label",
		kind: "function_block",
		feature: "FBD: <jump> targets a <label> in the same body",
		fromDoc: "14-fbd-elements.md#jump",
		expectTcAccepts: true,
		plcPrgVar: "fb_fjtl : FB_LANG_fbd_jump_to_label;",
		plcPrgBody: "fb_fjtl();",
		source: `FUNCTION_BLOCK FB_LANG_fbd_jump_to_label
VAR
END_VAR

<body xmlns="http://www.plcopen.org/xml/tc6_0200">
  <FBD>
      <inVariable localId="1"><position x="0" y="0" /><connectionPointOut /><expression>TRUE</expression></inVariable>
      <jump localId="2" label="L_end">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="1" /></connectionPointIn>
      </jump>
      <label localId="3" label="L_end">
        <position x="0" y="0" />
      </label>
  </FBD>
</body>

END_FUNCTION_BLOCK
`,
	},

	{
		name: "fbd_fb_undeclared_instance",
		pouName: "FB_LANG_fbd_fb_undeclared_instance",
		kind: "function_block",
		feature: "FBD: <block instanceName='undeclared_tmr'> with no matching VAR — must flag",
		fromDoc: "14-fbd-elements.md#box",
		expectTcAccepts: false,
		plcPrgVar: "fb_ffui : FB_LANG_fbd_fb_undeclared_instance;",
		plcPrgBody: "fb_ffui();",
		note: "Anchor for `check-unresolved-identifier.ts` picking up instanceName references.",
		source: `FUNCTION_BLOCK FB_LANG_fbd_fb_undeclared_instance
VAR
	declared_tmr : TON;
END_VAR

<body xmlns="http://www.plcopen.org/xml/tc6_0200">
  <FBD>
      <inVariable localId="1"><position x="0" y="0" /><connectionPointOut /><expression>TRUE</expression></inVariable>
      <inVariable localId="2"><position x="0" y="0" /><connectionPointOut /><expression>T#1S</expression></inVariable>
      <block localId="3" typeName="TON" instanceName="undeclared_tmr">
        <position x="0" y="0" />
        <inputVariables>
          <variable formalParameter="IN"><connectionPointIn><connection refLocalId="1" /></connectionPointIn></variable>
          <variable formalParameter="PT"><connectionPointIn><connection refLocalId="2" /></connectionPointIn></variable>
        </inputVariables>
        <inOutVariables />
        <outputVariables>
          <variable formalParameter="Q"><connectionPointOut /></variable>
          <variable formalParameter="ET"><connectionPointOut /></variable>
        </outputVariables>
      </block>
  </FBD>
</body>

END_FUNCTION_BLOCK
`,
	},

	{
		name: "fbd_jump_to_missing_label",
		pouName: "FB_LANG_fbd_jump_to_missing_label",
		kind: "function_block",
		feature: "FBD: <jump label=X> with no matching <label label=X> — must flag",
		fromDoc: "14-fbd-elements.md#jump",
		expectTcAccepts: false,
		plcPrgVar: "fb_fjtml : FB_LANG_fbd_jump_to_missing_label;",
		plcPrgBody: "fb_fjtml();",
		note: "Anchor for `_fbd/check-jump-target.ts`. The jump points at L_nonexistent.",
		source: `FUNCTION_BLOCK FB_LANG_fbd_jump_to_missing_label
VAR
END_VAR

<body xmlns="http://www.plcopen.org/xml/tc6_0200">
  <FBD>
      <inVariable localId="1"><position x="0" y="0" /><connectionPointOut /><expression>TRUE</expression></inVariable>
      <jump localId="2" label="L_nonexistent">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="1" /></connectionPointIn>
      </jump>
      <label localId="3" label="L_actual_target">
        <position x="0" y="0" />
      </label>
  </FBD>
</body>

END_FUNCTION_BLOCK
`,
	},

	// ────────────────────────────────────────────────────────────────────
	// Cross-cutting: language config + multi-VAR-section
	// ────────────────────────────────────────────────────────────────────

	{
		name: "fbd_var_input_output_sections",
		pouName: "FB_LANG_fbd_var_input_output_sections",
		kind: "function_block",
		feature: "FBD: POU with VAR_INPUT + VAR_OUTPUT sections, body wires them",
		fromDoc: "14-fbd-elements.md#box",
		expectTcAccepts: true,
		plcPrgVar: "fb_fvios : FB_LANG_fbd_var_input_output_sections;",
		plcPrgBody: "fb_fvios(en := TRUE);",
		source: `FUNCTION_BLOCK FB_LANG_fbd_var_input_output_sections
VAR_INPUT
	en : BOOL;
END_VAR
VAR_OUTPUT
	q : BOOL;
END_VAR
VAR
END_VAR

<body xmlns="http://www.plcopen.org/xml/tc6_0200">
  <FBD>
      <inVariable localId="1"><position x="0" y="0" /><connectionPointOut /><expression>en</expression></inVariable>
      <outVariable localId="2"><position x="0" y="0" /><connectionPointIn><connection refLocalId="1" /></connectionPointIn><expression>q</expression></outVariable>
  </FBD>
</body>

END_FUNCTION_BLOCK
`,
	},

	{
		name: "fbd_orphan_block",
		pouName: "FB_LANG_fbd_orphan_block",
		kind: "function_block",
		feature: "FBD: AND block with no wires — LSP warns, TC compiles",
		fromDoc: "14-fbd-elements.md#box",
		// TC accepts (orphan blocks compile cleanly — they're just
		// no-ops at runtime). The LSP's `_fbd/check-orphan-node` emits
		// a WARNING, not an error — code smell, not an error. So
		// `expectTcAccepts: true` is correct; the per-severity check
		// for orphans is locked in by `check-orphan-node.test.ts` at
		// the unit level.
		expectTcAccepts: true,
		plcPrgVar: "fb_fob : FB_LANG_fbd_orphan_block;",
		plcPrgBody: "fb_fob();",
		note: "Conformance anchor for the orphan check — TC accepts but LSP warns.",
		source: fbdProgram(
			"FB_LANG_fbd_orphan_block",
			`      <block localId="1" typeName="AND">
        <position x="0" y="0" />
        <inputVariables>
          <variable formalParameter="In1">
            <connectionPointIn />
          </variable>
          <variable formalParameter="In2">
            <connectionPointIn />
          </variable>
        </inputVariables>
        <inOutVariables />
        <outputVariables>
          <variable formalParameter="Out1">
            <connectionPointOut />
          </variable>
        </outputVariables>
      </block>`,
		),
	},
];
