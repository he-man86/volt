/**
 * Triage the `unresolved-identifier` false positives on a clean-compiling corpus — answer the
 * question "which are our resolution bugs vs. genuinely external (library/builtin) symbols?"
 *
 * The corpus compiles clean in the IDE, so every unresolved-identifier is a false positive by
 * definition — the symbol resolves *somewhere*. This classifies each by WHERE it actually lives:
 *
 *   A. member-miss   — `X is not a member of Y`: qualified access, base resolved but member didn't.
 *   B. in-corpus      — the bare name IS declared somewhere in the 424 files but wasn't reachable
 *                       from the reference (cross-file / inheritance / GVL-scoping / namespace gap).
 *                       These are OURS to fix.
 *   C. external       — the name is declared NOWHERE in the corpus: a library FB, a 3rd-party symbol,
 *                       or a standard IEC/CODESYS builtin. Unfixable from sources → needs a builtin
 *                       table or a library index, or suppression.
 *
 * CLI: bun run scripts/triage-unresolved.ts <corpus-dir>
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { parseSource } from "../src/parser/parser.js";
import { buildSymbolTable, type SymbolTableInput } from "../src/semantic/symbol-table-build.js";
import { computeSemanticDiagnostics } from "../src/semantic/diagnostics.js";
import { buildBodyModelsForParseResult } from "../src/semantic/body.js";
import { resolveConfig } from "../src/lsp/config/index.js";
import type { Scope } from "../src/semantic/symbol-table.js";
import { KIND_EXTS } from "./coverage-report.js";

// A small set of standard IEC 61131-3 / CODESYS stdlib names that are legitimately external to any
// project (no declaration exists in sources). Not exhaustive — just enough to size the builtin slice.
const IEC_BUILTINS = new Set(
	(
		"ABS SQRT LN LOG EXP SIN COS TAN ASIN ACOS ATAN ATAN2 EXPT " +
		"SEL MUX MAX MIN LIMIT MOVE " +
		"LEN LEFT RIGHT MID CONCAT INSERT DELETE REPLACE FIND " +
		"SHL SHR ROL ROR AND OR XOR NOT " +
		"ADR BITADR SIZEOF REF __NEW __DELETE __ISVALIDREF __QUERYINTERFACE __QUERYPOINTER " +
		"TON TOF TP CTU CTD CTUD R_TRIG F_TRIG RS SR " +
		"GT GE EQ LE LT NE"
	)
		.split(/\s+/)
		.map((s) => s.toLowerCase()),
);

function collect(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (entry.startsWith(".") || entry === "node_modules") continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...collect(full));
		else if (KIND_EXTS.has(extname(entry).toLowerCase())) out.push(full);
	}
	return out;
}

/** Every name declared anywhere in the project (any scope), lowercased. */
function allDeclaredNames(root: Scope): Set<string> {
	const names = new Set<string>();
	const walk = (s: Scope) => {
		for (const key of s.symbols.keys()) names.add(key);
		if (s.name) names.add(s.name.toLowerCase()); // scope's own name (POU/method/struct/…)
		for (const c of s.children) walk(c);
	};
	walk(root);
	return names;
}

const root = process.argv[2];
if (!root) {
	console.error("usage: bun run scripts/triage-unresolved.ts <corpus-dir>");
	process.exit(1);
}

const files = collect(root);
const inputs: SymbolTableInput[] = files.map((f) => {
	const source = readFileSync(f, "utf-8");
	return { uri: `file:///${f.replace(/\\/g, "/")}`, parseResult: parseSource(source), source };
});
const project = buildSymbolTable(inputs);
const declared = allDeclaredNames(project);
const config = resolveConfig({ vendor: "codesys" }).diagnostics;

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
const memberMiss = new Map<string, number>(); // "member of Base" bucket, keyed by member name
const inCorpus = new Map<string, number>(); // bare name declared somewhere in corpus (our bug)
const external = new Map<string, number>(); // bare name declared nowhere
const builtinHits = new Map<string, number>(); // subset of external that is a known IEC builtin
let total = 0;

for (const input of inputs) {
	const bodyModels = buildBodyModelsForParseResult(input.parseResult);
	for (const d of computeSemanticDiagnostics({ parseResult: input.parseResult, source: input.source, project, config, bodyModels })) {
		if (d.code !== "unresolved-identifier") continue;
		total++;
		const name = /^'([^']+)'/.exec(d.message)?.[1] ?? "?";
		const key = name.toLowerCase();
		if (/is not a member of/.test(d.message)) bump(memberMiss, key);
		else if (declared.has(key)) bump(inCorpus, key);
		else {
			bump(external, key);
			if (IEC_BUILTINS.has(key)) bump(builtinHits, key);
		}
	}
}

const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
const top = (m: Map<string, number>, n: number) =>
	[...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v}× ${k}`).join(", ");

console.log(`\n══ UNRESOLVED-IDENTIFIER TRIAGE — ${total} total on a clean corpus (all false positives) ══\n`);
console.log(`A. member-miss   ${sum(memberMiss)}\t(${memberMiss.size} distinct)  — 'x is not a member of Y'`);
console.log(`     ${top(memberMiss, 12)}`);
console.log(`\nB. in-corpus     ${sum(inCorpus)}\t(${inCorpus.size} distinct)  — declared somewhere in the 424 files → OUR resolution bug`);
console.log(`     ${top(inCorpus, 12)}`);
console.log(`\nC. external      ${sum(external)}\t(${external.size} distinct)  — declared nowhere in corpus → library / builtin`);
console.log(`     of which known IEC builtins: ${sum(builtinHits)} (${builtinHits.size} distinct) — ${top(builtinHits, 10)}`);
console.log(`     top external names: ${top(external, 20)}`);
