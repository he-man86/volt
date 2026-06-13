/**
 * Thin wrappers around the git plumbing commands the `engine/` layer
 * uses to materialize bridge state into the hidden `.volt/snapshot/`
 * bare repo (blobs, trees, commits) and to diff workspace files against
 * the last-pulled snapshot. We shell out to the `git` binary — same
 * dependency the rest of the toolchain relies on — because the binary
 * is the canonical reference for tree/commit semantics.
 *
 * All commits use a FIXED author/committer + epoch date so the same
 * bridge state always produces the same commit SHA. Determinism is
 * load-bearing: it drives the no-churn skip in `volt pull` ("nothing
 * changed, don't touch the workspace") and lets us compare snapshots
 * across machines / restarts / time.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

/** Thrown when a `git` subprocess exits non-zero. Exported so the CLI
 *  layer can detect it and rewrap into user-friendly VoltErrors. */
export class GitCmdError extends Error {
	readonly cmd: string;
	readonly exitCode: number;
	readonly stderr: string;
	constructor(cmd: string, exitCode: number, stderr: string) {
		super(`git ${cmd} failed (exit ${exitCode}): ${stderr.trim()}`);
		this.name = "GitCmdError";
		this.cmd = cmd;
		this.exitCode = exitCode;
		this.stderr = stderr.trim();
	}
}

/** True iff `err` is a GitCmdError (avoids cross-package instanceof issues). */
export function isGitCmdError(err: unknown): err is GitCmdError {
	return err instanceof Error && err.name === "GitCmdError";
}

const DETERMINISTIC_AUTHOR_ENV: Record<string, string> = {
	GIT_AUTHOR_NAME: "ide",
	GIT_AUTHOR_EMAIL: "ide@volt.local",
	GIT_AUTHOR_DATE: "1970-01-01T00:00:00Z",
	GIT_COMMITTER_NAME: "ide",
	GIT_COMMITTER_EMAIL: "ide@volt.local",
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

/**
 * True when `path` ITSELF is a bare git repo at that exact location.
 *
 * Naive `git rev-parse --git-dir` walks UP the directory tree until it
 * finds a `.git/` — so a non-repo directory nested inside a git working
 * tree appears to be a repo. That bit us in the wild: `.volt/snapshot/`
 * sitting inside a user's git-tracked workspace looked "healthy"
 * because git found the WORKSPACE's `.git/` two levels up. Heal logic
 * never fired, write-tree later failed with "invalid object".
 *
 * Defense: pass `GIT_CEILING_DIRECTORIES=path` so git won't ascend
 * above the candidate root, AND require the discovered git-dir to
 * resolve to `path` itself (a bare repo's git-dir IS its root).
 */
export function isRepo(path: string): boolean {
	const result = spawnSync("git", ["-C", path, "rev-parse", "--git-dir"], {
		encoding: "utf-8",
		env: { ...process.env, GIT_CEILING_DIRECTORIES: path },
	});
	if (result.status !== 0) return false;
	const reported = result.stdout.trim();
	// `--git-dir` returns either "." (when cwd IS the git dir, as in a
	// bare repo whose root is `path`) or an absolute/relative path. A
	// hit on `path`'s OWN bare repo is "." or a path equal to `path`.
	if (reported === "." || reported === path) return true;
	// Some platforms produce a forward-slashed absolute path — normalize
	// before comparing.
	const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
	return norm(reported) === norm(path);
}

/**
 * Write a blob from `content` into the repo's loose-object store.
 * Returns the blob SHA1.
 *
 * Implemented natively in Node (SHA1 + zlib deflate + atomic file
 * write) instead of `git hash-object`. Reason: a full-rebuild pull
 * writes one blob per item — for projects with 30+ items the rapid
 * `git` spawn-storm trips MSYS/Cygwin fork limits on Windows
 * (`VirtualProtect failed`, `uv_spawn EUNKNOWN`, `ENOMEM`). The native
 * path has zero subprocess overhead and produces byte-identical
 * loose-object files (verified against git's own output: same SHA,
 * same on-disk bytes).
 *
 * Loose-object format (git internals):
 *   header   = "blob <size>\0"
 *   payload  = header + content
 *   sha1     = SHA1(payload)
 *   filename = .git/objects/<sha[:2]>/<sha[2:]>
 *   contents = zlib.deflate(payload)
 */
export function writeBlob(repoPath: string, content: string | Buffer): string {
	const data = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
	const header = Buffer.from(`blob ${data.length}\0`, "binary");
	const payload = Buffer.concat([header, data]);
	const sha = createHash("sha1").update(payload).digest("hex");
	// Snapshot is always a BARE repo (see initBareRepo) — objects live
	// directly under `<repoPath>/objects/`. If the directory is missing,
	// the snapshot is corrupted; fail loudly rather than silently
	// creating a half-formed `.git/objects/` next to it (that hides
	// real damage from prior aborted runs).
	const objectsRoot = join(repoPath, "objects");
	if (!existsSync(objectsRoot)) {
		throw new Error(
			`snapshot repo at ${repoPath} is missing objects/ — bare repo is corrupt; ` +
			`delete .volt/snapshot/ and run \`volt pull --force\` to reinitialize.`,
		);
	}
	const objDir = join(objectsRoot, sha.slice(0, 2));
	const objPath = join(objDir, sha.slice(2));
	mkdirSync(objDir, { recursive: true });
	// Loose objects are content-addressed (same SHA = same bytes). Git
	// makes them read-only after writing; if a correct file already
	// exists we can skip. If it's there but partial/corrupt from a
	// previous crash, we'd want to overwrite — but writeFileSync will
	// EPERM on read-only. Use unlink-then-write to handle both cases.
	if (existsSync(objPath)) return sha;
	writeFileSync(objPath, deflateSync(payload));
	return sha;
}

/** Resolve a ref name (e.g. "HEAD", "refs/heads/main") to its commit SHA. Returns undefined on missing ref. */
export function resolveRef(repoPath: string, ref: string): string | undefined {
	const result = spawnSync("git", ["-C", repoPath, "rev-parse", "--verify", ref], { encoding: "utf-8" });
	if (result.status !== 0) return undefined;
	return result.stdout.trim();
}

/**
 * Resolve `<commit>:<path>` to a blob SHA — git's primitive for "what's
 * the content at this path in this commit's tree?". Returns undefined
 * when the path doesn't exist in the tree (used by merge resolution to
 * distinguish "take theirs" from "theirs deleted it").
 */
export function lookupBlobInCommit(
	repoPath: string,
	commitSha: string,
	path: string,
): string | undefined {
	const result = spawnSync(
		"git",
		["-C", repoPath, "rev-parse", "--verify", `${commitSha}:${path}`],
		{ encoding: "utf-8" },
	);
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
	const indexPath = `${repoPath}/volt-index-${process.pid}-${Date.now()}`;
	const env: Record<string, string> = { GIT_INDEX_FILE: indexPath };
	try {
		if (entries.length > 0) {
			// One spawn: feed every entry to `update-index --index-info` via stdin
			// (format: "<mode> <sha>\t<path>") instead of one `update-index` spawn
			// per entry. A full-rebuild pull builds a tree of one blob per item, and
			// the per-entry spawn-storm trips MSYS/Cygwin fork limits on Windows —
			// the same reason writeBlob() is native. Identical resulting tree SHA.
			const stdin = entries
				.map((e) => `${e.mode ?? "100644"} ${e.sha}\t${e.path}`)
				.join("\n") + "\n";
			run(["-C", repoPath, "update-index", "--index-info"], { env, input: stdin });
		}
		return run(["-C", repoPath, "write-tree"], { env }).trim();
	} finally {
		try {
			unlinkSync(indexPath);
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
 * Create a commit object with multiple parents (a merge commit). Same
 * deterministic-SHA contract as `createDeterministicCommit` —
 * identical (tree, parents, message) inputs produce the same commit
 * SHA across machines / restarts.
 */
export function createMergeCommit(
	repoPath: string,
	treeSha: string,
	parents: readonly string[],
	message: string,
): string {
	const args = ["-C", repoPath, "commit-tree", treeSha];
	for (const p of parents) {
		args.push("-p", p);
	}
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

/**
 * One entry in the snapshot's commit history. `timestampSec` is the
 * commit's author time as Unix seconds (UTC); `shaShort` is the
 * 12-char abbreviated sha for display.
 */
export interface LogEntry {
	sha: string;
	shaShort: string;
	timestampSec: number;
	subject: string;
	parentShas: string[];
}

/**
 * List the commits reachable from `ref`, newest first, up to `limit`.
 * Used by `volt log` to surface the snapshot's pull history in the
 * VS Code activity-bar's "Sync history" view.
 *
 * The output is structured (not the human `git log` format) so the
 * UI can parse it without scraping prose.
 */
export function listLog(repoPath: string, ref: string, limit: number): LogEntry[] {
	// `--format` with NUL-separated records + `-z` so commit subjects
	// containing newlines don't break parsing. Each record:
	//   <sha>\x1f<shaShort>\x1f<timestampSec>\x1f<parentShas>\x1f<subject>\x00
	// Field separator: \x1f (ASCII unit separator).
	const format = "%H%x1f%h%x1f%at%x1f%P%x1f%s";
	const stdout = run([
		"-C",
		repoPath,
		"log",
		`--format=${format}`,
		"-z",
		`-n${limit}`,
		ref,
	]);
	const entries: LogEntry[] = [];
	for (const raw of stdout.split("\0")) {
		if (raw.length === 0) continue;
		const parts = raw.split("\x1f");
		if (parts.length < 5) continue;
		entries.push({
			sha: parts[0]!,
			shaShort: parts[1]!,
			timestampSec: Number.parseInt(parts[2]!, 10),
			parentShas: parts[3]!.length > 0 ? parts[3]!.split(" ") : [],
			subject: parts[4]!,
		});
	}
	return entries;
}

/**
 * List paths whose content differs between two commits' trees.
 * Returns the paths (POSIX), no extra metadata — UI shows them as
 * a flat list under the parent commit.
 *
 * When `parentSha` is undefined (initial commit), returns every path
 * present in `commitSha`'s tree.
 */
export function diffPaths(repoPath: string, parentSha: string | undefined, commitSha: string): string[] {
	if (parentSha === undefined) {
		// Initial commit — every path is "added".
		return listTree(repoPath, commitSha)
			.filter((e) => e.type === "blob")
			.map((e) => e.path);
	}
	const stdout = run([
		"-C",
		repoPath,
		"diff-tree",
		"-r",
		"--name-only",
		"--no-commit-id",
		parentSha,
		commitSha,
	]);
	return stdout.split("\n").filter((s) => s.length > 0);
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

/**
 * Read many blobs' raw bytes in ONE `git cat-file --batch` spawn (results in
 * input order). A full-rebuild pull reads back one blob per item to write into
 * the workspace; doing that as one `cat-file -p` spawn each is a Windows
 * fork-limit spawn-storm. Batch output framing per object:
 *   "<sha> <type> <size>\n" <size bytes> "\n"
 */
export function readBlobsBytes(repoPath: string, shas: readonly string[]): Buffer[] {
	if (shas.length === 0) return [];
	const result = spawnSync("git", ["-C", repoPath, "cat-file", "--batch"], {
		input: `${shas.join("\n")}\n`,
		maxBuffer: 1024 * 1024 * 256,
	});
	if (result.status !== 0) {
		throw new GitCmdError("cat-file --batch", result.status ?? -1, (result.stderr ?? Buffer.alloc(0)).toString());
	}
	const out: Buffer = result.stdout;
	const blobs: Buffer[] = [];
	let pos = 0;
	for (let i = 0; i < shas.length; i++) {
		const nl = out.indexOf(0x0a, pos); // LF terminating the header line
		if (nl < 0) throw new GitCmdError("cat-file --batch", -1, "truncated batch output");
		const header = out.toString("utf-8", pos, nl); // "<sha> <type> <size>" | "<sha> missing"
		pos = nl + 1;
		const sp = header.lastIndexOf(" ");
		if (header.endsWith(" missing")) {
			throw new GitCmdError("cat-file --batch", -1, `object ${shas[i]} missing`);
		}
		const size = Number.parseInt(header.slice(sp + 1), 10);
		blobs.push(out.subarray(pos, pos + size));
		pos += size + 1; // content + trailing LF
	}
	return blobs;
}

/**
 * Run `git merge-file -p` against three blob SHAs and return the
 * merged bytes. Cannot use the existing `run()` wrapper because
 * `git merge-file` returns the conflict count as its exit code
 * (≥1 means "merged with N conflicts", still a successful run).
 *
 * Materializes the three blobs to a temp directory under the
 * snapshot, cleaned in finally. Labels are written into the
 * conflict markers (`<<<<<<< <oursLabel>` etc.) — git's CLI
 * defines `-L` once each for ours / base / theirs in that order.
 */
export function mergeFile(
	repoPath: string,
	oursSha: string,
	baseSha: string,
	theirsSha: string,
	oursLabel: string,
	theirsLabel: string,
): { merged: Buffer; hadConflicts: boolean } {
	const tmpDir = mkdtempSync(join(repoPath, ".merge-tmp-"));
	const oursPath = join(tmpDir, "ours");
	const basePath = join(tmpDir, "base");
	const theirsPath = join(tmpDir, "theirs");
	try {
		writeFileSync(oursPath, readBlobBytes(repoPath, oursSha));
		writeFileSync(basePath, readBlobBytes(repoPath, baseSha));
		writeFileSync(theirsPath, readBlobBytes(repoPath, theirsSha));
		const result = spawnSync(
			"git",
			[
				"-C",
				repoPath,
				"merge-file",
				"-p",
				"-L",
				oursLabel,
				"-L",
				"base",
				"-L",
				theirsLabel,
				oursPath,
				basePath,
				theirsPath,
			],
			{ maxBuffer: 1024 * 1024 * 64 },
		);
		if (result.error !== undefined) {
			throw new GitCmdError("merge-file", -1, result.error.message);
		}
		const code = result.status ?? -1;
		// Exit code -1 (or < 0) means git itself failed to launch.
		// Exit code 0 = clean merge. Exit code ≥1 = N conflicts (valid).
		// Exit code 127 = git not found. Anything weird and non-zero
		// stderr-without-stdout we treat as failure.
		if (code < 0 || (code !== 0 && result.stdout.length === 0)) {
			throw new GitCmdError(
				"merge-file",
				code,
				result.stderr.toString() || "merge-file produced no output",
			);
		}
		return { merged: result.stdout, hadConflicts: code !== 0 };
	} finally {
		try {
			rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	}
}

/**
 * Plain-file refs that live at the root of the bare repo (NOT inside
 * `refs/`). Mirrors git's `MERGE_HEAD` / `ORIG_HEAD` / `MERGE_MSG`
 * convention — these are not real refs, just one-line state files.
 *
 * Names we use:
 *   MERGE_HEAD       — commit SHA of "theirs"
 *   ORIG_HEAD        — commit SHA of pre-merge HEAD
 *   MERGE_MSG        — human-readable summary
 *   MERGE_CONFLICTS  — JSON list of {path, kind, reason}
 *
 * Used by the merge engine and read by the VS Code extension.
 */
export function readMergeFile(repoPath: string, name: string): string | undefined {
	const path = join(repoPath, name);
	if (!existsSync(path)) return undefined;
	return readFileSync(path, "utf-8");
}

export function writeMergeFile(repoPath: string, name: string, content: string): void {
	// repoPath always exists (we only call this after the bare repo is
	// initialized), but in case a parent expects mkdir-safety:
	mkdirSync(repoPath, { recursive: true });
	writeFileSync(join(repoPath, name), content);
}

export function deleteMergeFile(repoPath: string, name: string): void {
	try {
		unlinkSync(join(repoPath, name));
	} catch {
		/* ignore — already gone is fine */
	}
}
