/**
 * `record:language` — capture the vendor compiler's ground truth for the
 * language-conformance catalog, replayed offline by `conformance/language.test.ts`.
 *
 * Approach (per-test ISOLATION — the CODESYS `/build` diagnostics carry no
 * object attribution, and isolation also prevents one test's stale logic from
 * bleeding into the next):
 *   for each catalog test:
 *     1. reset the project to an EMPTY structure (bare PLC_PRG, prior test item removed)
 *     2. write the test source + a PLC_PRG that instantiates it
 *     3. `volt push` (exercises volt-git's push round-trip too — extra coverage)
 *     4. `/build`; every non-info diagnostic belongs to this test
 *     5. record { buildSuccess, durationMs, diagnostics }
 *   then reset to empty and write `recordings/expected-<vendor>.json`.
 *
 * Needs a LIVE bridge (`volt-scripts/codesys-bridge.ps1 up` → :8556 CODESYS /
 * :8555 TwinCAT). Env: VOLT_BRIDGE_PORT (default 8556). RECORD_LIMIT=<n> or
 * RECORD_ONLY=<category> restrict the run for validation.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSource } from "../src/parser/parser.js";
import { ALL_TESTS, CATEGORIES, type LanguageTest } from "../src/tests/conformance/index.js";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.VOLT_BRIDGE_PORT ?? "8556";
const VENDOR = PORT === "8555" ? "twincat" : "codesys";
const BASE = `http://127.0.0.1:${PORT}`;
const VOLT_BIN = resolve(THIS_DIR, "..", "..", "volt-git", "src", "bin.ts");
const OUTPUT = resolve(THIS_DIR, "..", "src", "tests", "conformance", "recordings", `expected-${VENDOR}.json`);

const KIND_EXT: Record<LanguageTest["kind"], string> = {
	function_block: "fb", function: "fun", program: "prg", gvl: "gvl", structure: "struct", interface: "itf",
};
const BARE_PLC_PRG = "PROGRAM PLC_PRG\nVAR\nEND_VAR\n\nEND_PROGRAM\n";

interface Diag { severity: string; message: string; line?: number }
interface Recorded { buildSuccess: boolean; durationMs: number; diagnostics: Diag[] }

const post = async (p: string, b: unknown): Promise<any> =>
	(await fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })).json();

function volt(ws: string, ...args: string[]): { code: number; stderr: string } {
	const r = spawnSync("bun", [VOLT_BIN, ...args, "--workspace", ws, "--port", PORT], {
		encoding: "utf-8",
		env: { ...process.env, VOLT_BRIDGE_PORT: PORT },
	});
	return { code: r.status ?? -1, stderr: r.stderr ?? "" };
}

function plcPrgFor(t: LanguageTest): string {
	const v = t.plcPrgVar ? `\t${t.plcPrgVar}` : "";
	const b = t.plcPrgBody ?? "";
	return `PROGRAM PLC_PRG\nVAR\n${v}\nEND_VAR\n\n${b}\nEND_PROGRAM\n`;
}

async function main(): Promise<void> {
	// Select tests (optional subset for validation).
	let tests = ALL_TESTS.filter((t) => t.recorderSkip !== true);
	if (process.env.RECORD_ONLY) {
		const cat = CATEGORIES.find((c) => c.name === process.env.RECORD_ONLY);
		tests = cat ? cat.tests.filter((t) => t.recorderSkip !== true) : [];
	}
	if (process.env.RECORD_LIMIT) tests = tests.slice(0, Number(process.env.RECORD_LIMIT));

	// Pre-validate sources parse (a broken fixture would poison the push).
	for (const t of tests) {
		if (parseSource(t.source).errors.length > 0) {
			console.error(`pre-flight: test '${t.name}' source has parse errors — fix the fixture`);
			process.exit(1);
		}
	}

	const ws = join(tmpdir(), `volt-record-${VENDOR}-${tests.length}`);
	rmSync(ws, { recursive: true, force: true });
	mkdirSync(ws, { recursive: true });
	console.log(`workspace: ${ws}\nvendor: ${VENDOR} (:${PORT})  tests: ${tests.length}`);

	if (volt(ws, "init").code !== 0) { console.error("volt init failed"); process.exit(1); }
	if (volt(ws, "pull").code !== 0) { console.error("volt pull failed"); process.exit(1); }
	const plcPrgFile = findFile(ws, "PLC_PRG.prg") ?? join(ws, "PLC_PRG.prg");

	const recorded: Record<string, Recorded> = {};
	let prevFile: string | undefined;
	for (const [i, t] of tests.entries()) {
		// 1. reset to empty structure (remove prior test item + bare PLC_PRG), push.
		if (prevFile) rmSync(prevFile, { force: true });
		writeFileSync(plcPrgFile, BARE_PLC_PRG, "utf-8");
		volt(ws, "push", "--force", "--no-drift-check");

		// 2-3. write this test + its instantiation, push.
		const file = join(ws, `${t.pouName}.${KIND_EXT[t.kind]}`);
		writeFileSync(file, t.source, "utf-8");
		writeFileSync(plcPrgFile, plcPrgFor(t), "utf-8");
		prevFile = file;
		const push = volt(ws, "push", "--force", "--no-drift-check");
		if (push.code !== 0) {
			recorded[t.name] = { buildSuccess: false, durationMs: 0, diagnostics: [] };
			console.log(`  ✗ ${t.name.padEnd(34)} push failed: ${push.stderr.trim().slice(0, 60)}`);
			continue;
		}

		// 4. build; every non-info diagnostic belongs to this (isolated) test.
		const build = await post("/build", { buildType: "full" });
		const diags: Diag[] = (build.diagnostics ?? [])
			.filter((d: Diag) => d.severity !== "info")
			.map((d: Diag) => ({ severity: d.severity, message: d.message, line: d.line ?? 0 }));
		const errs = diags.filter((d) => d.severity === "error").length;
		recorded[t.name] = { buildSuccess: errs === 0, durationMs: build.duration ?? 0, diagnostics: diags };
		console.log(`  ${errs === 0 ? "✓" : "✗"} ${t.name.padEnd(34)} (${i + 1}/${tests.length}) errors=${errs} warnings=${diags.length - errs}`);
	}

	// final reset to empty
	if (prevFile) rmSync(prevFile, { force: true });
	writeFileSync(plcPrgFile, BARE_PLC_PRG, "utf-8");
	volt(ws, "push", "--force", "--no-drift-check");

	writeFileSync(
		OUTPUT,
		`${JSON.stringify({ $schema: `./expected-${VENDOR}.schema.json`, _doc: "Auto-generated by `bun run record:language`. Do not edit by hand — re-record after editing the catalog.", recorded: { at: process.env.RECORD_AT ?? "", bridgeVersion: "1.0.0", testCount: Object.keys(recorded).length }, tests: recorded }, null, 2)}\n`,
		"utf-8",
	);
	console.log(`\nwrote ${OUTPUT} (${Object.keys(recorded).length} tests)`);
}

function findFile(dir: string, name: string): string | undefined {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.isFile() && e.name === name) return join(dir, e.name);
		if (e.isDirectory()) {
			const hit = findFile(join(dir, e.name), name);
			if (hit) return hit;
		}
	}
	return undefined;
}

await main();
