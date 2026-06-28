/**
 * Diagnostic runner — pass a directory, get every diagnostic that fires.
 * Usage: bun run scripts/run-diagnostics.ts <path>
 *
 * Builds a full project scope from ALL .st files in the directory tree,
 * then runs computeSemanticDiagnostics on each file with ALL checks enabled.
 * Prints only diagnostics that fire so we can see real false-positives vs
 * real issues.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { parseSource } from "../src/parser/parser.js";
import { buildSymbolTable, type SymbolTableInput } from "../src/semantic/symbol-table-build.js";
import { computeSemanticDiagnostics } from "../src/semantic/diagnostics.js";
import { buildBodyModelsForParseResult } from "../src/semantic/body.js";
import { DEFAULT_DIAGNOSTIC_CONFIG } from "../src/lsp/config/index.js";

const root = process.argv[2];
if (!root) {
	console.error("Usage: bun run scripts/run-diagnostics.ts <project-dir>");
	process.exit(1);
}

const ST_EXTENSIONS = new Set([".st", ".enum", ".struct", ".union", ".alias", ".gvl"]);

function collectSt(dir: string): string[] {
	const result: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const s = statSync(full);
		if (s.isDirectory()) result.push(...collectSt(full));
		else if (ST_EXTENSIONS.has(extname(entry))) result.push(full);
	}
	return result;
}

const files = collectSt(root);
console.log(`Scanning ${files.length} .st files in ${root}\n`);

// Build full project scope (all files together so cross-file resolution works).
const inputs: SymbolTableInput[] = files.map((f) => {
	const source = readFileSync(f, "utf-8");
	return { uri: `file:///${f.replace(/\\/g, "/")}`, parseResult: parseSource(source), source };
});
const project = buildSymbolTable(inputs);

// ALL checks ON — we want to see everything that fires.
const config = {
	...DEFAULT_DIAGNOSTIC_CONFIG,
	shadowingDeclaration: true,
	unknownPragma: true,
	wrongVendorPragma: false, // skip vendor-specific — needs vendor detection
	initSlotCollision: true,
};

const bySeverity: Record<string, number> = {};
const byCode: Record<string, number> = {};
let total = 0;

for (const input of inputs) {
	const { parseResult, source, uri } = input;
	const bodyModels = buildBodyModelsForParseResult(parseResult);
	const diags = computeSemanticDiagnostics({
		parseResult,
		source,
		project,
		config,
		bodyModels,
	});

	// Include parse errors so syntax issues show up in the corpus run.
	const parseErrors = parseResult.errors.map((e) => ({
		severity: "error" as const,
		span: e.span,
		source: "volt-lsp-codesys",
		code: "parse-error",
		message: e.message,
	}));
	const allDiags = [...parseErrors, ...diags];

	if (allDiags.length === 0) continue;
	const rel = relative(root, uri.replace("file:///", "").replace(/\//g, "\\"));
	console.log(`\n── ${rel} (${allDiags.length} diagnostic${allDiags.length > 1 ? "s" : ""})`);
	for (const d of allDiags) {
		console.log(`  [${d.severity}] ${d.code}  L${d.span.start.line + 1}: ${d.message}`);
		bySeverity[d.severity] = (bySeverity[d.severity] ?? 0) + 1;
		byCode[d.code] = (byCode[d.code] ?? 0) + 1;
		total++;
	}
}

console.log("\n══ Summary ══════════════════════════════════════════");
console.log(`Total: ${total} diagnostics across ${files.length} files\n`);
console.log("By code:");
for (const [code, count] of Object.entries(byCode).sort((a, b) => b[1] - a[1]))
	console.log(`  ${code}: ${count}`);
console.log("\nBy severity:");
for (const [sev, count] of Object.entries(bySeverity).sort((a, b) => b[1] - a[1]))
	console.log(`  ${sev}: ${count}`);
