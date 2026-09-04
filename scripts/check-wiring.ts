#!/usr/bin/env bun
/**
 * Sanity-check that Volt's shipped pieces are wired correctly.
 *
 * Run from repo root:
 *   bun scripts/check-wiring.ts
 *
 * Verifies:
 *   - LSP + extension bundles are built (dist/ output present)
 *   - volt-lsp-iec binary actually starts (runs --version)
 *   - CODESYS reference corpus is present in the LSP package
 *   - one product version across the shipped packages
 *   - the writable-source extension set agrees across every runtime that declares it
 *
 * This used to also check an `opencode-config/` layer Volt shipped into opencode's environment. That layer is
 * gone: every host registers Volt itself, and the installer's only contribution is `bin` on PATH.
 */
import { resolve, join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(import.meta.dirname, "..");

let passed = 0;
let failed = 0;

/** true = pass, string = failure reason. */
type Result = boolean | string;

function check(name: string, fn: () => Result): void {
	let result: Result;
	try {
		result = fn();
	} catch (err) {
		result = err instanceof Error ? err.message : String(err);
	}
	report(name, result);
}

function report(name: string, result: Result): void {
	if (result === true) {
		console.log(`  ✓ ${name}`);
		passed++;
		return;
	}
	console.log(`  ✗ ${name}${typeof result === "string" ? ` — ${result}` : ""}`);
	failed++;
}

console.log("Volt wiring check");
console.log("=".repeat(40));

console.log("\nAgent-facing surface");
// The st-reference skill is GENERATED into a consumer project by `volt init`
// (see packages/volt-lsp-iec/src/init.ts) — it is not committed in this repo, so
// assert the installer that produces it is built rather than a committed file.
check("volt-lsp-iec skill installer built (dist/src/init.js)", () =>
	existsSync(join(REPO_ROOT, "packages/volt-lsp-iec/dist/src/init.js"))
		|| "not built — run: bun run --cwd packages/volt-lsp-iec build"
);

console.log("\nBuilt binaries");
// The `volt` PLC CLI is now the .NET binary (packages/volt-cli) — built + tested by the `volt-cli` CI job on
// Windows (dotnet), not here. This key-free Linux check covers the LSP + the agent-config layer only.
check("volt-lsp-iec dist/src/bin.js", () => {
	const path = join(REPO_ROOT, "packages/volt-lsp-iec/dist/src/bin.js");
	return existsSync(path) || "not built — run: bun run --cwd packages/volt-lsp-iec build";
});

console.log("\nRuntime smoke test");
check("volt-lsp-iec --version exits 0", () => {
	const binJs = join(REPO_ROOT, "packages/volt-lsp-iec/dist/src/bin.js");
	if (!existsSync(binJs)) return "dist not built";
	const r = spawnSync("node", [binJs, "--version"], { encoding: "utf-8", timeout: 10_000 });
	return r.status === 0 || `exit ${r.status}: ${(r.stderr || r.stdout).trim()}`;
});

console.log("\nDocumentation corpus");
check("CODESYS reference corpus index", () =>
	existsSync(join(REPO_ROOT, "packages/volt-lsp-iec/docs/codesys-reference/00-index.md"))
		|| "corpus missing in packages/volt-lsp-iec/docs/"
);

// Wire-protocol version parity is gone with the HTTP wire: the toolchain is one C# codebase over the named pipe,
// so there is no separate client/server to keep in lockstep — the pipe host and client compile against one Core.

console.log("\nProduct version parity");
// Volt ships ONE version. volt-desktop is the source of truth (it names the release tag; the same number is
// stamped into every binary's FileVersion, which the connector's auto-updater reads); the .vsix the installer
// sideloads must carry the same number. They're
// separate package.json files because the extension also self-publishes to the Marketplace. release.ts and
// release.yml both refuse a mismatch — but those only run at release, by which point a half-bump is already on
// dev. This runs on every push/PR, so the drift fails in the PR that introduces it.
check("volt-desktop version == volt-vscode version", () => {
	const read = (p: string): string | undefined => {
		const f = join(REPO_ROOT, p, "package.json");
		if (!existsSync(f)) return undefined;
		return JSON.parse(readFileSync(f, "utf-8")).version;
	};
	const desktop = read("packages/volt-desktop");
	const ext = read("packages/volt-vscode");
	if (!desktop) return "packages/volt-desktop/package.json has no version";
	if (!ext) return "packages/volt-vscode/package.json has no version";
	return desktop === ext || `mismatch: volt-desktop=${desktop} volt-vscode=${ext} — Volt ships one version, bump BOTH`;
});

console.log("\nVS Code extension");
check("volt-vscode extension entry compiled", () =>
	existsSync(join(REPO_ROOT, "packages/volt-vscode/dist/extension.js"))
		|| "not built — run: bun run --cwd packages/volt-vscode build"
);
// The extension no longer bundles a CLI — the C# `volt` comes from the Volt install on PATH (a native per-platform
// exe is too heavy for a Marketplace .vsix). It still bundles the LSP server, which runs via the editor's node.
check("volt-vscode LSP server bundled", () =>
	existsSync(join(REPO_ROOT, "packages/volt-vscode/dist/lsp-server.js"))
		|| "not built — run: bun run --cwd packages/volt-vscode build"
);

// ── Source-extension parity (one list, many runtimes) ──────────────────────────────────────────────
// The writable-source extension set is, by necessity, declared in several runtimes that cannot share a
// module: C# (the bridge/CLI source of truth), TypeScript (LSP + control), and static JSON manifests read
// by external tools (VS Code). This guard reads every copy and asserts they agree, so a new
// source kind can never be added to one place and silently missed in another. The C# canonical table
// (ItemKind.SourceKindExtensions) is the reference; every other copy must match it (the workspaceContains
// glob is a superset — it also lists read-only kinds — so it is checked for containment, not equality).
console.log("\nSource-extension parity (one list, many runtimes)");

const bare = (e: string): string => e.replace(/^\./, "").toLowerCase();
const normExts = (exts: Iterable<string>): string[] => [...new Set([...exts].map(bare))].sort();
const readRepo = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf-8");
const quotedStrings = (s: string): string[] => [...s.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

/** Extract a `[ "…", … ]` / `new Set([ "…" ])` string-array literal assigned to `name`. */
function literalArray(src: string, name: string): string[] {
	const m = new RegExp(`${name}[^=]*=\\s*(?:new Set\\()?\\[([^\\]]*)\\]`).exec(src);
	if (!m) throw new Error(`could not find the ${name} literal`);
	return quotedStrings(m[1]);
}

// Canonical: the C# ItemKind.SourceKindExtensions table — (kind, "ext") pairs; take each ext (the quoted string).
// The kind column is a `Kinds.*` const (not a literal), so the first tuple element is a dotted identifier.
// Located by NAME, not by folder. This was a hard-coded `Workspace/ItemKind.cs` and the file moved to
// `Vocabulary/` during the layering restructure — it failed loudly (ENOENT), which is the right failure, but a
// path that has already gone stale once will go stale again. The canonical table is whatever file declares it.
const itemKindPath = (() => {
	const roots = [join(REPO_ROOT, "packages/volt-cli/src/Volt.Engine")];
	while (roots.length) {
		const dir = roots.pop()!;
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const p = join(dir, e.name);
			if (e.isDirectory()) { if (e.name !== "bin" && e.name !== "obj") roots.push(p); }
			else if (e.name === "ItemKind.cs") return p;
		}
	}
	throw new Error("check-wiring: could not find ItemKind.cs under src/Volt.Engine");
})();
const itemKindSrc = readFileSync(itemKindPath, "utf-8");
const canonBlock = /SourceKindExtensions = new \(string, string\)\[\]\s*\{([\s\S]*?)\};/.exec(itemKindSrc);
if (!canonBlock) throw new Error("check-wiring: could not find ItemKind.SourceKindExtensions");
// Mirror `ItemKind.FileExtensions`, which is the kind table with the DUT SPLIT applied: a DUT is one wire kind
// (`dut`) written to disk under four subtype extensions, so `dut` names no file and drops out while the four
// join. Reading both tables from ItemKind keeps this a projection of the canonical source, not a third list.
const dutBlock = /DutFileExtensions = new\[\]\s*\{([^}]*)\}/.exec(itemKindSrc);
if (!dutBlock) throw new Error("check-wiring: could not find ItemKind.DutFileExtensions");
const DUT_FILE_EXTS = [...dutBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const CANON = normExts([
	...[...canonBlock[1].matchAll(/\(\s*(?:"[^"]+"|[\w.]+)\s*,\s*"([^"]+)"\s*\)/g)]
		.map((m) => m[1])
		.filter((ext) => ext !== "dut"),
	...DUT_FILE_EXTS,
]);

const jsonAt = (rel: string, pick: (o: any) => unknown): string[] => {
	const v = pick(JSON.parse(readRepo(rel)));
	if (!Array.isArray(v)) throw new Error(`${rel}: expected an array of extensions`);
	return normExts(v as string[]);
};

// The `{a,b,c}` extension alternation inside the VS Code workspaceContains activation glob.
function workspaceContainsExts(pkg: any): string[] {
	const wc = (pkg.activationEvents as string[]).find((e) => e.startsWith("workspaceContains:"));
	const m = wc && /\{([^}]*)\}/.exec(wc);
	if (!m) throw new Error("no workspaceContains {…} glob in volt-vscode activationEvents");
	return normExts(m[1].split(","));
}

const copies: Array<{ name: string; get: () => string[]; superset?: boolean }> = [
	{ name: "lsp-iec src/source-extensions.ts", get: () => normExts(literalArray(readRepo("packages/volt-lsp-iec/src/source-extensions.ts"), "SOURCE_EXTENSIONS")) },
	{ name: "volt-control src/state/files.ts", get: () => normExts(literalArray(readRepo("packages/volt-control/src/state/files.ts"), "SOURCE_EXTENSIONS")) },
	{ name: "volt-vscode language extensions", get: () => jsonAt("packages/volt-vscode/package.json", (o) => o.contributes?.languages?.find((l: any) => l.id === "structured-text")?.extensions) },
	{ name: "volt-vscode tmLanguage fileTypes", get: () => jsonAt("packages/volt-vscode/languages/structured-text/syntax.tmLanguage.json", (o) => o.fileTypes) },
	{ name: "volt-vscode icon fileExtensions", get: () => normExts(Object.keys(JSON.parse(readRepo("packages/volt-vscode/icons/volt-icons.json")).fileExtensions ?? {})) },
	{ name: "volt-vscode workspaceContains glob", get: () => workspaceContainsExts(JSON.parse(readRepo("packages/volt-vscode/package.json"))), superset: true },
];

for (const { name, get, superset } of copies) {
	check(`${name} matches canonical [${CANON.join(", ")}]`, () => {
		const got = get();
		if (superset) {
			const missing = CANON.filter((e) => !got.includes(e));
			return missing.length === 0 || `glob is missing source ext(s): ${missing.join(", ")}`;
		}
		const same = got.length === CANON.length && got.every((e, i) => e === CANON[i]);
		return same || `has [${got.join(", ")}]`;
	});
}

// Reference extensions the LSP watches (server.ts registers a watcher for a HAND-PICKED subset of the read-only
// reference kinds — the ones it resolves cross-file refs for). They aren't in SOURCE_EXTENSIONS, so the source
// loop above never covered them: assert each is a REAL reference ext in the C# canonical (ItemKind.ReferenceKind-
// Extensions), so a canonical rename can't silently orphan the watcher.
const refBlock = /ReferenceKindExtensions = new \(string, string\)\[\]\s*\{([\s\S]*?)\};/.exec(itemKindSrc);
if (!refBlock) throw new Error("check-wiring: could not find ItemKind.ReferenceKindExtensions");
const REF_CANON = normExts([...refBlock[1].matchAll(/\(\s*(?:"[^"]+"|[\w.]+)\s*,\s*"([^"]+)"\s*\)/g)].map((m) => m[1]));
const serverSrc = readRepo("packages/volt-lsp-iec/src/server/server.ts");
const watchM = /\[\s*\.\.\.SOURCE_EXTENSIONS\s*,\s*([^\]]*)\]/.exec(serverSrc);
check(`lsp server.ts watched reference exts ⊆ canonical [${REF_CANON.join(", ")}]`, () => {
	if (!watchM) return "could not find the [...SOURCE_EXTENSIONS, …] watcher list in server.ts";
	const watched = normExts(quotedStrings(watchM[1]));
	const stray = watched.filter((e) => !REF_CANON.includes(e));
	return stray.length === 0 || `watches non-canonical reference ext(s): ${stray.join(", ")} — add to ItemKind.ReferenceKindExtensions or fix the spelling`;
});

console.log("\n" + "-".repeat(40));
console.log(`${passed} passed, ${failed} failed.`);

if (failed > 0) {
	process.exit(1);
}

console.log("\nOne-time PATH setup (so bare `volt` works in shells / an agent's terminal / the VS Code terminal):");
if (process.platform === "win32") {
	console.log("  PowerShell (this session only):");
	console.log(`    $env:Path = "${join(REPO_ROOT, "packages/volt-cli/dist/Cli")};$env:Path"`);
	console.log("  PowerShell (permanent, current user):");
	console.log(`    [Environment]::SetEnvironmentVariable("Path", "${join(REPO_ROOT, "packages/volt-cli/dist/Cli")};" + [Environment]::GetEnvironmentVariable("Path", "User"), "User")`);
} else {
	console.log("  Bash / zsh (this session only):");
	console.log(`    export PATH="${join(REPO_ROOT, "packages/volt-cli/dist/Cli")}:$PATH"`);
	console.log(`  Bash / zsh (permanent — add to ~/.bashrc or ~/.zshrc):`);
	console.log(`    export PATH="${join(REPO_ROOT, "packages/volt-cli/dist/Cli")}:$PATH"`);
}

// ── Vendor-fact citations ─────────────────────────────────────────────────────────────────────────
// `packages/volt-cli/src/Volt.Engine/Ide/DIALECT.md` is the home for MEASURED vendor behaviour, and the code
// cites its rows by id ("DIALECT D4f"). Two ways that goes wrong, both observed:
//
//   - a citation to a row that does not exist — a typo, or a row renamed/removed. The reader follows it nowhere.
//   - a citation to a row that has been STRUCK THROUGH. Striking is how a measurement is retracted when a later one
//     overturns it, and the retraction only reaches a reader who follows the link. `ICodeStore` spent weeks
//     asserting "TwinCAT cannot take this path" while citing D4 and D4e — both struck by then, both saying the
//     opposite. Nothing connected the two, because nothing was checking.
//
// Deliberately NOT a grep for confident words. That was tried and measured first: over the vendor-facing trees, an
// "absolute claim + vendor name" rule flags 84 comment blocks and 52 of them cite no measurement — but reading
// them, most are section markers and long `<summary>` paragraphs where a vendor and the word "never" merely
// co-occur. A check with that hit rate gets muted within a week and then catches nothing. This rule fires on 3 of
// 24 citations, and all three are worth a look.
type Row = { id: string; retracted: boolean };

// A row id can be struck through (~~D4~~) for TWO different reasons, and only one of them makes a citation
// wrong:
//   CLOSED    — an open question that has since been ANSWERED (D1, D2, D9). Citing it is CORRECT: the row IS
//               the record of the answer. It carries no token and stays citable.
//   RETRACTED — a finding later OVERTURNED (C2, C5, D4, D4e). Citing it hands the reader the opposite of what
//               is now known — which is how ICodeStore spent weeks pointing at D4 and D4e.
//
// Only the second carries the literal `[RETRACTED -> X]`. That is a marker rather than something inferred from
// the prose, and the reason is empirical: reading the verdict out of the words misfired three times. These rows
// say "wrong"/"retracted"/"CLOSED" constantly for incidental reasons — a LIVE row very often opens by saying
// what an earlier row got wrong (C2c, D4f and D10 all do), and pinning the rule to whichever word came first
// did not fix it. Strikethrough alone is not the signal either: D4e was superseded without one.
function dialectRows(): Row[] {
	const md = readFileSync(join(REPO_ROOT, "packages/volt-cli/src/Volt.Engine/Ide/DIALECT.md"), "utf8");
	const rows: Row[] = [];
	for (const line of md.split(/\r?\n/)) {
		const m = /^\|\s*(\*\*)?(~~)?([A-D]\d+[a-z]?)(~~)?(\*\*)?\s*\|(.*)$/.exec(line);
		if (m) rows.push({ id: m[3], retracted: /\[RETRACTED -> /.test(m[6] ?? "") });
	}
	return rows;
}

function citations(): { file: string; line: number; id: string; text: string }[] {
	const out: { file: string; line: number; id: string; text: string }[] = [];
	// TEST is in scope, and leaving it out cost a real hole. An e2e test skipped TwinCAT's graphical move citing
	// C5/D4 ("no move primitive at all") — both retracted — and stayed skipped straight through the entire
	// implementation of that move. A skipped test reports nothing, so nothing else was going to notice.
	const roots = ["packages/volt-cli/src", "packages/volt-cli/docs", "packages/volt-cli/test"];
	const walk = (dir: string): string[] => {
		if (!existsSync(dir)) return [];
		return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
			const p = join(dir, e.name);
			const skip = e.name === "obj" || e.name === "bin" || e.name === "node_modules";
			if (e.isDirectory()) return skip ? [] : walk(p);
			return /\.(cs|ts|md)$/.test(e.name) ? [p] : [];
		});
	};
	const files = [...roots.flatMap((r) => walk(join(REPO_ROOT, r))),
		join(REPO_ROOT, "packages/volt-cli/ARCHITECTURE.md"),
		join(REPO_ROOT, "packages/volt-cli/README.md")].filter(existsSync);
	for (const f of files) {
		// DIALECT.md cites its own rows constantly; it is the source, not a consumer.
		if (f.endsWith("DIALECT.md")) continue;
		readFileSync(f, "utf8").split(/\r?\n/).forEach((text, i) => {
			if (!text.includes("DIALECT")) return;
			for (const m of text.matchAll(/\b([A-D]\d+[a-z]?)\b/g))
				out.push({ file: f.slice(REPO_ROOT.length + 1).replaceAll("\\", "/"), line: i + 1, id: m[1], text: text.trim() });
		});
	}
	return out;
}

console.log("\nVendor-fact citations (DIALECT)");

check("every cited DIALECT row exists", () => {
	const known = new Set(dialectRows().map((r) => r.id));
	const dangling = citations().filter((c) => !known.has(c.id));
	return dangling.length === 0
		|| `${dangling.length} citation(s) name no such row: ` +
			dangling.map((c) => `${c.file}:${c.line} → ${c.id}`).join("; ");
});

check("no code cites a RETRACTED DIALECT row", () => {
	const struck = new Set(dialectRows().filter((r) => r.retracted).map((r) => r.id));
	const stale = citations().filter((c) => struck.has(c.id));
	return stale.length === 0
		|| `${stale.length} citation(s) point at a retracted row — the row says the opposite of what it did when ` +
			`this was written, so re-read it and cite the row that carries the CURRENT measurement: ` +
			stale.map((c) => `${c.file}:${c.line} → ${c.id}`).join("; ");
});

// The standing worklist: claims someone deliberately marked as NOT measured. `[UNMEASURED: …]` is cheap to write
// and, unlike a heuristic, has no false positives — it only finds what an author chose to flag. This prints them
// rather than failing: an honest "nobody has checked this" is the right state for a claim until someone checks it.
check("UNMEASURED markers are enumerable", () => {
	const marked = citationsOfUnmeasured();
	if (marked.length > 0) {
		console.log(`      ${marked.length} open — the list of vendor claims nobody has verified:`);
		for (const m of marked) console.log(`        ${m}`);
	}
	return true;
});

function citationsOfUnmeasured(): string[] {
	const out: string[] = [];
	const walk = (dir: string): string[] => {
		if (!existsSync(dir)) return [];
		return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
			const p = join(dir, e.name);
			if (e.isDirectory()) return e.name === "obj" || e.name === "bin" ? [] : walk(p);
			return /\.(cs|md)$/.test(e.name) ? [p] : [];
		});
	};
	for (const f of walk(join(REPO_ROOT, "packages/volt-cli/src"))) {
		if (f.endsWith("DIALECT.md")) continue;   // it DEFINES the marker; the source, not a consumer
		readFileSync(f, "utf8").split(/\r?\n/).forEach((text, i) => {
			if (!/\[UNMEASURED:/.test(text)) return;
			out.push(`${f.slice(REPO_ROOT.length + 1).replaceAll("\\", "/")}:${i + 1}  ${text.trim().slice(0, 120)}`);
		});
	}
	return out;
}

console.log("\nManual verification — an AI agent (any host):");
console.log("  1. Open a PLC workspace in the agent with `volt` on PATH.");
console.log("  2. Ask: 'run volt status' → the agent shells out to volt; output appears inline.");
console.log("  3. Ask: 'load the st-reference skill' → the agent reads .claude/skills/st-reference.");
console.log("  4. Hosts that register the LSP (the VS Code family via the extension, Claude Code via its plugin)");
console.log("     should show 'volt-lsp-iec' diagnostics on a .fb with a syntax error.");
console.log("\nManual verification — VS Code (with `volt-vscode` extension loaded):");
console.log("  1. code --extensionDevelopmentPath=packages/volt-vscode <your-workspace>");
console.log("  2. Open a .fb (or other kind) file → expect the Volt activity-bar views (IDE Sync / Diagnostics / Bridge) to populate.");
console.log("  3. Cmd/Ctrl+Shift+P → 'Volt: Build' → JSON appears in 'Volt' terminal, diagnostics in Problems panel.");
console.log("  4. Cmd/Ctrl+Shift+P → 'Volt: Push' → quick-pick (normal vs force); force opens modal warning.");
