#!/usr/bin/env node
/**
 * Debug helper — push ONE pragma test to the bridge and STOP (no
 * cleanup). Use to verify by eye in TwinCAT that:
 *
 *   1. The pushed POU + PLC_PRG actually appear in the project tree
 *   2. A manual Build All in TwinCAT produces the expected
 *      diagnostics in the Build output pane
 *
 * Run: `node dist/cli/debug-push-one.js [testName]`
 *   Default test: `warning_message` (most informative — it MUST
 *   produce a TC warning per docs, so absence is diagnostic).
 *
 * Cleanup: manual. Delete `FB_LANG_warning_message` and the
 * test-side PLC_PRG content yourself in TwinCAT after inspection,
 * OR re-run the recorder which sweeps all LANG_* leftovers.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BridgeClient } from "../bridge/client.js";
import { ALL_TESTS } from "../conformance/index.js";

const BRIDGE_PORT = Number.parseInt(process.env.VOLT_BRIDGE_PORT ?? "8555", 10);
const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(THIS_DIR, "bin.js");

const KIND_EXT: Record<string, string> = {
	function_block: "st", function: "st", program: "st", gvl: "gvl", structure: "dut", interface: "itf",
};

async function main(): Promise<void> {
	const target = process.argv[2] ?? "warning_message";
	const test = ALL_TESTS.find((t) => t.name === target);
	if (test === undefined) {
		console.error(`unknown test: ${target}. Known: ${ALL_TESTS.map((t) => t.name).join(", ")}`);
		process.exit(1);
	}

	const bridge = new BridgeClient({ port: BRIDGE_PORT });
	const h = await bridge.getHealth();
	console.log(`bridge ${h.version} → ${h.platform}/${h.projectName}/${h.plcProjectName}`);

	const rootTmp = mkdtempSync(join(tmpdir(), "volt-debug-push-"));
	const ws = join(rootTmp, "ws");
	mkdirSync(ws, { recursive: true });
	console.log(`workspace: ${ws}\n`);

	run(volt(ws, "init"));
	run(volt(ws, "pull"));

	const ext = KIND_EXT[test.kind]!;
	writeFileSync(join(ws, `${test.pouName}.${ext}`), test.source, "utf-8");

	// PLC_PRG already exists in TC (every project has one). After
	// `volt pull` it sits somewhere under workspace — typically
	// `POUs/PLC_PRG.st`. We must OVERWRITE that file, not write a
	// second copy at root — otherwise push sees a new orphan POU
	// instead of an update to the existing one, and TC's PLC_PRG
	// stays empty.
	const plcPrgPath = findExistingFile(ws, "PLC_PRG.st") ?? join(ws, "PLC_PRG.st");
	console.log(`PLC_PRG path in workspace: ${plcPrgPath}`);
	const plcPrg = `PROGRAM PLC_PRG
VAR
	${test.plcPrgVar ?? ""}
END_VAR
${test.plcPrgBody ?? ""}
END_PROGRAM
`;
	writeFileSync(plcPrgPath, plcPrg, "utf-8");

	console.log(`\npushing ${test.pouName} + PLC_PRG instantiation…`);
	run(volt(ws, "push", "--force"));

	console.log(`\nrunning build…`);
	const build = await bridge.build({ buildType: "full" });
	console.log(`build: success=${build.success} duration=${build.duration}ms diagnostics=${build.diagnostics.length}`);
	for (const d of build.diagnostics) {
		console.log(`  [${d.severity}] object=${d.object} section=${d.section} line=${d.line}: ${d.message}`);
	}

	console.log(`\nrefs after push:`);
	const refs = await bridge.getRefs();
	for (const [name, ver] of Object.entries(refs.items)) {
		console.log(`  ${name} = ${ver}`);
	}

	console.log(`\n──── LEAVING POUs IN TC FOR MANUAL INSPECTION ────`);
	console.log(`Open TwinCAT and verify:`);
	console.log(`  1. ${test.pouName} appears in the project tree`);
	console.log(`  2. PLC_PRG content shows the instantiation (${test.plcPrgVar ?? "—"})`);
	console.log(`  3. Build → Build Solution in TC menu — what shows in Output → Build pane?`);
	console.log(`Copy that pane text and report back.`);
	console.log(`\nTo clean up later: re-run \`bun run record:language\` (sweeps LANG_* leftovers).`);
}

function volt(ws: string, ...args: string[]): { stdout: string; stderr: string; code: number } {
	const r = spawnSync(
		"node",
		[CLI_PATH, ...args, "--workspace", ws, "--port", String(BRIDGE_PORT)],
		{ encoding: "utf-8", env: { ...process.env, VOLT_BRIDGE_PORT: String(BRIDGE_PORT) } },
	);
	return { stdout: r.stdout, stderr: r.stderr, code: r.status ?? -1 };
}

function run(r: { stdout: string; stderr: string; code: number }): void {
	if (r.code !== 0) {
		console.error(r.stderr.trim() || r.stdout.trim());
		process.exit(1);
	}
}

/** Walk the workspace for a file with the given basename. Skip .volt/. */
function findExistingFile(root: string, basename: string): string | undefined {
	let found: string | undefined;
	function walk(dir: string): void {
		if (found !== undefined) return;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === ".volt" || entry.name === ".git") continue;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.isFile() && entry.name === basename) {
				found = full;
				return;
			}
		}
	}
	walk(root);
	return found;
}

main().catch((err) => { console.error(err); process.exit(1); });
