/**
 * git plumbing — the only place we shell out to `git`. Two families:
 *   • object-store ops take the absolute **git dir** (build the refs/volt/ide tree in the object DB)
 *   • worktree ops take the project **root** (status/merge/diff need the working tree)
 *
 * IDE commits use a FIXED author/committer + epoch so the same IDE state yields the same SHA
 * (deterministic — lets the no-churn skip and cross-machine comparison work).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const DET_ENV: Record<string, string> = {
	GIT_AUTHOR_NAME: "ide",
	GIT_AUTHOR_EMAIL: "ide@volt.local",
	GIT_AUTHOR_DATE: "1970-01-01T00:00:00Z",
	GIT_COMMITTER_NAME: "ide",
	GIT_COMMITTER_EMAIL: "ide@volt.local",
	GIT_COMMITTER_DATE: "1970-01-01T00:00:00Z",
};

export class GitError extends Error {
	constructor(
		readonly cmd: string,
		readonly code: number,
		readonly stderr: string,
	) {
		super(`git ${cmd} failed (exit ${code}): ${stderr.trim()}`);
		this.name = "GitError";
	}
}

interface RunOpts {
	input?: string | Buffer;
	env?: Record<string, string>;
	allowFail?: boolean;
}

function git(args: string[], opts: RunOpts = {}): { stdout: string; code: number; stderr: string } {
	const r = spawnSync("git", args, {
		input: opts.input,
		env: { ...process.env, ...opts.env },
		encoding: "utf-8",
		maxBuffer: 1024 * 1024 * 128,
	});
	const code = r.status ?? -1;
	if (!opts.allowFail && (r.error !== undefined || code !== 0)) {
		throw new GitError(args.join(" "), code, r.error !== undefined ? r.error.message : (r.stderr ?? ""));
	}
	return { stdout: r.stdout ?? "", code, stderr: r.stderr ?? "" };
}

// ─── object-store ops (absolute git dir) ────────────────────────────────────

export function writeBlob(gitDir: string, content: string | Buffer): string {
	return git(["--git-dir", gitDir, "hash-object", "-w", "--stdin"], { input: content }).stdout.trim();
}

export function readBlob(gitDir: string, sha: string): string {
	return git(["--git-dir", gitDir, "cat-file", "-p", sha]).stdout;
}

export interface TreeEntry {
	mode: string;
	type: string;
	sha: string;
	path: string;
}

/** Recursive blob listing of a tree/commit (no subtree rows). */
export function listTree(gitDir: string, treeish: string): TreeEntry[] {
	const out = git(["--git-dir", gitDir, "ls-tree", "-r", "--full-tree", treeish]).stdout;
	const entries: TreeEntry[] = [];
	for (const line of out.split("\n")) {
		if (line.length === 0) continue;
		const tab = line.indexOf("\t");
		const meta = line.slice(0, tab).split(" ");
		entries.push({ mode: meta[0]!, type: meta[1]!, sha: meta[2]!, path: line.slice(tab + 1) });
	}
	return entries;
}

export interface IndexEntry {
	mode: string;
	sha: string;
	path: string;
}

/** Build a tree from a flat entry list (handles nested paths via a throwaway index). */
export function buildTree(gitDir: string, entries: readonly IndexEntry[]): string {
	if (entries.length === 0) return EMPTY_TREE;
	const idxDir = mkdtempSync(join(tmpdir(), "voltg-idx-"));
	const indexFile = join(idxDir, "index");
	try {
		const env = { GIT_INDEX_FILE: indexFile };
		const stdin = entries.map((e) => `${e.mode} ${e.sha}\t${e.path}`).join("\n") + "\n";
		git(["--git-dir", gitDir, "update-index", "--index-info"], { input: stdin, env });
		return git(["--git-dir", gitDir, "write-tree"], { env }).stdout.trim();
	} finally {
		rmSync(idxDir, { recursive: true, force: true });
	}
}

export function resolveRef(gitDir: string, ref: string): string | undefined {
	const r = git(["--git-dir", gitDir, "rev-parse", "--verify", "--quiet", ref], { allowFail: true });
	const sha = r.stdout.trim();
	return r.code === 0 && sha.length > 0 ? sha : undefined;
}

export function updateRef(gitDir: string, ref: string, sha: string): void {
	git(["--git-dir", gitDir, "update-ref", ref, sha]);
}

/** Deterministic commit (fixed identity + epoch). `parents` may be empty (root commit). */
export function commitTree(gitDir: string, treeSha: string, parents: readonly string[], message: string): string {
	const args = ["--git-dir", gitDir, "commit-tree", treeSha];
	for (const p of parents) args.push("-p", p);
	args.push("-m", message);
	return git(args, { env: DET_ENV }).stdout.trim();
}

export interface LogEntry {
	sha: string;
	date: string;
	subject: string;
}

/** src-relative paths touched by a commit (--root so a root commit lists all its files). */
export function commitPaths(gitDir: string, sha: string): string[] {
	const out = git(["--git-dir", gitDir, "diff-tree", "-r", "--root", "--name-only", "--no-commit-id", sha]).stdout;
	return out
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.startsWith("src/"))
		.map((l) => l.slice(4));
}

export function listLog(gitDir: string, ref: string, limit: number): LogEntry[] {
	if (resolveRef(gitDir, ref) === undefined) return [];
	const out = git(["--git-dir", gitDir, "log", `--max-count=${limit}`, "--format=%H%x1f%cI%x1f%s", ref]).stdout;
	const entries: LogEntry[] = [];
	for (const line of out.split("\n")) {
		if (line.length === 0) continue;
		const [sha, date, subject] = line.split("\x1f");
		entries.push({ sha: sha!, date: date!, subject: subject ?? "" });
	}
	return entries;
}

// ─── worktree ops (project root) ────────────────────────────────────────────

export function resolveGitDir(root: string): string {
	return git(["-C", root, "rev-parse", "--absolute-git-dir"]).stdout.trim();
}

/** True iff `root` is already inside any git work tree. */
export function isInsideRepo(root: string): boolean {
	const r = git(["-C", root, "rev-parse", "--is-inside-work-tree"], { allowFail: true });
	return r.code === 0 && r.stdout.trim() === "true";
}

export function gitInit(root: string): void {
	git(["init", "--initial-branch=main", "--quiet", root]);
}

/** Load a tree/commit into the index (no worktree change) — used to sync the index after a bootstrap. */
export function readTreeToIndex(root: string, treeish: string): void {
	git(["-C", root, "read-tree", treeish]);
}

export function currentBranch(root: string): string | undefined {
	const r = git(["-C", root, "symbolic-ref", "--quiet", "--short", "HEAD"], { allowFail: true });
	return r.code === 0 ? r.stdout.trim() : undefined;
}

export function headCommit(root: string): string | undefined {
	const r = git(["-C", root, "rev-parse", "--verify", "--quiet", "HEAD"], { allowFail: true });
	const sha = r.stdout.trim();
	return r.code === 0 && sha.length > 0 ? sha : undefined;
}

export function isMerging(root: string): boolean {
	return existsSync(join(resolveGitDir(root), "MERGE_HEAD"));
}

/** Porcelain status lines for `src/` only — drives the commit-before-pull guard. */
export function dirtySrc(root: string): string[] {
	const out = git(["-C", root, "status", "--porcelain", "--", "src"]).stdout;
	return out
		.split("\n")
		.map((l) => l.trimEnd())
		.filter((l) => l.length > 0);
}

export function unmergedPaths(root: string): string[] {
	const out = git(["-C", root, "diff", "--name-only", "--diff-filter=U"]).stdout;
	return out
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
}

export type DiffRow =
	| { kind: "add" | "modify" | "delete"; path: string }
	| { kind: "rename"; oldPath: string; newPath: string; identical: boolean };

function parseDiffRows(out: string): DiffRow[] {
	const rows: DiffRow[] = [];
	for (const line of out.split("\n")) {
		if (line.length === 0) continue;
		const parts = line.split("\t");
		const status = parts[0]!;
		if (status.startsWith("R")) {
			rows.push({ kind: "rename", oldPath: parts[1]!, newPath: parts[2]!, identical: Number.parseInt(status.slice(1), 10) >= 100 });
		} else if (status.startsWith("A")) rows.push({ kind: "add", path: parts[1]! });
		else if (status.startsWith("D")) rows.push({ kind: "delete", path: parts[1]! });
		else rows.push({ kind: "modify", path: parts[1]! });
	}
	return rows;
}

/**
 * Rename-aware name-status diff between two committed refs (`-M` for renames). Both sides are commits,
 * never the working tree: volt diffs git history (refs/volt/ide → HEAD), so only committed work syncs to
 * the IDE — the worktree is the user's editing surface, the same way `git push` only sends commits.
 * `identical` = R100 (pure move/rename, content unchanged).
 */
export function diffRefs(root: string, fromRef: string, toRef: string, pathspec: string): DiffRow[] {
	return parseDiffRows(git(["-C", root, "diff", "-M", "--name-status", fromRef, toRef, "--", pathspec]).stdout);
}

/** Tree SHA of a commit-ish (`<rev>^{tree}`) — the committed tree we mirror to refs/volt/ide on push. */
export function treeOf(root: string, rev: string): string {
	return git(["-C", root, "rev-parse", `${rev}^{tree}`]).stdout.trim();
}

/** Raw bytes of `<ref>:<repoPath>` (e.g. show a file at HEAD / MERGE_HEAD / a merge-base). */
export function gitShowBytes(root: string, ref: string, repoPath: string): Buffer | undefined {
	const r = spawnSync("git", ["-C", root, "show", `${ref}:${repoPath}`], { maxBuffer: 1024 * 1024 * 128 });
	if ((r.status ?? -1) !== 0) return undefined;
	return r.stdout as Buffer;
}

export function mergeBase(root: string, a: string, b: string): string | undefined {
	const r = git(["-C", root, "merge-base", a, b], { allowFail: true });
	return r.code === 0 ? r.stdout.trim() : undefined;
}

export function mergeAbort(root: string): void {
	git(["-C", root, "merge", "--abort"]);
}

/** Finalize a resolved merge (caller must have checked there are no unmerged paths). */
export function mergeContinue(root: string): void {
	git(["-C", root, "commit", "--no-edit"], { env: DET_ENV });
}

/** Resolve one conflicted path by taking a whole side, then stage it. */
export function checkoutSide(root: string, repoPath: string, side: "ours" | "theirs"): void {
	git(["-C", root, "checkout", `--${side}`, "--", repoPath]);
	git(["-C", root, "add", "--", repoPath]);
}

export type MergeOutcome = { kind: "clean" } | { kind: "conflict"; paths: string[] };

/** `git merge <ref>` into the current branch (deterministic identity). Requires a clean tree. */
export function gitMerge(root: string, ref: string, message: string): MergeOutcome {
	const r = git(["-C", root, "merge", "--no-edit", "-m", message, ref], { env: DET_ENV, allowFail: true });
	if (r.code === 0) return { kind: "clean" };
	const conflicts = unmergedPaths(root);
	if (conflicts.length > 0) return { kind: "conflict", paths: conflicts };
	throw new GitError(`merge ${ref}`, r.code, r.stderr); // e.g. "untracked files would be overwritten"
}
