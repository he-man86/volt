/**
 * `plcassist-st-lsp init` — copy the CODESYS reference corpus into a
 * user's project and add a CLAUDE.md pointer so any AI session in that
 * project knows where to find authoritative ST language docs.
 *
 * Why this exists: the LSP gives AI sessions reactive intelligence
 * (hover/diagnostics) but proactive knowledge — "when should I use
 * FB_Init?" — only flows through the markdown corpus, which only
 * exists in the LSP package's own repo by default. `init` distributes
 * the corpus to consuming projects so every AI session can `Read` it.
 *
 * Idempotent. Re-running with --update refreshes the corpus while
 * preserving any user-added CLAUDE.md content.
 */
import { mkdir, readdir, readFile, writeFile, stat, copyFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DOCS_DIR = join(PKG_DIR, "docs", "codesys-reference");

const VERSION_MARKER = ".plcassist-st-lsp-version";
const REFERENCE_REL_PATH = "docs/codesys-reference";

const CLAUDE_MD_SECTION = `## CODESYS Structured Text reference

A local mirror of the CODESYS ST language reference lives at:
**\`${REFERENCE_REL_PATH}/\`**

Installed by \`plcassist-st-lsp init\`. Run \`plcassist-st-lsp init --update\` to refresh.

When writing or reviewing ST code, **read the relevant section first** — especially:
- \`${REFERENCE_REL_PATH}/07-pragmas.md\` — every pragma and what it silently changes
- \`${REFERENCE_REL_PATH}/09-shadowing.md\` — name-resolution search order
- \`${REFERENCE_REL_PATH}/11-fb-lifecycle.md\` — \`FB_Init\` / \`FB_Reinit\` / \`FB_Exit\` rules
- \`${REFERENCE_REL_PATH}/12-global-init-slots.md\` — init slot table

Start at \`${REFERENCE_REL_PATH}/00-index.md\` for the full table of contents.
`;

const CLAUDE_MD_SECTION_HEADER = "## CODESYS Structured Text reference";

export interface InitOptions {
	/** Target project root (will receive `docs/codesys-reference/` + CLAUDE.md). */
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
	claudeMdPath: string;
	versionMarkerPath: string;
	filesCopied: number;
	claudeMdAction: "created" | "appended" | "unchanged";
}

export async function runInit(opts: InitOptions): Promise<InitResult> {
	const log = opts.log ?? ((m: string): void => console.log(m));
	const sourceDir = opts.sourceDir ?? SOURCE_DOCS_DIR;
	const targetDir = resolve(opts.targetDir);
	const destDocsDir = join(targetDir, REFERENCE_REL_PATH);
	const claudeMdPath = join(targetDir, "CLAUDE.md");
	const versionMarkerPath = join(targetDir, VERSION_MARKER);

	// Sanity-check source corpus exists.
	try {
		const s = await stat(sourceDir);
		if (!s.isDirectory()) throw new Error("not a directory");
	} catch {
		throw new Error(
			`Source corpus not found at ${sourceDir}. ` +
				`The plcassist-st-lsp package may be missing the docs/ tree.`,
		);
	}

	// Check existing install.
	const existingVersion = await readMaybe(versionMarkerPath);
	if (existingVersion !== undefined && opts.update !== true) {
		log(`Corpus already installed (version ${existingVersion.trim()}). ` +
			`Use --update to refresh.`);
		return {
			docsDir: destDocsDir,
			claudeMdPath,
			versionMarkerPath,
			filesCopied: 0,
			claudeMdAction: "unchanged",
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

	// Manage CLAUDE.md.
	const existing = await readMaybe(claudeMdPath);
	let action: InitResult["claudeMdAction"];
	if (existing === undefined) {
		const header = `# Project\n\n`;
		await writeFile(claudeMdPath, header + CLAUDE_MD_SECTION + "\n", "utf-8");
		action = "created";
	} else if (existing.includes(CLAUDE_MD_SECTION_HEADER)) {
		// Section already present — replace it to ensure it reflects the
		// current canonical text.
		const updated = replaceClaudeMdSection(existing);
		await writeFile(claudeMdPath, updated, "utf-8");
		action = "appended";
	} else {
		const sep = existing.endsWith("\n") ? "\n" : "\n\n";
		await writeFile(claudeMdPath, existing + sep + CLAUDE_MD_SECTION + "\n", "utf-8");
		action = "appended";
	}

	// Write version marker.
	const version = opts.version ?? (await readPackageVersion());
	await writeFile(versionMarkerPath, version + "\n", "utf-8");

	log(`Installed CODESYS reference at ${destDocsDir} (${filesCopied} files)`);
	log(`Updated ${claudeMdPath}`);
	log(`Wrote version marker ${versionMarkerPath} = ${version}`);

	return {
		docsDir: destDocsDir,
		claudeMdPath,
		versionMarkerPath,
		filesCopied,
		claudeMdAction: action,
	};
}

/**
 * Replace the existing `## CODESYS Structured Text reference` section
 * with the current canonical text, preserving everything else in the
 * file. A "section" is the header line through the next `## ` (or EOF).
 */
function replaceClaudeMdSection(text: string): string {
	const startIdx = text.indexOf(CLAUDE_MD_SECTION_HEADER);
	if (startIdx === -1) return text + "\n" + CLAUDE_MD_SECTION + "\n";
	// Find the next top-level `## ` after the header (skip the header itself).
	const afterHeader = startIdx + CLAUDE_MD_SECTION_HEADER.length;
	const nextHeaderIdx = text.indexOf("\n## ", afterHeader);
	const endIdx = nextHeaderIdx === -1 ? text.length : nextHeaderIdx + 1;
	return text.slice(0, startIdx) + CLAUDE_MD_SECTION + (endIdx < text.length ? "\n" + text.slice(endIdx) : "\n");
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
