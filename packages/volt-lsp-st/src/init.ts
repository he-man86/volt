/**
 * `volt-lsp-st init` — copy the CODESYS reference corpus into a
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
 *     └─ codesys-reference/             ← corpus
 *        ├─ 00-index.md
 *        ├─ 07-pragmas.md
 *        └─ ...
 *
 * Idempotent. Re-running with --update refreshes the corpus and
 * rewrites SKILL.md from the canonical template.
 */
import { mkdir, readdir, readFile, writeFile, stat, copyFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DOCS_DIR = join(PKG_DIR, "docs", "codesys-reference");

const SKILL_DIR_REL = ".claude/skills/st-reference";
const SKILL_REL_PATH = `${SKILL_DIR_REL}/SKILL.md`;
const REFERENCE_REL_PATH = `${SKILL_DIR_REL}/codesys-reference`;
const VERSION_MARKER_REL_PATH = `${SKILL_DIR_REL}/.volt-lsp-st-version`;
// Path SKILL.md uses to reference its sibling corpus folder.
const REFERENCE_REL_FROM_SKILL = "codesys-reference";

const SKILL_MD_TEMPLATE = `---
name: st-reference
description: IEC 61131-3 Structured Text reference for CODESYS and TwinCAT 3 — pragmas, FB lifecycle, shadowing, init slots, error catalog. Load when writing or reviewing .st files.
license: MIT
metadata:
  language: structured-text
  source-package: "@opencode-ai/volt-lsp-st"
  installed-by: "volt-lsp-st init"
---

## Purpose

Authoritative CODESYS / TwinCAT 3 Structured Text language reference, installed into this workspace by \`volt-lsp-st init\` (run via \`volt init\`). Use when writing or reviewing \`.st\` files.

## Where the docs live

\`\`\`
${REFERENCE_REL_FROM_SKILL}/
\`\`\`

(sibling folder of this SKILL.md — full path \`${REFERENCE_REL_PATH}/\`)

Start at \`${REFERENCE_REL_FROM_SKILL}/00-index.md\` for the full table of contents.

## Files to read first

Pretraining is unreliable for ST — vendor-specific pragmas, lifecycle slots, and shadowing rules are easy to get wrong from memory. Always check the reference before guessing:

- \`${REFERENCE_REL_FROM_SKILL}/07-pragmas.md\` — pragmas that silently change behavior
- \`${REFERENCE_REL_FROM_SKILL}/09-shadowing.md\` — name-resolution search order
- \`${REFERENCE_REL_FROM_SKILL}/11-fb-lifecycle.md\` — \`FB_Init\` / \`FB_Reinit\` / \`FB_Exit\` rules
- \`${REFERENCE_REL_FROM_SKILL}/12-global-init-slots.md\` — global init slot ordering
- \`${REFERENCE_REL_FROM_SKILL}/13-error-messages.md\` — compiler error catalog

Use the Read tool to pull only the section you need.

## Updates

Run \`volt-lsp-st init --update\` (or \`volt init --force\`) to refresh the corpus when the LSP package version changes.
`;

export interface InitOptions {
	/** Target project root (everything lands under `.claude/skills/st-reference/`). */
	targetDir: string;
	/** Refresh an existing install. If false (default), reuses existing docs. */
	update?: boolean;
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
	const sourceDir = opts.sourceDir ?? SOURCE_DOCS_DIR;
	const targetDir = resolve(opts.targetDir);
	const destDocsDir = join(targetDir, REFERENCE_REL_PATH);
	const skillPath = join(targetDir, SKILL_REL_PATH);
	const versionMarkerPath = join(targetDir, VERSION_MARKER_REL_PATH);

	// Sanity-check source corpus exists.
	try {
		const s = await stat(sourceDir);
		if (!s.isDirectory()) throw new Error("not a directory");
	} catch {
		throw new Error(
			`Source corpus not found at ${sourceDir}. ` +
				`The volt-lsp-st package may be missing the docs/ tree.`,
		);
	}

	// Check existing install.
	const existingVersion = await readMaybe(versionMarkerPath);
	if (existingVersion !== undefined && opts.update !== true) {
		log(`Corpus already installed (version ${existingVersion.trim()}). ` +
			`Use --update to refresh.`);
		return {
			docsDir: destDocsDir,
			skillPath,
			versionMarkerPath,
			filesCopied: 0,
			skillAction: "unchanged",
		};
	}

	// Copy corpus files.
	await mkdir(destDocsDir, { recursive: true });
	const entries = await readdir(sourceDir);
	let filesCopied = 0;
	for (const entry of entries) {
		const src = join(sourceDir, entry);
		const s = await stat(src);
		if (!s.isFile()) continue;
		await copyFile(src, join(destDocsDir, entry));
		filesCopied++;
	}

	// Write SKILL.md. Always rewrite from the canonical template so
	// content stays in sync with the package version. The skill body
	// is fully ours — users who want custom guidance should put it in
	// their own AGENTS.md or in a separate skill.
	const existingSkill = await readMaybe(skillPath);
	await mkdir(dirname(skillPath), { recursive: true });
	await writeFile(skillPath, SKILL_MD_TEMPLATE, "utf-8");
	const skillAction: InitResult["skillAction"] = existingSkill === undefined ? "created" : "updated";

	// Write version marker.
	const version = opts.version ?? (await readPackageVersion());
	await writeFile(versionMarkerPath, version + "\n", "utf-8");

	log(`Installed CODESYS reference at ${destDocsDir} (${filesCopied} files)`);
	log(`${skillAction === "created" ? "Created" : "Updated"} ${skillPath}`);
	log(`Wrote version marker ${versionMarkerPath} = ${version}`);

	return {
		docsDir: destDocsDir,
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
