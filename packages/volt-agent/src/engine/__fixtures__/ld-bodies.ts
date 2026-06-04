/**
 * LD body fixtures — drive the graphical-to-ST transpiler tests.
 * See sibling `fbd-bodies.ts` for the migration context.
 */
import type { GraphicalBodyFixture as LanguageTestBase } from "./fbd-bodies.js";
type LanguageTest = LanguageTestBase & {
	pouName: string;
	kind: "function_block";
	fromDoc: string;
	plcPrgVar?: string;
	plcPrgBody?: string;
	recorderSkip?: boolean;
};

/** Helper: assemble an LD POU file with custom VAR + one network. */
function ldProgramWithVar(name: string, varBody: string, bodyInner: string): string {
	return `FUNCTION_BLOCK ${name}
VAR
${varBody}END_VAR

<body xmlns="http://www.plcopen.org/xml/tc6_0200">
  <LD>
${bodyInner}
  </LD>
</body>

END_FUNCTION_BLOCK
`;
}

function ldProgram(name: string, bodyInner: string): string {
	return ldProgramWithVar(name, "", bodyInner);
}

export const LD_ELEMENT_TESTS: readonly LanguageTest[] = [
	// ────────────────────────────────────────────────────────────────────
	// Power rails — every LD rung needs a left rail (TRUE source) and
	// usually a right rail (sink). Coils between contact chains and the
	// right rail.
	// ────────────────────────────────────────────────────────────────────

	{
		name: "ld_minimal_rung",
		pouName: "FB_LANG_ld_minimal_rung",
		kind: "function_block",
		feature: "LD: minimal rung — left rail → contact → coil → right rail",
		fromDoc: "15-ld-elements.md#contact",
		expectTcAccepts: true,
		plcPrgVar: "fb_lmr : FB_LANG_ld_minimal_rung;",
		plcPrgBody: "fb_lmr();",
		source: ldProgramWithVar(
			"FB_LANG_ld_minimal_rung",
			"\tswitchA : BOOL;\n\tlampA : BOOL;\n",
			`      <leftPowerRail localId="1"><position x="0" y="0" /><connectionPointOut formalParameter="" /></leftPowerRail>
      <contact localId="2">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="1" /></connectionPointIn>
        <connectionPointOut />
        <variable>switchA</variable>
      </contact>
      <coil localId="3">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="2" /></connectionPointIn>
        <connectionPointOut />
        <variable>lampA</variable>
      </coil>
      <rightPowerRail localId="4">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="3" /></connectionPointIn>
      </rightPowerRail>`,
		),
	},

	{
		name: "ld_series_contacts",
		pouName: "FB_LANG_ld_series_contacts",
		kind: "function_block",
		feature: "LD: two contacts in series — AND logic",
		fromDoc: "15-ld-elements.md#contact",
		expectTcAccepts: true,
		plcPrgVar: "fb_lsc : FB_LANG_ld_series_contacts;",
		plcPrgBody: "fb_lsc();",
		source: ldProgramWithVar(
			"FB_LANG_ld_series_contacts",
			"\ta : BOOL;\n\tb : BOOL;\n\tout : BOOL;\n",
			`      <leftPowerRail localId="1"><position x="0" y="0" /><connectionPointOut formalParameter="" /></leftPowerRail>
      <contact localId="2">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="1" /></connectionPointIn>
        <connectionPointOut />
        <variable>a</variable>
      </contact>
      <contact localId="3">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="2" /></connectionPointIn>
        <connectionPointOut />
        <variable>b</variable>
      </contact>
      <coil localId="4">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="3" /></connectionPointIn>
        <connectionPointOut />
        <variable>out</variable>
      </coil>
      <rightPowerRail localId="5"><position x="0" y="0" /><connectionPointIn><connection refLocalId="4" /></connectionPointIn></rightPowerRail>`,
		),
	},

	// ────────────────────────────────────────────────────────────────────
	// Negated contact (open if variable is TRUE)
	// ────────────────────────────────────────────────────────────────────

	{
		name: "ld_negated_contact",
		pouName: "FB_LANG_ld_negated_contact",
		kind: "function_block",
		feature: "LD: negated contact — `negated=\"true\"` attribute",
		fromDoc: "15-ld-elements.md#contact",
		expectTcAccepts: true,
		plcPrgVar: "fb_lnc : FB_LANG_ld_negated_contact;",
		plcPrgBody: "fb_lnc();",
		source: ldProgramWithVar(
			"FB_LANG_ld_negated_contact",
			"\tswitchA : BOOL;\n\tlampA : BOOL;\n",
			`      <leftPowerRail localId="1"><position x="0" y="0" /><connectionPointOut formalParameter="" /></leftPowerRail>
      <contact localId="2" negated="true">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="1" /></connectionPointIn>
        <connectionPointOut />
        <variable>switchA</variable>
      </contact>
      <coil localId="3">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="2" /></connectionPointIn>
        <connectionPointOut />
        <variable>lampA</variable>
      </coil>
      <rightPowerRail localId="4"><position x="0" y="0" /><connectionPointIn><connection refLocalId="3" /></connectionPointIn></rightPowerRail>`,
		),
	},

	{
		name: "ld_rising_edge_contact",
		pouName: "FB_LANG_ld_rising_edge_contact",
		kind: "function_block",
		feature: "LD: rising-edge contact — `edge=\"rising\"` attribute",
		fromDoc: "15-ld-elements.md#contact",
		expectTcAccepts: true,
		plcPrgVar: "fb_lrec : FB_LANG_ld_rising_edge_contact;",
		plcPrgBody: "fb_lrec();",
		source: ldProgramWithVar(
			"FB_LANG_ld_rising_edge_contact",
			"\tbtn : BOOL;\n\tpulse : BOOL;\n",
			`      <leftPowerRail localId="1"><position x="0" y="0" /><connectionPointOut formalParameter="" /></leftPowerRail>
      <contact localId="2" edge="rising">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="1" /></connectionPointIn>
        <connectionPointOut />
        <variable>btn</variable>
      </contact>
      <coil localId="3">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="2" /></connectionPointIn>
        <connectionPointOut />
        <variable>pulse</variable>
      </coil>
      <rightPowerRail localId="4"><position x="0" y="0" /><connectionPointIn><connection refLocalId="3" /></connectionPointIn></rightPowerRail>`,
		),
	},

	{
		name: "ld_falling_edge_contact",
		pouName: "FB_LANG_ld_falling_edge_contact",
		kind: "function_block",
		feature: "LD: falling-edge contact — `edge=\"falling\"` attribute",
		fromDoc: "15-ld-elements.md#contact",
		expectTcAccepts: true,
		plcPrgVar: "fb_lfec : FB_LANG_ld_falling_edge_contact;",
		plcPrgBody: "fb_lfec();",
		source: ldProgramWithVar(
			"FB_LANG_ld_falling_edge_contact",
			"\tswitch : BOOL;\n\trelease : BOOL;\n",
			`      <leftPowerRail localId="1"><position x="0" y="0" /><connectionPointOut formalParameter="" /></leftPowerRail>
      <contact localId="2" edge="falling">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="1" /></connectionPointIn>
        <connectionPointOut />
        <variable>switch</variable>
      </contact>
      <coil localId="3">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="2" /></connectionPointIn>
        <connectionPointOut />
        <variable>release</variable>
      </coil>
      <rightPowerRail localId="4"><position x="0" y="0" /><connectionPointIn><connection refLocalId="3" /></connectionPointIn></rightPowerRail>`,
		),
	},

	// ────────────────────────────────────────────────────────────────────
	// Coil variants
	// ────────────────────────────────────────────────────────────────────

	{
		name: "ld_negated_coil",
		pouName: "FB_LANG_ld_negated_coil",
		kind: "function_block",
		feature: "LD: negated coil — writes the inverse of rung state",
		fromDoc: "15-ld-elements.md#coil",
		expectTcAccepts: true,
		plcPrgVar: "fb_lneg : FB_LANG_ld_negated_coil;",
		plcPrgBody: "fb_lneg();",
		source: ldProgramWithVar(
			"FB_LANG_ld_negated_coil",
			"\tactive : BOOL;\n\tinactive : BOOL;\n",
			`      <leftPowerRail localId="1"><position x="0" y="0" /><connectionPointOut formalParameter="" /></leftPowerRail>
      <contact localId="2">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="1" /></connectionPointIn>
        <connectionPointOut />
        <variable>active</variable>
      </contact>
      <coil localId="3" negated="true">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="2" /></connectionPointIn>
        <connectionPointOut />
        <variable>inactive</variable>
      </coil>
      <rightPowerRail localId="4"><position x="0" y="0" /><connectionPointIn><connection refLocalId="3" /></connectionPointIn></rightPowerRail>`,
		),
	},

	{
		name: "ld_set_coil",
		pouName: "FB_LANG_ld_set_coil",
		kind: "function_block",
		feature: "LD: set coil — `storage=\"set\"` (latches TRUE)",
		fromDoc: "15-ld-elements.md#coil",
		expectTcAccepts: true,
		plcPrgVar: "fb_lsc : FB_LANG_ld_set_coil;",
		plcPrgBody: "fb_lsc();",
		source: ldProgramWithVar(
			"FB_LANG_ld_set_coil",
			"\ttrigger : BOOL;\n\talarm : BOOL;\n",
			`      <leftPowerRail localId="1"><position x="0" y="0" /><connectionPointOut formalParameter="" /></leftPowerRail>
      <contact localId="2">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="1" /></connectionPointIn>
        <connectionPointOut />
        <variable>trigger</variable>
      </contact>
      <coil localId="3" storage="set">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="2" /></connectionPointIn>
        <connectionPointOut />
        <variable>alarm</variable>
      </coil>
      <rightPowerRail localId="4"><position x="0" y="0" /><connectionPointIn><connection refLocalId="3" /></connectionPointIn></rightPowerRail>`,
		),
	},

	{
		name: "ld_reset_coil",
		pouName: "FB_LANG_ld_reset_coil",
		kind: "function_block",
		feature: "LD: reset coil — `storage=\"reset\"` (latches FALSE)",
		fromDoc: "15-ld-elements.md#coil",
		expectTcAccepts: true,
		plcPrgVar: "fb_lrc : FB_LANG_ld_reset_coil;",
		plcPrgBody: "fb_lrc();",
		source: ldProgramWithVar(
			"FB_LANG_ld_reset_coil",
			"\tackBtn : BOOL;\n\talarm : BOOL;\n",
			`      <leftPowerRail localId="1"><position x="0" y="0" /><connectionPointOut formalParameter="" /></leftPowerRail>
      <contact localId="2">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="1" /></connectionPointIn>
        <connectionPointOut />
        <variable>ackBtn</variable>
      </contact>
      <coil localId="3" storage="reset">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="2" /></connectionPointIn>
        <connectionPointOut />
        <variable>alarm</variable>
      </coil>
      <rightPowerRail localId="4"><position x="0" y="0" /><connectionPointIn><connection refLocalId="3" /></connectionPointIn></rightPowerRail>`,
		),
	},

	// ────────────────────────────────────────────────────────────────────
	// Multiple rungs in one body (each rung is its own <network>)
	// ────────────────────────────────────────────────────────────────────

	{
		name: "ld_two_rungs",
		pouName: "FB_LANG_ld_two_rungs",
		kind: "function_block",
		feature: "LD: two rungs (each in its own <network>) in one POU",
		fromDoc: "15-ld-elements.md#contact",
		expectTcAccepts: true,
		plcPrgVar: "fb_ltr : FB_LANG_ld_two_rungs;",
		plcPrgBody: "fb_ltr();",
		source: `FUNCTION_BLOCK FB_LANG_ld_two_rungs
VAR
	a : BOOL;
	b : BOOL;
	outA : BOOL;
	outB : BOOL;
END_VAR

<body xmlns="http://www.plcopen.org/xml/tc6_0200">
  <LD>
      <leftPowerRail localId="1"><position x="0" y="0" /><connectionPointOut formalParameter="" /></leftPowerRail>
      <contact localId="2"><position x="0" y="0" /><connectionPointIn><connection refLocalId="1" /></connectionPointIn><connectionPointOut /><variable>a</variable></contact>
      <coil localId="3"><position x="0" y="0" /><connectionPointIn><connection refLocalId="2" /></connectionPointIn><connectionPointOut /><variable>outA</variable></coil>
      <rightPowerRail localId="4"><position x="0" y="0" /><connectionPointIn><connection refLocalId="3" /></connectionPointIn></rightPowerRail>
      <leftPowerRail localId="5"><position x="0" y="0" /><connectionPointOut formalParameter="" /></leftPowerRail>
      <contact localId="6"><position x="0" y="0" /><connectionPointIn><connection refLocalId="5" /></connectionPointIn><connectionPointOut /><variable>b</variable></contact>
      <coil localId="7"><position x="0" y="0" /><connectionPointIn><connection refLocalId="6" /></connectionPointIn><connectionPointOut /><variable>outB</variable></coil>
      <rightPowerRail localId="8"><position x="0" y="0" /><connectionPointIn><connection refLocalId="7" /></connectionPointIn></rightPowerRail>
  </LD>
</body>

END_FUNCTION_BLOCK
`,
	},

	// ────────────────────────────────────────────────────────────────────
	// Mixed: LD allows FBD-style <block> calls in a rung
	// ────────────────────────────────────────────────────────────────────

	{
		name: "ld_block_in_rung",
		pouName: "FB_LANG_ld_block_in_rung",
		kind: "function_block",
		feature: "LD: function block (TON timer) embedded in a rung",
		fromDoc: "15-ld-elements.md#contact",
		expectTcAccepts: true,
		plcPrgVar: "fb_lbir : FB_LANG_ld_block_in_rung;",
		plcPrgBody: "fb_lbir();",
		source: ldProgramWithVar(
			"FB_LANG_ld_block_in_rung",
			"\ttrig : BOOL;\n\ttmr : TON;\n\tdone : BOOL;\n",
			`      <leftPowerRail localId="1"><position x="0" y="0" /><connectionPointOut formalParameter="" /></leftPowerRail>
      <contact localId="2">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="1" /></connectionPointIn>
        <connectionPointOut />
        <variable>trig</variable>
      </contact>
      <inVariable localId="3"><position x="0" y="0" /><connectionPointOut /><expression>T#1S</expression></inVariable>
      <block localId="4" typeName="TON" instanceName="tmr">
        <position x="0" y="0" />
        <inputVariables>
          <variable formalParameter="IN"><connectionPointIn><connection refLocalId="2" /></connectionPointIn></variable>
          <variable formalParameter="PT"><connectionPointIn><connection refLocalId="3" /></connectionPointIn></variable>
        </inputVariables>
        <inOutVariables />
        <outputVariables>
          <variable formalParameter="Q"><connectionPointOut /></variable>
          <variable formalParameter="ET"><connectionPointOut /></variable>
        </outputVariables>
      </block>
      <coil localId="5">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="4" formalParameter="Q" /></connectionPointIn>
        <connectionPointOut />
        <variable>done</variable>
      </coil>
      <rightPowerRail localId="6"><position x="0" y="0" /><connectionPointIn><connection refLocalId="5" /></connectionPointIn></rightPowerRail>`,
		),
	},

	// ────────────────────────────────────────────────────────────────────
	// Sad path: missing left power rail (rung has no source)
	// ────────────────────────────────────────────────────────────────────

	{
		name: "ld_dangling_contact_ref",
		pouName: "FB_LANG_ld_dangling_contact_ref",
		kind: "function_block",
		recorderSkip: true,
		feature: "LD: contact's connection refs a non-existent localId (must flag)",
		fromDoc: "15-ld-elements.md#contact",
		expectTcAccepts: false,
		plcPrgVar: "fb_ldcr : FB_LANG_ld_dangling_contact_ref;",
		plcPrgBody: "fb_ldcr();",
		note: "Anchor for the dangling-connection check in LD context.",
		source: ldProgramWithVar(
			"FB_LANG_ld_dangling_contact_ref",
			"\ta : BOOL;\n\tout : BOOL;\n",
			`      <leftPowerRail localId="1"><position x="0" y="0" /><connectionPointOut formalParameter="" /></leftPowerRail>
      <contact localId="2">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="999" /></connectionPointIn>
        <connectionPointOut />
        <variable>a</variable>
      </contact>
      <coil localId="3">
        <position x="0" y="0" />
        <connectionPointIn><connection refLocalId="2" /></connectionPointIn>
        <connectionPointOut />
        <variable>out</variable>
      </coil>
      <rightPowerRail localId="4"><position x="0" y="0" /><connectionPointIn><connection refLocalId="3" /></connectionPointIn></rightPowerRail>`,
		),
	},
];
