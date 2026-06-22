/**
 * VG ↔ CODESYS headless end-to-end check.
 *
 * Proves the volt-lsp-st VG support handles the REAL VG text the bridge
 * emits (not just hand-written fixtures): push a set of graphical POUs to
 * the live headless bridge, fetch each back as its canonical VG, then run
 * the full LSP pipeline over it and assert:
 *
 *   1. the body is recognised as VG and parses with ZERO structural
 *      diagnostics (VG_PARSE / VG_BAD_EXPRESSION / …);
 *   2. no false code-correctness diagnostics (undeclared identifier, …);
 *   3. the LSP canonical writer round-trips the bridge's body byte-exact
 *      (per-line, indentation-insensitive) — i.e. the LSP agrees with the
 *      bridge on what canonical VG looks like.
 *
 * Usage (with the headless bridge already up on :8556):
 *   pwsh script/codesys-bridge.ps1 up
 *   cd packages/volt-lsp-st && bun run scripts/vg-codesys-e2e.ts
 *
 * Override the port with VOLT_BRIDGE_PORT (CODESYS 8556 / Beckhoff 8555).
 */
import { parseSource } from "../src/parser/parser.js";
import { buildSymbolTable } from "../src/semantic/symbol-table-build.js";
import { buildBodyModelsForParseResult } from "../src/semantic/body.js";
import { computeSemanticDiagnostics } from "../src/semantic/diagnostics.js";
import { DEFAULT_DIAGNOSTIC_CONFIG } from "../src/lsp/config/index.js";
import { writeVgBody } from "../src/vg/index.js";

const PORT = Number.parseInt(process.env.VOLT_BRIDGE_PORT ?? "8556", 10);
const BASE = `http://127.0.0.1:${PORT}`;
const PREFIX = "VltLspE2E";

async function get(path: string): Promise<any> {
	return (await fetch(`${BASE}${path}`)).json();
}
async function post(path: string, body: unknown): Promise<any> {
	const r = await fetch(`${BASE}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	return r.json();
}

// Graphical POU sources covering the FBD/LD feature surface (mirrors the
// bridge's own graphical/roundtrip.test.ts generators).
function prog(name: string, lang: string, body: string, vars = "\ta : BOOL;\n\tb : BOOL;\n\tout : BOOL;"): string {
	return `PROGRAM ${name}\nVAR\n${vars}\nEND_VAR\n\nNETWORK 0 ${lang}\n${body}\nEND_NETWORK\nEND_PROGRAM\n`;
}

interface Case {
	key: string;
	ext: "fbd" | "ld";
	src: (name: string) => string;
}

const CASES: Case[] = [
	{ key: "fbd_notout", ext: "fbd", src: (n) => prog(n, "FBD", "  out := NOT (a AND b);") },
	{ key: "ld_and", ext: "ld", src: (n) => prog(n, "LD", "  out := (a AND b);") },
	{ key: "ld_negated", ext: "ld", src: (n) => prog(n, "LD", "  LET i1 := NOT a;\n  out := (i1 AND b);") },
	{
		key: "ld_series3",
		ext: "ld",
		src: (n) => prog(n, "LD", "  out := (a AND b AND c);", "\ta : BOOL;\n\tb : BOOL;\n\tc : BOOL;\n\tout : BOOL;"),
	},
	{
		key: "ld_multicoil",
		ext: "ld",
		src: (n) => prog(n, "LD", "  q := a;\n  r := b;", "\ta : BOOL;\n\tb : BOOL;\n\tq : BOOL;\n\tr : BOOL;"),
	},
	{ key: "ld_setcoil", ext: "ld", src: (n) => prog(n, "LD", "  out := a SET;", "\ta : BOOL;\n\tout : BOOL;") },
];

function bodyRegion(src: string): string {
	const start = src.indexOf("NETWORK");
	const end = src.lastIndexOf("END_NETWORK");
	if (start < 0 || end < 0) return src;
	return src.slice(start, end + "END_NETWORK".length);
}
function norm(s: string): string {
	return s.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter((l) => l.length > 0).join("\n");
}

async function cleanup(): Promise<void> {
	const refs = await get("/refs");
	if (refs.items === undefined) return;
	const ops = Object.keys(refs.items)
		.filter((n) => n.startsWith(PREFIX))
		.map((n) => ({ op: "deleteItem", name: n, ifVersion: refs.items[n] }));
	if (ops.length > 0) await post("/push", { expectedProjectVersion: refs.projectVersion, ops });
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
	console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : `  — ${detail}`}`);
	if (ok) pass++;
	else fail++;
}

async function main(): Promise<void> {
	const health = await get("/health").catch(() => undefined);
	if (health?.status !== "healthy") {
		console.error(`Bridge not healthy on ${BASE}. Bring it up first: pwsh script/codesys-bridge.ps1 up`);
		process.exit(2);
	}
	console.log(`Bridge healthy on ${BASE} — running VG LSP e2e over real CODESYS output\n`);

	await cleanup();
	try {
		for (const c of CASES) {
			const name = `${PREFIX}_${c.key}`;
			const fullName = `${name}.${c.ext}`;
			const refs = await get("/refs");
			const r = await post("/push", {
				expectedProjectVersion: refs.projectVersion,
				ops: [{ op: "pushItem", name: fullName, folder: "", sourceText: c.src(name), ifVersion: null }],
			});
			if (r.accepted !== true) {
				check(`${c.key}: bridge accepted push`, false, JSON.stringify(r.conflicts).slice(0, 160));
				continue;
			}
			const fetched = await post("/fetch", { knownItems: {}, onlyItems: [fullName] });
			const item = (fetched.changed ?? []).find((i: any) => i.name.startsWith(`${name}.`));
			if (item === undefined) {
				check(`${c.key}: fetched back`, false, "item not returned");
				continue;
			}
			const src: string = item.sourceText;

			console.log(`• ${c.key} (${item.name})`);

			// Run the full LSP pipeline over the bridge's canonical VG.
			const parseResult = parseSource(src);
			const project = buildSymbolTable([{ uri: `file:///${item.name}`, parseResult }]);
			const bodyModels = buildBodyModelsForParseResult(parseResult);
			const model = [...bodyModels.values()].find((m) => m.language === "vg");

			check(`${c.key}: LSP sees a VG body`, model !== undefined);
			if (model?.vg === undefined) continue;

			check(
				`${c.key}: parses with zero VG structural diagnostics`,
				model.vg.diagnostics.length === 0,
				model.vg.diagnostics.map((d) => `${d.code}@${d.span.startLine}`).join(", "),
			);

			const diags = computeSemanticDiagnostics({
				parseResult,
				source: src,
				project,
				config: { ...DEFAULT_DIAGNOSTIC_CONFIG, vgNotCanonical: true },
				bodyModels,
			});
			const codeCorrect = diags.filter(
				(d) => d.code === "vg-undeclared-identifier" || d.code === "vg-undefined-label" || d.code === "vg-unknown-pin",
			);
			check(`${c.key}: no false code-correctness diagnostics`, codeCorrect.length === 0, codeCorrect.map((d) => d.message).join("; "));

			// LSP canonical writer agrees with the bridge's canonical body.
			const roundTripOk = norm(writeVgBody(model.vg)) === norm(bodyRegion(src));
			check(`${c.key}: LSP writer round-trips the bridge body`, roundTripOk);
			if (!roundTripOk) {
				console.log("    bridge body:\n" + bodyRegion(src).split("\n").map((l) => "      " + l).join("\n"));
				console.log("    lsp  canon:\n" + writeVgBody(model.vg).split("\n").map((l) => "      " + l).join("\n"));
			}
		}
	} finally {
		await cleanup();
	}

	console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
	process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
