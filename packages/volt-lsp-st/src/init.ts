/**
 * `volt-lsp-st init` — copy the language reference corpus into a
 * user's project and install a SKILL.md so any AI session in that
 * project (opencode, Claude Code) auto-discovers the ST language
 * reference via the native skill mechanism.
 *
 * Why this exists: the LSP gives AI sessions reactive intelligence
 * (hover/diagnostics) but proactive knowledge — "when should I use
 * FB_Init?" — only flows through the markdown corpus, which only
 * exists in the LSP package's own repo by default. `init` distributes
 * the corpus to consuming projects and registers it as a skill so
 * every AI session can lazy-load it on demand.
 *
 * For TwinCAT projects both `codesys-reference/` (the shared base —
 * TC was forked from CODESYS) and `twincat-reference/` (the deltas)
 * are installed. CODESYS projects only get `codesys-reference/`.
 *
 * Why `.claude/skills/` and not `.opencode/skills/`: per opencode's
 * docs, `.claude/skills/` is the universal location — both opencode
 * and Claude Code discover skills from there. `.opencode/skills/`
 * would be opencode-only.
 *
 * Workspace layout (everything stays under one folder):
 *
 *   .claude/skills/st-reference/
 *     ├─ SKILL.md                       ← skill manifest
 *     ├─ .volt-lsp-st-version           ← version marker
 *     ├─ codesys-reference/             ← shared CODESYS corpus
 *     │  ├─ 00-index.md
 *     │  └─ ...
 *     └─ twincat-reference/             ← TC deltas (TC projects only)
 *        ├─ 00-index.md
 *        └─ ...
 *
 * Idempotent. Re-running with update:true refreshes the corpus and
 * rewrites SKILL.md from the canonical template.
 */
import { mkdir, readdir, readFile, writeFile, stat, copyFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_CODESYS_DOCS_DIR = join(PKG_DIR, "docs", "codesys-reference");
const SOURCE_TC_DOCS_DIR = join(PKG_DIR, "docs", "twincat-reference");

const SKILL_DIR_REL = ".claude/skills/st-reference";
const SKILL_REL_PATH = `${SKILL_DIR_REL}/SKILL.md`;
const CODESYS_REF_REL_PATH = `${SKILL_DIR_REL}/codesys-reference`;
const TC_REF_REL_PATH = `${SKILL_DIR_REL}/twincat-reference`;
const VERSION_MARKER_REL_PATH = `${SKILL_DIR_REL}/.volt-lsp-st-version`;

function buildSkillMd(vendor: "codesys" | "twincat"): string {
	if (vendor === "twincat") {
		return `---
name: st-reference
description: TwinCAT 3 and IEC 61131-3 Structured Text reference — pragmas, FB lifecycle, TC-specific operators, library namespaces, init slots. Load when writing or reviewing .st files in a TwinCAT project.
license: MIT
metadata:
  language: structured-text
  vendor: twincat
  source-package: "@opencode-ai/volt-lsp-st"
  installed-by: "volt-lsp-st init"
---

## Purpose

TwinCAT 3 Structured Text language reference, installed into this workspace by \`volt-lsp-st init\` (run via \`volt init\`). Use when writing or reviewing \`.st\` files.

## Where the docs live

\`\`\`
twincat-reference/     ← TwinCAT-specific (pragmas, operators, library namespaces)
codesys-reference/     ← Shared base (IEC 61131-3 rules, data types, FB lifecycle)
\`\`\`

Both are siblings of this SKILL.md. The TwinCAT reference is "deltas only" — it cross-references \`codesys-reference/\` for shared language rules.

## Files to read first (TwinCAT)

- \`twincat-reference/00-index.md\` — TwinCAT delta index
- \`twincat-reference/07-pragmas.md\` — Tc* attribute pragmas
- \`twincat-reference/03-operators.md\` — \`__NEW\`, \`__DELETE\`, \`__QUERY_INTERFACE\`, etc.
- \`twincat-reference/12-global-init-slots.md\` — TwinCAT-reserved init slot ranges
- \`twincat-reference/14-libraries.md\` — Tc2_*/Tc3_* library naming and imports
- \`twincat-reference/13-error-messages.md\` — compiler and ADS error codes

## Files to read first (shared base)

- \`codesys-reference/07-pragmas.md\` — shared pragmas (both vendors)
- \`codesys-reference/09-shadowing.md\` — name-resolution search order
- \`codesys-reference/11-fb-lifecycle.md\` — \`FB_Init\` / \`FB_Reinit\` / \`FB_Exit\` rules
- \`codesys-reference/13-error-messages.md\` — compiler error catalog

## Updates

Run \`volt init --force\` to refresh the corpus when the LSP package version changes.
`;
	}

	return `---
name: st-reference
description: IEC 61131-3 Structured Text reference for CODESYS — pragmas, FB lifecycle, shadowing, init slots, error catalog. Load when writing or reviewing .st files.
license: MIT
metadata:
  language: structured-text
  vendor: codesys
  source-package: "@opencode-ai/volt-lsp-st"
  installed-by: "volt-lsp-st init"
---

## Purpose

Authoritative CODESYS Structured Text language reference, installed into this workspace by \`volt-lsp-st init\` (run via \`volt init\`). Use when writing or reviewing \`.st\` files.

## Where the docs live

All docs are installed at \`.claude/skills/st-reference/codesys-reference/\` in your project root.

Start at \`.claude/skills/st-reference/codesys-reference/00-index.md\` for the full table of contents.

## Files to read first

Pretraining is unreliable for ST — vendor-specific pragmas, lifecycle slots, and shadowing rules are easy to get wrong from memory. Always check the reference before guessing:

- \`codesys-reference/07-pragmas.md\` — pragmas that silently change behavior
- \`codesys-reference/09-shadowing.md\` — name-resolution search order
- \`codesys-reference/11-fb-lifecycle.md\` — \`FB_Init\` / \`FB_Reinit\` / \`FB_Exit\` rules
- \`codesys-reference/12-global-init-slots.md\` — global init slot ordering
- \`codesys-reference/13-error-messages.md\` — compiler error catalog

Use the Read tool to pull only the section you need.

## Updates

Run \`volt init --force\` to refresh the corpus when the LSP package version changes.
`;
}

export interface InitOptions {
	/** Target project root (everything lands under `.claude/skills/st-reference/`). */
	targetDir: string;
	/** Refresh an existing install. If false (default), reuses existing docs. */
	update?: boolean;
	/**
	 * Active vendor — determines which reference docs are installed.
	 * "codesys" installs codesys-reference only.
	 * "twincat" installs codesys-reference (shared base) + twincat-reference (deltas).
	 * Defaults to "codesys".
	 */
	vendor?: "codesys" | "twincat";
	/** Override source dir — used by tests. Defaults to this package's `docs/`. */
	sourceDir?: string;
	/** LSP package version recorded in the marker. Defaults to package.json version. */
	version?: string;
	/** Where to write progress messages. Defaults to console.log. Test hook. */
	log?: (msg: string) => void;
}

export interface InitResult {
	docsDir: string;
	skillPath: string;
	versionMarkerPath: string;
	filesCopied: number;
	skillAction: "created" | "updated" | "unchanged";
}

export async function runInit(opts: InitOptions): Promise<InitResult> {
	const log = opts.log ?? ((m: string): void => console.log(m));
	const vendor = opts.vendor ?? "codesys";
	const sourceCodesysDir = opts.sourceDir ?? SOURCE_CODESYS_DOCS_DIR;
	const sourceTcDir = join(dirname(opts.sourceDir ?? SOURCE_CODESYS_DOCS_DIR), "twincat-reference");
	const targetDir = resolve(opts.targetDir);
	const destCodesysDir = join(targetDir, CODESYS_REF_REL_PATH);
	const destTcDir = join(targetDir, TC_REF_REL_PATH);
	const skillPath = join(targetDir, SKILL_REL_PATH);
	const versionMarkerPath = join(targetDir, VERSION_MARKER_REL_PATH);

	// Sanity-check source corpus exists.
	try {
		const s = await stat(sourceCodesysDir);
		if (!s.isDirectory()) throw new Error("not a directory");
	} catch {
		throw new Error(
			`Source corpus not found at ${sourceCodesysDir}. ` +
				`The volt-lsp-st package may be missing the docs/ tree.`,
		);
	}

	// Check existing install.
	const existingVersion = await readMaybe(versionMarkerPath);
	if (existingVersion !== undefined && opts.update !== true) {
		log(`Corpus already installed (version ${existingVersion.trim()}). ` +
			`Use --update to refresh.`);
		return {
			docsDir: destCodesysDir,
			skillPath,
			versionMarkerPath,
			filesCopied: 0,
			skillAction: "unchanged",
		};
	}

	// Copy CODESYS reference (always — it's the shared base for both vendors).
	await mkdir(destCodesysDir, { recursive: true });
	const codesysEntries = await readdir(sourceCodesysDir);
	let filesCopied = 0;
	for (const entry of codesysEntries) {
		const src = join(sourceCodesysDir, entry);
		const s = await stat(src);
		if (!s.isFile()) continue;
		await copyFile(src, join(destCodesysDir, entry));
		filesCopied++;
	}
	log(`Installed CODESYS reference at ${destCodesysDir} (${filesCopied} files)`);

	// Copy TwinCAT reference (deltas) when the project is TC.
	if (vendor === "twincat") {
		try {
			const tcStat = await stat(sourceTcDir);
			if (tcStat.isDirectory()) {
				await mkdir(destTcDir, { recursive: true });
				const tcEntries = await readdir(sourceTcDir);
				let tcFiles = 0;
				for (const entry of tcEntries) {
					const src = join(sourceTcDir, entry);
					const s = await stat(src);
					if (!s.isFile()) continue;
					await copyFile(src, join(destTcDir, entry));
					tcFiles++;
					filesCopied++;
				}
				log(`Installed TwinCAT reference at ${destTcDir} (${tcFiles} files)`);
			}
		} catch {
			log(`warning: TwinCAT reference docs not found at ${sourceTcDir} — CODESYS reference only`);
		}
	}

	// Write SKILL.md — always rewrite from the canonical template so
	// content stays in sync with the package version.
	const existingSkill = await readMaybe(skillPath);
	await mkdir(dirname(skillPath), { recursive: true });
	await writeFile(skillPath, buildSkillMd(vendor), "utf-8");
	const skillAction: InitResult["skillAction"] = existingSkill === undefined ? "created" : "updated";

	// Write version marker.
	const version = opts.version ?? (await readPackageVersion());
	await writeFile(versionMarkerPath, version + "\n", "utf-8");

	log(`${skillAction === "created" ? "Created" : "Updated"} ${skillPath}`);
	log(`Wrote version marker ${versionMarkerPath} = ${version}`);

	return {
		docsDir: destCodesysDir,
		skillPath,
		versionMarkerPath,
		filesCopied,
		skillAction,
	};
}

async function readMaybe(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf-8");
	} catch {
		return undefined;
	}
}

async function readPackageVersion(): Promise<string> {
	try {
		const text = await readFile(join(PKG_DIR, "package.json"), "utf-8");
		const m = /"version"\s*:\s*"([^"]+)"/.exec(text);
		return m?.[1] ?? "unknown";
	} catch {
		return "unknown";
	}
}
