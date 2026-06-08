/**
 * L5 live CONTRACT test — pins the canonical `BridgeDiagnostic` shape that
 * the zod schema CANNOT enforce (container prefix, property-FB, section
 * population, line convention — see types.ts). It pushes one FB with errors
 * in every object kind (POU body, method decl + impl, property GET) and
 * checks each invariant against the live build.
 *
 * Known per-vendor violations are TRACKED: a violation that's expected is
 * fine; a NEW violation fails loud (drift), and a known violation that now
 * HOLDS fails too (so fixing a bridge forces us to update this list). This
 * is how we "know we don't have any of the issues left" without the schema.
 *
 * Run per vendor:
 *   VOLT_TEST_BRIDGE_PORT=8555 bun test src/tests/live/bridge-diagnostic-contract.test.ts  # TwinCAT
 *   VOLT_TEST_BRIDGE_PORT=8556 bun test src/tests/live/bridge-diagnostic-contract.test.ts  # CODESYS
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BridgeClient } from "../../bridge/client.js";
import type { BridgeDiagnostic, PushOp } from "../../bridge/types.js";

const PORT_RAW = process.env.VOLT_TEST_BRIDGE_PORT;
const PORT = PORT_RAW !== undefined ? Number.parseInt(PORT_RAW, 10) : Number.NaN;
const LIVE = Number.isFinite(PORT);
const TIMEOUT = 120_000;

const FB = "FB_VoltContract";
const SOURCE = [
	"FUNCTION_BLOCK FB_VoltContract", // 1
	"VAR", // 2
	"\tx : INT;", // 3
	"END_VAR", // 4
	"und_pou := 1;", // 5  POU impl error (impl line 1)
	"END_FUNCTION_BLOCK", // 6
	"", // 7
	"METHOD DoIt", // 8
	"VAR_INPUT", // 9
	"\tbad : BADTYPE;", // 10  method DECL error (decl line 3)
	"END_VAR", // 11
	"und_method := 1;", // 12  method IMPL error (impl line 1)
	"END_METHOD", // 13
	"", // 14
	"PROPERTY Prop : INT", // 15
	"GET", // 16
	"Prop := und_get;", // 17  property GET error
	"END_GET", // 18
	"END_PROPERTY", // 19
	"", // 20
].join("\n");

/**
 * Canonical contract = **TwinCAT's shape**: bare / FB-qualified `object`
 * (`FB`, `FB.Method`, `FB.Prop.Get`) and **combined** `line` (decl+impl
 * counted straight through, per object) — exactly what
 * `bridgeDiagnosticFileLine` consumes. `section` is best-effort and ignored
 * (the mapper derives decl/impl from the parsed source).
 *
 * KNOWN_VIOLATIONS per vendor are what's broken vs that contract today
 * (verified live 2026-06-08). Empty sets are the goal.
 */
const KNOWN_VIOLATIONS: Record<string, ReadonlySet<string>> = {
	// TwinCAT is the reference — it already emits the canonical shape.
	beckhoff: new Set<string>(),
	// CODESYS now conforms too (build.py: object names exclude the
	// `Application` container + add the FB to property accessors; impl lines
	// converted section-relative → combined). Verified live 2026-06-08.
	codesys: new Set<string>(),
};

const bridge = new BridgeClient({ port: PORT });
let platform = "";
let diags: BridgeDiagnostic[] = [];
let savedPlcPrg: string | undefined;
let plcExisted = false;

async function setup(): Promise<void> {
	platform = (await bridge.getHealth()).platform;
	const fetched = await bridge.fetchChanges({ knownItems: {}, onlyItems: ["PLC_PRG"] });
	const plc = fetched.changed.find((i) => i.name === "PLC_PRG");
	plcExisted = plc !== undefined;
	savedPlcPrg = plc?.sourceText;
	const refs = await bridge.getRefs();
	const ops: PushOp[] = [
		{ op: "pushItem", name: FB, sourceText: SOURCE, ifVersion: null },
		{ op: "pushItem", name: "PLC_PRG", sourceText: `PROGRAM PLC_PRG\nVAR\n\tc : ${FB};\nEND_VAR\n\nEND_PROGRAM\n`, ifVersion: refs.items["PLC_PRG"] ?? null },
	];
	const pr = await bridge.pushBatch({ ops });
	if (pr.accepted !== true) throw new Error(`push rejected: ${JSON.stringify(pr.conflicts)}`);
	diags = (await bridge.build({ buildType: "full" })).diagnostics.filter((d) => d.severity !== "info");
	console.log(`\n[contract] ${platform} — diagnostics:`);
	for (const d of diags) console.log(`  object=${d.object} section=${d.section} line=${d.line} :: ${d.message}`);
}

async function teardown(): Promise<void> {
	try {
		const refs = await bridge.getRefs();
		const ops: PushOp[] = [];
		if (plcExisted && savedPlcPrg !== undefined && refs.items["PLC_PRG"] !== undefined) {
			ops.push({ op: "pushItem", name: "PLC_PRG", sourceText: savedPlcPrg, ifVersion: refs.items["PLC_PRG"] });
		}
		if (refs.items[FB] !== undefined) ops.push({ op: "deleteItem", name: FB, ifVersion: refs.items[FB]! });
		if (ops.length > 0) await bridge.pushBatch({ ops });
	} catch (err) {
		console.error(`[contract] teardown failed (clean ${FB} manually): ${err instanceof Error ? err.message : err}`);
	}
}

/** First non-info diagnostic whose message contains `substr`. */
function byMsg(substr: string): BridgeDiagnostic | undefined {
	return diags.find((d) => d.message.includes(substr));
}

/** Assert an invariant against the per-vendor known-violation list. */
function checkInvariant(name: string, holds: boolean): void {
	const known = KNOWN_VIOLATIONS[platform] ?? new Set<string>();
	if (holds && known.has(name)) {
		throw new Error(`Invariant '${name}' now HOLDS on ${platform} — remove it from KNOWN_VIOLATIONS (a bridge was fixed!).`);
	}
	if (!holds && !known.has(name)) {
		throw new Error(`Canonical contract VIOLATED on ${platform}: '${name}' (new drift — fix the bridge or add to KNOWN_VIOLATIONS).`);
	}
}

describe.skipIf(!LIVE)("BridgeDiagnostic canonical contract (live, per vendor)", () => {
	beforeAll(setup, TIMEOUT);
	afterAll(teardown, TIMEOUT);

	test("precondition: every seeded error is reported", () => {
		expect(byMsg("und_pou")).toBeDefined(); // POU body
		expect(byMsg("BADTYPE")).toBeDefined(); // method decl
		expect(byMsg("und_method")).toBeDefined(); // method impl
		expect(byMsg("und_get")).toBeDefined(); // property GET
	});

	test("pou-object-exact: POU error object is the bare item name (no container prefix)", () => {
		checkInvariant("pou-object-exact", byMsg("und_pou")?.object === FB);
	});

	test("method-object-exact: method error object is FB.Member", () => {
		checkInvariant("method-object-exact", byMsg("BADTYPE")?.object === `${FB}.DoIt`);
	});

	test("property-object-exact: property error object carries the FB (FB.Prop.Get)", () => {
		checkInvariant("property-object-exact", byMsg("und_get")?.object === `${FB}.Prop.Get`);
	});

	test("impl-line-combined: a POU impl error's line is the combined decl+impl line", () => {
		// FB decl is 4 lines (FUNCTION_BLOCK/VAR/x/END_VAR); the impl's first
		// line (und_pou) is combined line 5. CODESYS reports section-relative 1.
		checkInvariant("impl-line-combined", byMsg("und_pou")?.line === 5);
	});

	test("property-line-combined: a var-less accessor body error counts the phantom 2-line VAR (combined 3)", () => {
		// GET has no VAR; the canonical model still gives it a 2-line VAR block,
		// so the body's first line is combined 3. (TwinCAT's value.)
		checkInvariant("property-line-combined", byMsg("und_get")?.line === 3);
	});
});
