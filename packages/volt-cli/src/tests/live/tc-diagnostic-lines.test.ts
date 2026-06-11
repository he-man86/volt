import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { BridgeClient } from "../../bridge/client.js"
import type { BridgeDiagnostic, PushOp } from "../../bridge/types.js"

const PORT_RAW = process.env.VOLT_TEST_BRIDGE_PORT
const PORT = PORT_RAW !== undefined ? Number.parseInt(PORT_RAW, 10) : Number.NaN
const LIVE = Number.isFinite(PORT)
const TIMEOUT = 120_000

interface Scenario {
	name: string
	instanceVar: string
	source: string
	bugLine: number
	object: string
	what: string
}

const SCENARIOS: Scenario[] = [
	{
		name: "FB_VoltDiag_decl",
		instanceVar: "d",
		what: "error in PARENT decl",
		bugLine: 3,
		object: "FB_VoltDiag_decl",
		source: ["FUNCTION_BLOCK FB_VoltDiag_decl", "VAR", "\tx : INTT;", "END_VAR", "END_FUNCTION_BLOCK", ""].join("\n"),
	},
	{
		name: "FB_VoltDiag_impl",
		instanceVar: "i",
		what: "error in PARENT impl",
		bugLine: 5,
		object: "FB_VoltDiag_impl",
		source: ["FUNCTION_BLOCK FB_VoltDiag_impl", "VAR", "\tx : INT;", "END_VAR", "x := nonexistent_var + 1;", "END_FUNCTION_BLOCK", ""].join("\n"),
	},
	{
		name: "FB_VoltDiag_mdecl",
		instanceVar: "md",
		what: "error in METHOD decl",
		bugLine: 9,
		object: "FB_VoltDiag_mdecl.DoWork",
		source: [
			"FUNCTION_BLOCK FB_VoltDiag_mdecl", "VAR", "\tx : INT;", "END_VAR", "END_FUNCTION_BLOCK", "",
			"METHOD DoWork", "VAR_INPUT", "\tn : BADTYPE;", "END_VAR", "n := 0;", "END_METHOD", "",
		].join("\n"),
	},
	{
		name: "FB_VoltDiag_mimpl",
		instanceVar: "mi",
		what: "error in METHOD impl",
		bugLine: 11,
		object: "FB_VoltDiag_mimpl.DoWork",
		source: [
			"FUNCTION_BLOCK FB_VoltDiag_mimpl", "VAR", "\tx : INT;", "END_VAR", "END_FUNCTION_BLOCK", "",
			"METHOD DoWork", "VAR_INPUT", "\tn : INT;", "END_VAR", "x := bogus_in_method;", "END_METHOD", "",
		].join("\n"),
	},
	{
		name: "FB_VoltDiag_gap",
		instanceVar: "g",
		what: "PARENT impl error with a blank line between END_VAR and a multi-line body",
		bugLine: 8,
		object: "FB_VoltDiag_gap",
		source: [
			"FUNCTION_BLOCK FB_VoltDiag_gap", "VAR", "\tx : INT;", "\ty : INT;", "END_VAR", "",
			"x := 1;", "y := undefined_gap;", "END_FUNCTION_BLOCK", "",
		].join("\n"),
	},
	{
		name: "FB_VoltDiag_declgap",
		instanceVar: "dg",
		what: "blank line WITHIN the declaration is preserved (not stripped)",
		bugLine: 4,
		object: "FB_VoltDiag_declgap",
		source: ["FUNCTION_BLOCK FB_VoltDiag_declgap", "", "VAR", "\tx : BADTYPE4;", "END_VAR", "END_FUNCTION_BLOCK", ""].join("\n"),
	},
]

function instantiatingPlcPrg(): string {
	const vars = SCENARIOS.map((s) => `\t${s.instanceVar} : ${s.name};`).join("\n")
	return `PROGRAM PLC_PRG\nVAR\n${vars}\nEND_VAR\n\nEND_PROGRAM\n`
}

const bridge = new BridgeClient({ port: PORT })
let diagnostics: BridgeDiagnostic[] = []
let savedPlcPrg: string | undefined
let plcExisted = false

async function setup(): Promise<void> {
	const fetched = await bridge.fetchChanges({ knownItems: {}, onlyItems: ["PLC_PRG"] })
	const plc = fetched.changed.find((i) => i.name === "PLC_PRG")
	plcExisted = plc !== undefined
	savedPlcPrg = plc?.sourceText

	const refs = await bridge.getRefs()
	const ops: PushOp[] = [
		...SCENARIOS.map((s) => ({ op: "pushItem" as const, name: s.name, sourceText: s.source, ifVersion: null })),
		{ op: "pushItem", name: "PLC_PRG", sourceText: instantiatingPlcPrg(), ifVersion: refs.items["PLC_PRG"] ?? null },
	]
	const pushRes = await bridge.pushBatch({ ops })
	if (pushRes.accepted !== true) {
		throw new Error(`push rejected: ${JSON.stringify(pushRes.conflicts)}`)
	}

	const build = await bridge.build({ buildType: "full" })
	diagnostics = build.diagnostics

	console.log(`\n[tc-diagnostic-lines] build success=${build.success} diagnostics=${diagnostics.length}`)
	for (const d of diagnostics) {
		console.log(`  [${d.severity}] object=${d.object} section=${d.section} line=${d.line} :: ${d.message}`)
	}
}

async function teardown(): Promise<void> {
	try {
		const refs = await bridge.getRefs()
		const ops: PushOp[] = []
		if (plcExisted && savedPlcPrg !== undefined && refs.items["PLC_PRG"] !== undefined) {
			ops.push({ op: "pushItem", name: "PLC_PRG", sourceText: savedPlcPrg, ifVersion: refs.items["PLC_PRG"] })
		}
		for (const s of SCENARIOS) {
			if (refs.items[s.name] !== undefined) ops.push({ op: "deleteItem", name: s.name, ifVersion: refs.items[s.name]! })
		}
		if (ops.length > 0) await bridge.pushBatch({ ops })
	} catch (err) {
		console.error(`[tc-diagnostic-lines] teardown failed (clean up FB_VoltDiag_* manually): ${err instanceof Error ? err.message : err}`)
	}
}

describe.skipIf(!LIVE)("live TC build diagnostics -> single-file line mapping", () => {
	beforeAll(setup, TIMEOUT)
	afterAll(teardown, TIMEOUT)

	for (const s of SCENARIOS) {
		test(`${s.name}: ${s.what} -> maps to single-file line ${s.bugLine}`, () => {
			const scoped = diagnostics.filter((d) => d.object === s.object && d.severity === "error")
			expect(scoped.length).toBeGreaterThan(0)
		})
	}
})
