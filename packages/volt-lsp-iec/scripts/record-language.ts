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

// pouName → fixture, for resolving cross-fixture dependencies. Built from ALL_TESTS so a dependency
// outside the selected slice still resolves.
const BY_POU = new Map<string, LanguageTest>(ALL_TESTS.map((t) => [t.pouName, t]));

// global-variable name → the GVL fixture that declares it. A VAR_EXTERNAL / bare-global consumer names
// the VARIABLE (`gShared`), not the GVL item (`GVL_LANG_…`), so pouName scanning alone misses the GVL dep
// and the isolated build fails "No global definition found". Indexed by parsing each GVL fixture's globals.
const BY_GLOBAL = new Map<string, LanguageTest>();
for (const t of ALL_TESTS) {
	if (t.kind !== "gvl") continue;
	for (const unit of parseSource(t.source).units) {
		if (unit.kind !== "global_var_list") continue;
		for (const section of unit.varSections) {
			for (const decl of section.decls) {
				for (const name of decl.names) if (!BY_GLOBAL.has(name.text)) BY_GLOBAL.set(name.text, t);
			}
		}
	}
}

/**
 * The transitive set of OTHER fixtures whose declared type (`pouName`) this test's source names — its
 * EXTENDS base, IMPLEMENTED interface(s), used DUTs, etc. Without them in the isolated project the compiler
 * errors "Unknown type / No definition found" — an isolation artifact, not real language behavior. Resolved
 * by scanning identifiers (fixtures use the distinctive `*_LANG_*` naming, so this is unambiguous).
 */
function depsOf(t: LanguageTest): LanguageTest[] {
	const out: LanguageTest[] = [];
	const seen = new Set<string>([t.pouName]);
	const stack = [t];
	while (stack.length > 0) {
		const cur = stack.pop() as LanguageTest;
		// Scan the fixture source AND its PLC_PRG snippet — an interface test names its impl FB only in
		// plcPrgVar/plcPrgBody, so scanning source alone would miss it.
		const text = `${cur.source}\n${cur.plcPrgVar ?? ""}\n${cur.plcPrgBody ?? ""}`;
		for (const id of new Set(text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [])) {
			if (seen.has(id)) continue;
			const dep = BY_POU.get(id) ?? BY_GLOBAL.get(id);
			// Guard on the RESOLVED dep's pouName, not the identifier: a BY_GLOBAL hit resolves a variable
			// name (`gShared`) to a GVL whose own source re-declares that name, so keying dedup on the raw
			// identifier would let the GVL re-push itself forever (infinite loop). pouName is the identity.
			if (dep === undefined || seen.has(dep.pouName)) continue;
			seen.add(dep.pouName);
			out.push(dep);
			stack.push(dep);
		}
	}
	return out;
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
	// The test item must live in PLC_PRG's OWN folder (the Application) — under src/ so `volt push` ships it,
	// and in the same scope so PLC_PRG can instantiate it. Writing it at the ws root leaves it unpushed and
	// out of scope, and every build fails with "Unknown type: <FB>".
	const appDir = dirname(plcPrgFile);

	const recorded: Record<string, Recorded> = {};
	const mismatches: string[] = []; // fixtures whose compiler verdict contradicts declared expectTcAccepts
	let prevFiles: string[] = [];
	for (const [i, t] of tests.entries()) {
		// 1. reset to empty structure (remove the prior test + its deps + bare PLC_PRG), push.
		for (const f of prevFiles) rmSync(f, { force: true });
		prevFiles = [];
		writeFileSync(plcPrgFile, BARE_PLC_PRG, "utf-8");
		volt(ws, "push", "--force", "--no-drift-check");

		// 2-3. write this test + its dependency fixtures (bases/interfaces/DUTs it references) into PLC_PRG's
		// folder so the compiler can resolve them, then instantiate the test in PLC_PRG.
		const deps = depsOf(t);
		for (const d of [t, ...deps]) {
			const f = join(appDir, `${d.pouName}.${KIND_EXT[d.kind]}`);
			writeFileSync(f, d.source, "utf-8");
			prevFiles.push(f);
		}
		writeFileSync(plcPrgFile, plcPrgFor(t), "utf-8");
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
		const accepts = errs === 0;
		recorded[t.name] = { buildSuccess: accepts, durationMs: build.duration ?? 0, diagnostics: diags };
		console.log(`  ${accepts ? "✓" : "✗"} ${t.name.padEnd(34)} (${i + 1}/${tests.length}) errors=${errs} warnings=${diags.length - errs}${deps.length ? ` deps=${deps.length}` : ""}`);
		// Fixture guard: the compiler is the oracle — if it contradicts the fixture's declared intent, the
		// FIXTURE is broken (a "pass" case that errors, or a "fail" case that compiles clean). Flag it before
		// this ground truth is ever compared against the LSP.
		if (accepts !== t.expectTcAccepts) {
			mismatches.push(t.name);
			console.log(`    ⚠ FIXTURE MISMATCH: declares expectTcAccepts=${t.expectTcAccepts}, but the compiler ${accepts ? "ACCEPTED" : "REJECTED"} it`);
		}
	}

	// final reset to empty
	for (const f of prevFiles) rmSync(f, { force: true });
	writeFileSync(plcPrgFile, BARE_PLC_PRG, "utf-8");
	volt(ws, "push", "--force", "--no-drift-check");

	writeFileSync(
		OUTPUT,
		`${JSON.stringify({ $schema: `./expected-${VENDOR}.schema.json`, _doc: "Auto-generated by `bun run record:language`. Do not edit by hand — re-record after editing the catalog.", recorded: { at: process.env.RECORD_AT ?? "", bridgeVersion: "1.0.0", testCount: Object.keys(recorded).length }, tests: recorded }, null, 2)}\n`,
		"utf-8",
	);
	console.log(`\nwrote ${OUTPUT} (${Object.keys(recorded).length} tests)`);
	if (mismatches.length > 0) {
		console.log(`\n⚠ ${mismatches.length} FIXTURE MISMATCH(es) — the compiler disagreed with the declared intent (fix the fixture or expectTcAccepts):`);
		for (const n of mismatches) console.log(`    ${n}`);
	}
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
