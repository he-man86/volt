/**
 * Workspace file IO — reads/writes the `src/` tree (the PLC text) and the root `.gitignore`/
 * `.gitattributes`. All paths here are **src-relative** (e.g. "POUs/FB_Motor.st"); the on-disk
 * location is `<root>/src/<path>`.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gitattributesContent, isTrackedPath } from "../registry/extensions.js";
import { normalizeLineEndings } from "../translate/materialize.js";

export const SRC_DIR = "src";

/** Strip a leading "src/" — repo-relative path → src-relative path. */
export const stripSrcPrefix = (p: string): string => (p.startsWith(`${SRC_DIR}/`) ? p.slice(SRC_DIR.length + 1) : p);

export interface SrcFile {
	path: string;
	content: string;
}

export function writeSrcFiles(root: string, files: readonly SrcFile[]): void {
	for (const f of files) {
		const abs = join(root, SRC_DIR, f.path);
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, f.content);
	}
}

/** All tracked files under `src/`, content normalized to LF. */
export function listSrcFiles(root: string): SrcFile[] {
	const base = join(root, SRC_DIR);
	if (!existsSync(base)) return [];
	const out: SrcFile[] = [];
	const walk = (dir: string, rel: string): void => {
		for (const entry of readdirSync(dir)) {
			const abs = join(dir, entry);
			const r = rel.length > 0 ? `${rel}/${entry}` : entry;
			if (statSync(abs).isDirectory()) walk(abs, r);
			else if (isTrackedPath(r)) out.push({ path: r, content: normalizeLineEndings(readFileSync(abs, "utf-8")) });
		}
	};
	walk(base, "");
	return out;
}

export function readSrcFile(root: string, rel: string): string {
	return normalizeLineEndings(readFileSync(join(root, SRC_DIR, rel), "utf-8"));
}

export function removeSrcFiles(root: string, paths: readonly string[]): void {
	for (const p of paths) {
		const abs = join(root, SRC_DIR, p);
		if (existsSync(abs)) rmSync(abs, { force: true });
	}
}

/** Ensure the root `.gitignore` ignores `/node_modules/`, and `.gitattributes` forces LF. (Volt's own
 *  state lives in `.git/volt/`, which git never tracks — so it needs no ignore entry.) */
export function ensureGitignore(root: string): void {
	const giPath = join(root, ".gitignore");
	const wanted = ["/node_modules/"];
	let lines = existsSync(giPath) ? readFileSync(giPath, "utf-8").split("\n") : [];
	let changed = false;
	for (const w of wanted) {
		if (!lines.some((l) => l.trim() === w)) {
			lines.push(w);
			changed = true;
		}
	}
	if (changed) writeFileSync(giPath, lines.filter((l, i) => !(l === "" && i === lines.length - 1)).join("\n") + "\n");

	const gaPath = join(root, ".gitattributes");
	if (!existsSync(gaPath)) writeFileSync(gaPath, gitattributesContent());
}
