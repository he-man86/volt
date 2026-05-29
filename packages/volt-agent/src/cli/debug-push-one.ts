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
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BridgeClient } from "../bridge/client.js";
import { ALL_TESTS } from "@opencode-ai/volt-lsp-st/conformance";
import { findExistingFile } from "./_shared.js";

const BRIDGE_PORT = Number.parseInt(process.env.VOLT_BRIDGE_PORT ?? "8555", 10);
const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(THIS_DIR, "bin.js");

const KIND_EXT: Record<string, string> = {
	function_block: "st", function: "st", program: "st", gvl: "gvl", structure: "dut", interface: "itf",
};

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const targets = args.length > 0 ? args : ["warning_message"];
	const tests = targets.map((name) => {
		const t = ALL_TESTS.find((x) => x.name === name);
		if (t === undefined) {
			console.error(`unknown test: ${name}. Known: ${ALL_TESTS.map((x) => x.name).join(", ")}`);
			process.exit(1);
		}
		return t;
	});

	const bridge = new BridgeClient({ port: BRIDGE_PORT });
	const h = await bridge.getHealth();
	console.log(`bridge ${h.version} → ${h.platform}/${h.projectName}/${h.plcProjectName}`);
	console.log(`pushing ${tests.length} test(s): ${tests.map((t) => t.name).join(", ")}\n`);

	const rootTmp = mkdtempSync(join(tmpdir(), "volt-debug-push-"));
	const ws = join(rootTmp, "ws");
	mkdirSync(ws, { recursive: true });
	console.log(`workspace: ${ws}\n`);

	run(volt(ws, "init"));
	run(volt(ws, "pull"));

	// Write each test source.
	for (const t of tests) {
		const ext = KIND_EXT[t.kind]!;
		writeFileSync(join(ws, `${t.pouName}.${ext}`), t.source, "utf-8");
	}

	// Combined PLC_PRG — same mega-instantiation shape as the recorder
	// uses, so debug push reproduces batch behavior on a subset of tests.
	const plcPrgPath = findExistingFile(ws, "PLC_PRG.st") ?? join(ws, "PLC_PRG.st");
	console.log(`PLC_PRG path in workspace: ${plcPrgPath}`);
	const varLines: string[] = [];
	const bodyLines: string[] = [];
	for (const t of tests) {
		if (t.plcPrgVar !== undefined) varLines.push(`\t${t.plcPrgVar}`);
		if (t.plcPrgBody !== undefined) bodyLines.push(t.plcPrgBody);
	}
	const plcPrg = `PROGRAM PLC_PRG
VAR
${varLines.join("\n")}
END_VAR
${bodyLines.join("\n")}
END_PROGRAM
`;
	writeFileSync(plcPrgPath, plcPrg, "utf-8");

	console.log(`\npushing ${tests.length} POU(s) + combined PLC_PRG…`);
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
	console.log(`Open TwinCAT and verify each:`);
	for (const t of tests) {
		console.log(`  • ${t.pouName} (instantiated as: ${t.plcPrgVar ?? "—"})`);
	}
	console.log(`Build → Build Solution in TC menu — what shows in Output → Build pane?`);
	console.log(`Copy the relevant lines and report back.`);
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


main().catch((err) => { console.error(err); process.exit(1); });
