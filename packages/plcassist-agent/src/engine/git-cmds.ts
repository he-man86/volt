/**
 * Thin wrappers around the git plumbing commands the `engine/` layer
 * uses to materialize bridge state into the hidden `.plcassist/snapshot/`
 * bare repo (blobs, trees, commits) and to diff workspace files against
 * the last-imported snapshot. We shell out to the `git` binary — same
 * dependency the rest of the toolchain relies on — because the binary
 * is the canonical reference for tree/commit semantics.
 *
 * All commits use a FIXED author/committer + epoch date so the same
 * bridge state always produces the same commit SHA. Determinism is
 * load-bearing: it drives the no-churn skip in `plc import` ("nothing
 * changed, don't touch the workspace") and lets us compare snapshots
 * across machines / restarts / time.
 */
import { spawnSync } from "node:child_process";

/** Thrown when a `git` subprocess exits non-zero. Internal — no callers
 *  currently rely on the structured fields, but they're here for the
 *  day someone needs precise error handling. */
class GitCmdError extends Error {
	constructor(public readonly cmd: string, public readonly exitCode: number, public readonly stderr: string) {
		super(`git ${cmd} failed (exit ${exitCode}): ${stderr.trim()}`);
		this.name = "GitCmdError";
	}
}

const DETERMINISTIC_AUTHOR_ENV: Record<string, string> = {
	GIT_AUTHOR_NAME: "ide",
	GIT_AUTHOR_EMAIL: "ide@plcassist.local",
	GIT_AUTHOR_DATE: "1970-01-01T00:00:00Z",
	GIT_COMMITTER_NAME: "ide",
	GIT_COMMITTER_EMAIL: "ide@plcassist.local",
	GIT_COMMITTER_DATE: "1970-01-01T00:00:00Z",
};

interface RunOpts {
	cwd?: string;
	input?: string | Buffer;
	env?: Record<string, string>;
}

function run(args: string[], opts: RunOpts = {}): string {
	const result = spawnSync("git", args, {
		cwd: opts.cwd,
		input: opts.input,
		env: { ...process.env, ...opts.env },
		encoding: "utf-8",
		maxBuffer: 1024 * 1024 * 64, // 64MB — generous for big POU bodies
	});
	if (result.error !== undefined) {
		throw new GitCmdError(args.join(" "), -1, result.error.message);
	}
	if (result.status !== 0) {
		throw new GitCmdError(args.join(" "), result.status ?? -1, result.stderr ?? "");
	}
	return result.stdout;
}

/** Initialize a bare git repo at `path`. Idempotent: no-op if it already exists. */
export function initBareRepo(path: string): void {
	// `git init --bare` is idempotent itself.
	run(["init", "--bare", "--initial-branch=main", "--quiet", path]);
}

/** True when `path` is a bare or non-bare git repo. */
export function isRepo(path: string): boolean {
	const result = spawnSync("git", ["-C", path, "rev-parse", "--git-dir"], { encoding: "utf-8" });
	return result.status === 0;
}

/** Write a blob from `content` into the repo's object store. Returns the blob SHA. */
export function writeBlob(repoPath: string, content: string | Buffer): string {
	return run(["-C", repoPath, "hash-object", "-w", "--stdin"], { input: content }).trim();
}

/** Resolve a ref name (e.g. "HEAD", "refs/heads/main") to its commit SHA. Returns undefined on missing ref. */
export function resolveRef(repoPath: string, ref: string): string | undefined {
	const result = spawnSync("git", ["-C", repoPath, "rev-parse", "--verify", ref], { encoding: "utf-8" });
	if (result.status !== 0) return undefined;
	return result.stdout.trim();
}

/** Update a ref to point to a specific commit SHA. */
export function updateRef(repoPath: string, ref: string, sha: string): void {
	run(["-C", repoPath, "update-ref", ref, sha]);
}

export interface IndexEntry {
	/** Workspace-relative path with forward slashes (e.g. "POUs/FB_Motor.st"). */
	path: string;
	/** Blob SHA. */
	sha: string;
	/** File mode — almost always "100644" for regular text files. */
	mode?: string;
}

/**
 * Build a tree from a flat list of (path, blob-sha) entries using a
 * temporary index file. Returns the root tree SHA. Existing repo index
 * is untouched.
 *
 * We use GIT_INDEX_FILE so concurrent calls don't clobber each other.
 */
export function buildTree(repoPath: string, entries: readonly IndexEntry[]): string {
	const indexPath = `${repoPath}/plcassist-index-${process.pid}-${Date.now()}`;
	const env: Record<string, string> = { GIT_INDEX_FILE: indexPath };
	try {
		for (const e of entries) {
			const mode = e.mode ?? "100644";
			run(
				["-C", repoPath, "update-index", "--add", "--cacheinfo", `${mode},${e.sha},${e.path}`],
				{ env },
			);
		}
		return run(["-C", repoPath, "write-tree"], { env }).trim();
	} finally {
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require("node:fs").unlinkSync(indexPath);
		} catch {
			/* ignore */
		}
	}
}

/**
 * Create a commit object with the given tree, optional parent, and
 * message. Uses fixed author/committer/date for deterministic SHAs —
 * same input always yields the same commit SHA.
 */
export function createDeterministicCommit(
	repoPath: string,
	treeSha: string,
	parentSha: string | undefined,
	message: string,
): string {
	const args = ["-C", repoPath, "commit-tree", treeSha];
	if (parentSha !== undefined) args.push("-p", parentSha);
	args.push("-m", message);
	return run(args, { env: DETERMINISTIC_AUTHOR_ENV }).trim();
}

/**
 * List entries at a given tree SHA, recursively. Each entry is
 * (mode, type, sha, path) — only blob entries are returned (no tree
 * entries themselves, since they're walked into).
 */
export interface TreeEntry {
	mode: string;
	type: "blob" | "tree" | "commit";
	sha: string;
	path: string;
}

export function listTree(repoPath: string, treeSha: string): TreeEntry[] {
	const stdout = run(["-C", repoPath, "ls-tree", "-r", "--full-tree", treeSha]);
	const entries: TreeEntry[] = [];
	for (const line of stdout.split("\n")) {
		if (line.length === 0) continue;
		// Format: "<mode> <type> <sha>\t<path>"
		const tabIdx = line.indexOf("\t");
		if (tabIdx < 0) continue;
		const meta = line.slice(0, tabIdx).split(" ");
		const path = line.slice(tabIdx + 1);
		if (meta.length < 3 || meta[0] === undefined || meta[1] === undefined || meta[2] === undefined) continue;
		const type = meta[1] as "blob" | "tree" | "commit";
		if (type !== "blob" && type !== "tree" && type !== "commit") continue;
		entries.push({ mode: meta[0], type, sha: meta[2], path });
	}
	return entries;
}

/** Read a blob's content as a string (utf-8). */
export function readBlob(repoPath: string, sha: string): string {
	return run(["-C", repoPath, "cat-file", "-p", sha]);
}

/** Read a blob's content as raw bytes. */
export function readBlobBytes(repoPath: string, sha: string): Buffer {
	// `git cat-file -p <sha>` writes raw bytes to stdout
	const result = spawnSync("git", ["-C", repoPath, "cat-file", "-p", sha], {
		maxBuffer: 1024 * 1024 * 64,
	});
	if (result.status !== 0) {
		throw new GitCmdError(`cat-file ${sha}`, result.status ?? -1, result.stderr.toString());
	}
	return result.stdout;
}
