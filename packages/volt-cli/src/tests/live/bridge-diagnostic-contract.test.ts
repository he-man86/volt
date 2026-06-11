import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { BridgeClient } from "../../bridge/client.js"
import type { BridgeDiagnostic, PushOp } from "../../bridge/types.js"

const PORT_RAW = process.env.VOLT_TEST_BRIDGE_PORT
const PORT = PORT_RAW !== undefined ? Number.parseInt(PORT_RAW, 10) : Number.NaN
const LIVE = Number.isFinite(PORT)
const TIMEOUT = 120_000

const FB = "FB_VoltContract"
const SOURCE = [
	"FUNCTION_BLOCK FB_VoltContract",
	"VAR",
	"\tx : INT;",
	"END_VAR",
	"und_pou := 1;",
	"END_FUNCTION_BLOCK",
	"",
	"METHOD DoIt",
	"VAR_INPUT",
	"\tbad : BADTYPE;",
	"END_VAR",
	"und_method := 1;",
	"END_METHOD",
	"",
	"PROPERTY Prop : INT",
	"GET",
	"Prop := und_get;",
	"END_GET",
	"END_PROPERTY",
	"",
].join("\n")

const KNOWN_VIOLATIONS: Record<string, ReadonlySet<string>> = {
	beckhoff: new Set<string>(),
	codesys: new Set<string>(),
}

const bridge = new BridgeClient({ port: PORT })
let platform = ""
let diags: BridgeDiagnostic[] = []
let savedPlcPrg: string | undefined
let plcExisted = false

async function setup(): Promise<void> {
	platform = (await bridge.getHealth()).platform
	const fetched = await bridge.fetchChanges({ knownItems: {}, onlyItems: ["PLC_PRG"] })
	const plc = fetched.changed.find((i) => i.name === "PLC_PRG")
	plcExisted = plc !== undefined
	savedPlcPrg = plc?.sourceText
	const refs = await bridge.getRefs()
	const ops: PushOp[] = [
		{ op: "pushItem", name: FB, sourceText: SOURCE, ifVersion: null },
		{ op: "pushItem", name: "PLC_PRG", sourceText: `PROGRAM PLC_PRG\nVAR\n\tc : ${FB};\nEND_VAR\n\nEND_PROGRAM\n`, ifVersion: refs.items["PLC_PRG"] ?? null },
	]
	const pr = await bridge.pushBatch({ ops })
	if (pr.accepted !== true) throw new Error(`push rejected: ${JSON.stringify(pr.conflicts)}`)
	diags = (await bridge.build({ buildType: "full" })).diagnostics.filter((d) => d.severity !== "info")
	console.log(`\n[contract] ${platform} — diagnostics:`)
	for (const d of diags) console.log(`  object=${d.object} section=${d.section} line=${d.line} :: ${d.message}`)
}

async function teardown(): Promise<void> {
	try {
		const refs = await bridge.getRefs()
		const ops: PushOp[] = []
		if (plcExisted && savedPlcPrg !== undefined && refs.items["PLC_PRG"] !== undefined) {
			ops.push({ op: "pushItem", name: "PLC_PRG", sourceText: savedPlcPrg, ifVersion: refs.items["PLC_PRG"] })
		}
		if (refs.items[FB] !== undefined) ops.push({ op: "deleteItem", name: FB, ifVersion: refs.items[FB]! })
		if (ops.length > 0) await bridge.pushBatch({ ops })
	} catch (err) {
		console.error(`[contract] teardown failed (clean ${FB} manually): ${err instanceof Error ? err.message : err}`)
	}
}

function byMsg(substr: string): BridgeDiagnostic | undefined {
	return diags.find((d) => d.message.includes(substr))
}

function checkInvariant(name: string, holds: boolean): void {
	const known = KNOWN_VIOLATIONS[platform] ?? new Set<string>()
	if (holds && known.has(name)) {
		throw new Error(`Invariant '${name}' now HOLDS on ${platform} — remove it from KNOWN_VIOLATIONS (a bridge was fixed!).`)
	}
	if (!holds && !known.has(name)) {
		throw new Error(`Canonical contract VIOLATED on ${platform}: '${name}' (new drift — fix the bridge or add to KNOWN_VIOLATIONS).`)
	}
}

describe.skipIf(!LIVE)("BridgeDiagnostic canonical contract (live, per vendor)", () => {
	beforeAll(setup, TIMEOUT)
	afterAll(teardown, TIMEOUT)

	test("precondition: every seeded error is reported", () => {
		expect(byMsg("und_pou")).toBeDefined()
		expect(byMsg("BADTYPE")).toBeDefined()
		expect(byMsg("und_method")).toBeDefined()
		expect(byMsg("und_get")).toBeDefined()
	})

	test("pou-object-exact: POU error object is the bare item name (no container prefix)", () => {
		checkInvariant("pou-object-exact", byMsg("und_pou")?.object === FB)
	})

	test("method-object-exact: method error object is FB.Member", () => {
		checkInvariant("method-object-exact", byMsg("BADTYPE")?.object === `${FB}.DoIt`)
	})

	test("property-object-exact: property error object carries the FB (FB.Prop.Get)", () => {
		checkInvariant("property-object-exact", byMsg("und_get")?.object === `${FB}.Prop.Get`)
	})

	test("impl-line-combined: a POU impl error's line is the combined decl+impl line", () => {
		checkInvariant("impl-line-combined", byMsg("und_pou")?.line === 5)
	})

	test("property-line-combined: a var-less accessor body error counts the phantom 2-line VAR (combined 3)", () => {
		checkInvariant("property-line-combined", byMsg("und_get")?.line === 3)
	})
})
