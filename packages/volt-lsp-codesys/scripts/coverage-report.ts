/**
 * LSP coverage over a materialized PLC project corpus — the systematic check of whether the LSP
 * covers a complete real project. Three axes:
 *   1. PARSE   — every file parses with no parse errors.
 *   2. INGEST  — every file yields ≥1 top-level unit into the project symbol table.
 *   3. PRECISION — on a clean-compiling project the LSP raises zero diagnostics; each is a
 *      false-positive suspect. Uses the real vendor-filtered config (masks twincat-only checks on
 *      CODESYS), so the number is honest — unlike run-diagnostics.ts which forces all checks on.
 *
 * `computeCoverage()` is the reusable core (a ratchet test asserts its metrics against the committed
 * corpus); this file's CLI prints a human report.
 * CLI: bun run scripts/coverage-report.ts <corpus-dir> [--vendor codesys|twincat] [--list]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { parseSource } from "../src/parser/parser.js";
import { buildSymbolTable, type SymbolTableInput } from "../src/semantic/symbol-table-build.js";
import { computeSemanticDiagnostics } from "../src/semantic/diagnostics.js";
import { buildBodyModelsForParseResult } from "../src/semantic/body.js";
import { resolveConfig } from "../src/lsp/config/index.js";

// Every writable source kind is named by its kind (bridge: ItemKind.ExtFor).
export const KIND_EXTS = new Set([".fb", ".prg", ".fun", ".itf", ".struct", ".enum", ".union", ".alias", ".gvl"]);

export interface Coverage {
	files: number;
	units: number;
	parseCleanFiles: number;
	parseErrors: number;
	ingestFiles: number; // files yielding ≥1 unit
	filesNoUnits: number;
	totalDiags: number;
	byCode: Record<string, number>;
	parseErrByMsg: Record<string, number>;
	parseErrFiles: { file: string; count: number }[];
	noUnitFiles: string[];
}

function collect(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (entry.startsWith(".") || entry === "node_modules") continue;
		const full = join(dir, entry);
		const s = statSync(full);
		if (s.isDirectory()) out.push(...collect(full));
		else if (KIND_EXTS.has(extname(entry).toLowerCase())) out.push(full);
	}
	return out;
}

const normMsg = (m: string) => m.replace(/'[^']*'/g, "'X'").replace(/"[^"]*"/g, '"X"').replace(/\b\d+\b/g, "N");

/** Run the three coverage axes over `root` with the given vendor config. Pure — no I/O beyond reading. */
export function computeCoverage(root: string, vendor: "codesys" | "twincat" = "codesys"): Coverage {
	const files = collect(root);
	const rel = (uri: string) => relative(root, uri.replace("file:///", "")).replace(/\//g, "\\");
	const inputs: SymbolTableInput[] = files.map((f) => {
		const source = readFileSync(f, "utf-8");
		return { uri: `file:///${f.replace(/\\/g, "/")}`, parseResult: parseSource(source), source };
	});
	const project = buildSymbolTable(inputs);
	const config = resolveConfig({ vendor }).diagnostics;

	const cov: Coverage = {
		files: files.length, units: 0, parseCleanFiles: 0, parseErrors: 0, ingestFiles: 0,
		filesNoUnits: 0, totalDiags: 0, byCode: {}, parseErrByMsg: {}, parseErrFiles: [], noUnitFiles: [],
	};
	for (const input of inputs) {
		const { parseResult, source } = input;
		const pe = parseResult.errors.length;
		if (pe === 0) cov.parseCleanFiles++;
		else {
			cov.parseErrors += pe;
			cov.parseErrFiles.push({ file: rel(input.uri), count: pe });
			for (const e of parseResult.errors) cov.parseErrByMsg[normMsg(e.message)] = (cov.parseErrByMsg[normMsg(e.message)] ?? 0) + 1;
		}
		const units = parseResult.units.length;
		cov.units += units;
		if (units === 0) { cov.filesNoUnits++; cov.noUnitFiles.push(rel(input.uri)); }
		else cov.ingestFiles++;
		const bodyModels = buildBodyModelsForParseResult(parseResult);
		for (const d of computeSemanticDiagnostics({ parseResult, source, project, config, bodyModels })) {
			cov.byCode[d.code] = (cov.byCode[d.code] ?? 0) + 1;
			cov.totalDiags++;
		}
	}
	return cov;
}

// ── CLI ──
if (import.meta.main) {
	const root = process.argv[2];
	if (!root) { console.error("usage: bun run scripts/coverage-report.ts <corpus-dir> [--vendor codesys|twincat] [--list]"); process.exit(1); }
	const vendor = (process.argv.includes("--vendor") && process.argv[process.argv.indexOf("--vendor") + 1] === "twincat" ? "twincat" : "codesys") as "codesys" | "twincat";
	const c = computeCoverage(root, vendor);
	const pct = (n: number, d: number) => (d === 0 ? "n/a" : ((100 * n) / d).toFixed(1) + "%");
	console.log(`\n══ LSP COVERAGE REPORT — vendor: ${vendor} ══════════════════════════`);
	console.log(`corpus: ${c.files} files, ${c.units} top-level units\n`);
	console.log(`1. PARSE     ${c.parseCleanFiles}/${c.files} files clean (${pct(c.parseCleanFiles, c.files)}) — ${c.parseErrors} parse errors in ${c.parseErrFiles.length} files`);
	console.log(`2. INGEST    ${c.ingestFiles}/${c.files} files yield ≥1 unit (${pct(c.ingestFiles, c.files)}) — ${c.filesNoUnits} parsed to 0 units`);
	console.log(`3. PRECISION ${c.totalDiags} diagnostics on the clean project (target 0 — every one is a false-positive suspect)`);
	console.log(`\n   diagnostics by code:`);
	for (const [code, n] of Object.entries(c.byCode).sort((a, b) => b[1] - a[1])) console.log(`     ${code}: ${n}`);
	console.log(`\n   TOP PARSE-ERROR messages (normalized):`);
	for (const [msg, n] of Object.entries(c.parseErrByMsg).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`     ${n}\t${msg}`);
	if (process.argv.includes("--list")) {
		console.log(`\n── files with parse errors (${c.parseErrFiles.length}) ──`);
		for (const { file, count } of c.parseErrFiles.sort((a, b) => b.count - a.count).slice(0, 40)) console.log(`   ${count}\t${file}`);
	}
}
