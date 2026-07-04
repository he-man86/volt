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
import { readFileSync } from "node:fs";
import { extname, relative } from "node:path";
import { parseSource } from "../src/parser/parser.js";
import { buildSymbolTable, type SymbolTableInput } from "../src/semantic/symbol-table-build.js";
import { computeSemanticDiagnostics } from "../src/semantic/diagnostics.js";
import { buildBodyModelsForParseResult } from "../src/semantic/body.js";
import { resolveConfig } from "../src/lsp/config/index.js";
import { loadLibraryNamespaces, loadDeviceInstances } from "../src/semantic/reference-catalog.js";
import { hasNoBuildGroundTruth } from "../src/semantic/exclude-marker.js";
import { walkFiles } from "../src/fs-walk.js";
import type { Expr, StatementList } from "../src/parser/ast.js";
import { parseStatements } from "../src/parser/statements.js";

// Every writable source kind is named by its kind (bridge: ItemKind.ExtFor).
export const KIND_EXTS = new Set([".fb", ".prg", ".fun", ".itf", ".struct", ".enum", ".union", ".alias", ".gvl"]);

export interface Coverage {
	files: number;
	units: number;
	parseCleanFiles: number;
	parseErrors: number;
	ingestFiles: number; // files yielding ≥1 unit
	filesNoUnits: number;
	totalDiags: number; // diagnostics on BUILT files only — the honest precision number (excluded files have no ground truth)
	byCode: Record<string, number>; // built-only
	parseErrByMsg: Record<string, number>;
	parseErrFiles: { file: string; count: number }[];
	noUnitFiles: string[];
	excludedFiles: number; // corpus files excluded from build (diagnostics not counted — CODESYS never compiles them)
	excludedDiags: number; // diagnostics suppressed because their file is excluded (informational)
	// ── ST body AST (st-body-ast) ──
	stBodies: number; // ST (non-VG) bodies encountered
	stBodiesClean: number; // ST bodies that parsed fully into the statement tree (parseStatements ok)
	identMismatchBodies: number; // ST bodies where a token-scan identifier is missing from the AST (a mis-parse)
	identMismatchSamples: string[]; // "file :: name@offset" samples of a genuine mismatch (capped) — expected empty
	parseFailReasons: Record<string, number>; // normalized first-error message → count, for ok=false bodies (triage)
	parseFailSamples: string[]; // "file :: <first error>" samples of ok=false bodies (capped) — the fallback tail, not a defect
}

/** Byte offsets of every NAME node in an expression (idents, member names, named-arg params). */
function collectExprNameOffsets(e: Expr, out: Set<number>): void {
	switch (e.kind) {
		case "ident_expr": out.add(e.span.start); break;
		case "literal": break;
		case "binary": collectExprNameOffsets(e.left, out); collectExprNameOffsets(e.right, out); break;
		case "unary": collectExprNameOffsets(e.operand, out); break;
		case "member": collectExprNameOffsets(e.base, out); out.add(e.member.span.start); break;
		case "index": collectExprNameOffsets(e.base, out); for (const i of e.indices) collectExprNameOffsets(i, out); break;
		case "deref": collectExprNameOffsets(e.base, out); break;
		case "call":
			collectExprNameOffsets(e.callee, out);
			for (const a of e.args) { if (a.param) out.add(a.param.span.start); collectExprNameOffsets(a.value, out); }
			break;
		case "paren": collectExprNameOffsets(e.inner, out); break;
	}
}

function collectStmtNameOffsets(list: StatementList, out: Set<number>): void {
	for (const s of list) {
		switch (s.kind) {
			case "assign": collectExprNameOffsets(s.target, out); collectExprNameOffsets(s.value, out); break;
			case "call_stmt": collectExprNameOffsets(s.call, out); break;
			case "if":
				for (const b of s.branches) { collectExprNameOffsets(b.cond, out); collectStmtNameOffsets(b.body, out); }
				if (s.elseBody) collectStmtNameOffsets(s.elseBody, out);
				break;
			case "case":
				collectExprNameOffsets(s.selector, out);
				for (const arm of s.arms) {
					for (const l of arm.labels) { collectExprNameOffsets(l.value, out); if (l.upper) collectExprNameOffsets(l.upper, out); }
					collectStmtNameOffsets(arm.body, out);
				}
				if (s.elseBody) collectStmtNameOffsets(s.elseBody, out);
				break;
			case "for":
				collectExprNameOffsets(s.controlVar, out); collectExprNameOffsets(s.from, out); collectExprNameOffsets(s.to, out);
				if (s.by) collectExprNameOffsets(s.by, out);
				collectStmtNameOffsets(s.body, out);
				break;
			case "while": collectExprNameOffsets(s.cond, out); collectStmtNameOffsets(s.body, out); break;
			case "repeat": collectStmtNameOffsets(s.body, out); collectExprNameOffsets(s.until, out); break;
			case "return": case "exit": case "continue": case "empty": break;
		}
	}
}

function collect(dir: string): string[] {
	const out: string[] = [];
	for (const file of walkFiles(dir)) {
		if (KIND_EXTS.has(extname(file).toLowerCase())) out.push(file);
	}
	return out;
}

const normMsg = (m: string) => m.replace(/'[^']*'/g, "'X'").replace(/"[^"]*"/g, '"X"').replace(/\b\d+\b/g, "N");

/** Run the three coverage axes over `root` with the given vendor config. Pure — no I/O beyond reading. */
export function computeCoverage(
	root: string,
	vendor: "codesys" | "twincat" = "codesys",
): Coverage {
	const files = collect(root);
	const rel = (uri: string) => relative(root, uri.replace("file:///", "")).replace(/\//g, "\\");
	const inputs: SymbolTableInput[] = files.map((f) => {
		const source = readFileSync(f, "utf-8");
		return { uri: `file:///${f.replace(/\\/g, "/")}`, parseResult: parseSource(source), source };
	});
	const project = buildSymbolTable(inputs);
	const config = resolveConfig({ vendor }).diagnostics;
	const libraryNamespaces = loadLibraryNamespaces(root);   // .library files — resolves library refs
	const deviceInstances = loadDeviceInstances(root);       // .device files — resolves device-tree globals

	const cov: Coverage = {
		files: files.length, units: 0, parseCleanFiles: 0, parseErrors: 0, ingestFiles: 0,
		filesNoUnits: 0, totalDiags: 0, byCode: {}, parseErrByMsg: {}, parseErrFiles: [], noUnitFiles: [],
		excludedFiles: 0, excludedDiags: 0,
		stBodies: 0, stBodiesClean: 0, identMismatchBodies: 0, identMismatchSamples: [], parseFailReasons: {}, parseFailSamples: [],
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
		// Parsing/ingest cover EVERY file (even excluded — they still materialize), but diagnostics on an
		// excluded file have no ground truth (CODESYS never compiles it), so they are suppressed from the
		// precision number, exactly as the live LSP gates them. Signalled by the in-file marker.
		// No compiler ground truth = an explicitly-excluded object OR dead/uncompiled code (both marked in-file
		// by the bridge on a verbose harvest). Its diagnostics are suppressed from the precision number.
		const isExcluded = hasNoBuildGroundTruth(source);
		const bodyModels = buildBodyModelsForParseResult(parseResult);
		// ST body-AST coverage + identifier-set equivalence (st-body-ast). A body's AST must cover every
		// identifier the token scan found; a miss means a mis-parse. Keyword-function names (ADR, SIZEOF) are
		// in the AST but not the scan — that asymmetry is expected, so we check scan ⊆ AST, not equality.
		for (const model of bodyModels.values()) {
			if (model.language !== "st") continue;
			cov.stBodies++;
			if (!model.statementsOk || model.statements === undefined) {
				const raw = parseStatements(model.st).firstError ?? "unknown";
				// Keep the offending token char for "expected expression, got punct 'X'" so we see WHICH punct.
				const reason = raw.startsWith("expected expression, got punct") ? raw : normMsg(raw);
				cov.parseFailReasons[reason] = (cov.parseFailReasons[reason] ?? 0) + 1;
				if (cov.parseFailSamples.length < 20) cov.parseFailSamples.push(`${rel(input.uri)} :: ${raw}`);
				continue;
			}
			cov.stBodiesClean++;
			const astOffsets = new Set<number>();
			collectStmtNameOffsets(model.statements, astOffsets);
			let mismatch = false;
			for (const id of model.identifiers) {
				if (!astOffsets.has(id.span.start)) {
					mismatch = true;
					if (cov.identMismatchSamples.length < 20) cov.identMismatchSamples.push(`${rel(input.uri)} :: ${id.name}@${id.span.start}`);
				}
			}
			if (mismatch) cov.identMismatchBodies++;
		}
		for (const d of computeSemanticDiagnostics({ parseResult, source, project, config, bodyModels, libraryNamespaces, deviceInstances })) {
			if (isExcluded) { cov.excludedDiags++; continue; }
			cov.byCode[d.code] = (cov.byCode[d.code] ?? 0) + 1;
			cov.totalDiags++;
		}
		if (isExcluded) cov.excludedFiles++;
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
	console.log(`3. PRECISION ${c.totalDiags} diagnostics on BUILT files (target 0) — ${c.excludedFiles} files excluded from build (${c.excludedDiags} diags suppressed, no ground truth)`);
	console.log(`4. ST BODY-AST ${c.stBodiesClean}/${c.stBodies} bodies parse clean (${pct(c.stBodiesClean, c.stBodies)}) — ${c.identMismatchBodies} identifier-set mismatches (want 0)`);
	if (c.identMismatchSamples.length > 0) for (const s of c.identMismatchSamples.slice(0, 10)) console.log(`     MISMATCH (defect): ${s}`);
	const reasons = Object.entries(c.parseFailReasons).sort((a, b) => b[1] - a[1]);
	if (reasons.length > 0) { console.log(`\n   TOP ok=false reasons (safe fallback tail, not defects):`); for (const [msg, n] of reasons.slice(0, 12)) console.log(`     ${n}\t${msg}`); }
	console.log(`\n   diagnostics by code:`);
	for (const [code, n] of Object.entries(c.byCode).sort((a, b) => b[1] - a[1])) console.log(`     ${code}: ${n}`);
	console.log(`\n   TOP PARSE-ERROR messages (normalized):`);
	for (const [msg, n] of Object.entries(c.parseErrByMsg).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`     ${n}\t${msg}`);
	if (process.argv.includes("--list")) {
		console.log(`\n── files with parse errors (${c.parseErrFiles.length}) ──`);
		for (const { file, count } of c.parseErrFiles.sort((a, b) => b.count - a.count).slice(0, 40)) console.log(`   ${count}\t${file}`);
	}
}
