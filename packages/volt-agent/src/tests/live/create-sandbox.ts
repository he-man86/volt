/**
 * One-shot sandbox setup script.
 * Run: VOLT_TEST_BRIDGE_PORT=8555 bun run src/tests/live/create-sandbox.ts
 *
 * Creates all VoltTest_* items defined in SANDBOX.md via the bridge's
 * /push endpoint. Items that already exist are skipped (the push
 * pre-flight returns a conflict for ifVersion=null on an existing item,
 * so we send each as a separate batch so partial failures don't block others).
 *
 * Items requiring graphical bodies (VoltTest_FB_FBD, the Cyclic FBD
 * action inside VoltTest_FB_Mixed) cannot be created here — those need
 * the IDE. This script covers all ST/declaration-only items.
 */

const PORT = Number.parseInt(process.env.VOLT_TEST_BRIDGE_PORT ?? "8555", 10);
const BASE = `http://127.0.0.1:${PORT}`;

interface PushOp {
	op: "pushItem";
	name: string;
	ifVersion: null;
	sourceText: string;
	folder?: string;
}

async function pushOne(op: PushOp): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
	const res = await fetch(`${BASE}/push`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ops: [op] }),
	});
	const json = (await res.json()) as Record<string, unknown>;
	if (res.ok && json.accepted !== false) {
		return { ok: true };
	}
	if (json.accepted === false) {
		const conflicts = json.conflicts as Array<Record<string, unknown>> | undefined;
		const reason = conflicts?.[0]?.reason as string | undefined;
		if (reason?.includes("already exists")) return { ok: true, skipped: true };
		return { ok: false, error: reason ?? JSON.stringify(json) };
	}
	return { ok: false, error: `HTTP ${res.status}: ${JSON.stringify(json)}` };
}

const ITEMS: PushOp[] = [
	// ── Programs / POUs ───────────────────────────────────────────────
	{
		op: "pushItem",
		name: "VoltTest_PLC_PRG",
		ifVersion: null,
		folder: "",
		sourceText: `PROGRAM VoltTest_PLC_PRG
VAR
    counter : INT := 0;
END_VAR
counter := counter + 1;
END_PROGRAM`,
	},

	// ── Function blocks — all under POUs/VoltTest ─────────────────────
	{
		op: "pushItem",
		name: "VoltTest_FB_ST",
		ifVersion: null,
		folder: "POUs/VoltTest",
		sourceText: `FUNCTION_BLOCK VoltTest_FB_ST
VAR
    value : INT;
END_VAR
value := value + 1;
END_FUNCTION_BLOCK

ACTION Reset
value := 0;
END_ACTION

METHOD GetValue : INT
VAR_INPUT
END_VAR
GetValue := value;
END_METHOD`,
	},
	{
		op: "pushItem",
		name: "VoltTest_FB_Mixed",
		ifVersion: null,
		folder: "POUs/VoltTest",
		sourceText: `FUNCTION_BLOCK VoltTest_FB_Mixed
VAR
    step : INT;
END_VAR
step := step + 1;
END_FUNCTION_BLOCK`,
	},
	{
		op: "pushItem",
		name: "VoltTest_FB_MovableA",
		ifVersion: null,
		folder: "POUs/VoltTest/MoveSource",
		sourceText: `FUNCTION_BLOCK VoltTest_FB_MovableA
VAR
    placeholder : INT;
END_VAR
END_FUNCTION_BLOCK`,
	},
	{
		op: "pushItem",
		name: "VoltTest_FB_MovableB",
		ifVersion: null,
		folder: "POUs/VoltTest/MoveSource",
		sourceText: `FUNCTION_BLOCK VoltTest_FB_MovableB
VAR
    placeholder : INT;
END_VAR
END_FUNCTION_BLOCK`,
	},

	// ── Declaration-only kinds ─────────────────────────────────────────
	{
		op: "pushItem",
		name: "VoltTest_DUT_Struct",
		ifVersion: null,
		folder: "POUs/VoltTest/Types",
		sourceText: `TYPE VoltTest_DUT_Struct :
STRUCT
    a : INT;
    b : REAL;
END_STRUCT
END_TYPE`,
	},
	{
		op: "pushItem",
		name: "VoltTest_DUT_Enum",
		ifVersion: null,
		folder: "POUs/VoltTest/Types",
		sourceText: `TYPE VoltTest_DUT_Enum :
(
    ONE,
    TWO,
    THREE
);
END_TYPE`,
	},
	{
		op: "pushItem",
		name: "VoltTest_GVL_Config",
		ifVersion: null,
		folder: "POUs/VoltTest",
		sourceText: `VAR_GLOBAL
    g_max_speed : REAL := 1500.0;
    g_enabled : BOOL := TRUE;
END_VAR`,
	},
	{
		op: "pushItem",
		name: "VoltTest_ITF_Probe",
		ifVersion: null,
		folder: "POUs/VoltTest",
		sourceText: `INTERFACE VoltTest_ITF_Probe
METHOD GetStatus : INT
END_METHOD
END_INTERFACE`,
	},
];

async function main() {
	console.log(`Creating sandbox items on bridge at :${PORT}…\n`);

	// Health check
	const h = await fetch(`${BASE}/health`).then((r) => r.json() as Promise<Record<string, unknown>>);
	if (!h.connected) {
		console.error(`Bridge not connected (ideAlive=${h.ideAlive}). Aborting.`);
		process.exit(1);
	}
	console.log(`Bridge: ${h.ideName} — ${h.projectName}\n`);

	let created = 0;
	let skipped = 0;
	let failed = 0;

	for (const op of ITEMS) {
		const folderDesc = op.folder ? ` [${op.folder}]` : " [root]";
		const res = await pushOne(op);
		if (res.ok && !res.skipped) {
			console.log(`  ✓  created  ${op.name}${folderDesc}`);
			created++;
		} else if (res.skipped) {
			console.log(`  –  skipped  ${op.name}${folderDesc}  (already exists)`);
			skipped++;
		} else {
			console.log(`  ✗  failed   ${op.name}${folderDesc}  → ${res.error}`);
			failed++;
		}
	}

	console.log(`\nDone: ${created} created, ${skipped} skipped, ${failed} failed.`);

	if (failed === 0) {
		console.log(`
Note: VoltTest_FB_FBD and the FBD 'Cyclic' action inside VoltTest_FB_Mixed
require graphical bodies authored in TwinCAT IDE — those cannot be pushed
via text. Create them manually per SANDBOX.md.`);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
