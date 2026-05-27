/**
 * The "snapshot" is a hidden bare git repo at
 * `<workspace>/.plcassist/snapshot/` whose HEAD always equals "what the
 * IDE had at the time of our last successful import or export." It is
 * the ONLY thing `plc export` diffs against — without it, we couldn't
 * tell what the user changed since the last sync.
 *
 * This module owns EVERYTHING about the snapshot:
 *   - lifecycle           (ensureSnapshotRepo)
 *   - state file mgmt     (loadState / saveState — recorded ref pointers)
 *   - workspace I/O       (list / write / remove tracked files)
 *   - workspace ⇄ snapshot (buildWorkspaceTreeSha, detectWorkspaceDirty)
 *
 * Why a bare git repo and not a JSON snapshot:
 *   - We get blob storage, tree objects, and diff for free.
 *   - The translation logic in `ops.ts` already speaks in TreeEntry /
 *     blob SHA terms — no impedance mismatch.
 *   - The user never sees it: it's not a `.git/` folder, it's a
 *     differently-named bare repo that's invisible to their git tools.
 *
 * The user's own git history (if they have one) is independent — they
 * `git init` the workspace itself, and their `.git/` lives alongside
 * our `.plcassist/snapshot/`. We don't touch each other.
 */
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { buildTree, initBareRepo, isRepo, listTree, writeBlob } from "./git-cmds.js";

// ─── Lifecycle ─────────────────────────────────────────────────────────

/** Ensure the snapshot bare repo exists. Idempotent. */
export function ensureSnapshotRepo(snapshotPath: string): void {
	if (!existsSync(snapshotPath)) {
		mkdirSync(snapshotPath, { recursive: true });
	}
	if (!isRepo(snapshotPath)) {
		initBareRepo(snapshotPath);
	}
}

// ─── State file ───────────────────────────────────────────────────────
// Stored at `<snapshotPath>/state.json`. Tracks the ref pointers (project
// version + commit SHA + per-item versions + folder map) we need to do
// drift detection and emit accurate `ifVersion` guards on push.

const STATE_FILE = "state.json";

export interface RepoState {
	/** Last seen bridge projectVersion. */
	projectVersion: string;
	/** Commit SHA we generated for that projectVersion. */
	commitSha: string;
	/** Per-item content versions from the last fetch. Used for ifVersion guards on push. */
	items: Record<string, string>;
	/** Per-item bridge-side `folder` so push-diff translation knows where each item lives. */
	folders: Record<string, string>;
}

export function loadState(snapshotPath: string): RepoState | undefined {
	const path = join(snapshotPath, STATE_FILE);
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<RepoState>;
		if (typeof parsed.projectVersion !== "string") return undefined;
		if (typeof parsed.commitSha !== "string") return undefined;
		if (parsed.items === undefined || typeof parsed.items !== "object") return undefined;
		return {
			projectVersion: parsed.projectVersion,
			commitSha: parsed.commitSha,
			items: { ...parsed.items },
			folders: { ...(parsed.folders ?? {}) },
		};
	} catch {
		return undefined;
	}
}

export function saveState(snapshotPath: string, state: RepoState): void {
	writeFileSync(
		join(snapshotPath, STATE_FILE),
		`${JSON.stringify(state, null, 2)}\n`,
		"utf-8",
	);
}

// ─── Workspace file I/O ───────────────────────────────────────────────

/**
 * Walk the workspace tree and return one entry per tracked file (every
 * `.st` file plus `.gitattributes`), with paths normalized to forward
 * slashes. The caller is responsible for hashing each content into the
 * snapshot bare repo to obtain its blob SHA — this function just
 * enumerates and reads.
 */
export function listWorkspaceFiles(workspaceRoot: string): Array<{ path: string; content: Buffer }> {
	const out: Array<{ path: string; content: Buffer }> = [];
	const rootAbs = resolve(workspaceRoot);

	function walk(dir: string): void {
		let entries: string[];
		try {
			entries = readdirSync(dir, { withFileTypes: false }) as string[];
		} catch {
			return;
		}
		for (const name of entries) {
			// Skip our own state dir, the user's git dir, and OS detritus.
			if (name === ".plcassist" || name === ".git") continue;
			const abs = join(dir, name);
			let st: ReturnType<typeof statSync>;
			try {
				st = statSync(abs);
			} catch {
				continue;
			}
			if (st.isDirectory()) {
				walk(abs);
				continue;
			}
			if (!st.isFile()) continue;
			const rel = relative(rootAbs, abs).split(sep).join("/");
			if (!isTrackedPath(rel)) continue;
			out.push({ path: rel, content: readFileSync(abs) });
		}
	}

	walk(rootAbs);
	out.sort((a, b) => a.path.localeCompare(b.path));
	return out;
}

/**
 * Write a tree's contents to the workspace. Creates parent dirs as
 * needed. Does NOT delete any file — caller decides cleanup policy
 * (different for first-import vs subsequent imports).
 */
export function writeTreeToWorkspace(
	workspaceRoot: string,
	entries: ReadonlyArray<{ path: string; content: Buffer | string }>,
): void {
	for (const e of entries) {
		const abs = join(workspaceRoot, e.path);
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, e.content);
	}
}

/**
 * Delete files from the workspace by relative path. Tolerant of missing
 * files. Cleans up empty parent directories left behind, walking upward
 * until a non-empty dir or the workspace root is reached.
 */
export function removeFilesFromWorkspace(workspaceRoot: string, paths: readonly string[]): void {
	const rootAbs = resolve(workspaceRoot);
	for (const rel of paths) {
		const abs = join(rootAbs, rel);
		try {
			rmSync(abs, { force: true });
		} catch {
			/* ignore — file already gone */
		}
		// Walk up removing empty dirs (stop at workspace root or any
		// non-empty dir).
		let dir = dirname(abs);
		while (dir.startsWith(rootAbs) && dir !== rootAbs) {
			let remaining: string[];
			try {
				remaining = readdirSync(dir, { withFileTypes: false }) as string[];
			} catch {
				break;
			}
			if (remaining.length > 0) break;
			try {
				rmSync(dir, { recursive: false, force: true });
			} catch {
				break;
			}
			dir = dirname(dir);
		}
	}
}

// ─── IDE drift diagnostics ────────────────────────────────────────────

/**
 * Per-item summary of how the bridge's current state differs from our
 * last-imported snapshot. All three lists are POU names — sorted,
 * deduped, never overlap. Empty arrays = no drift.
 *
 * Computed purely from `/refs.items` versus the saved `state.items` —
 * no extra protocol calls, no extra persisted state. The values let
 * the CLI / MCP / AI tell at a glance "engineer added X, deleted Y,
 * modified Z" without having to fetch the items themselves.
 */
/**
 * Per-item delta in the standard git/hg shape: added / removed /
 * modified name lists. Direction-agnostic — the same shape describes
 * incoming changes (bridge → workspace) and outgoing changes
 * (workspace → bridge). Named `ChangeSet` instead of `IdeChanges` to
 * stay neutral; the field name on the consumer side carries the
 * direction (`incoming` / `outgoing` / `pushed`).
 */
export interface ChangeSet {
	added: string[];
	removed: string[];
	modified: string[];
}

/**
 * "What `plc import` would bring INTO the workspace" — modeled on
 * Mercurial's `hg incoming` semantic and git's `@{u}..HEAD` log: the
 * delta from our last-known bridge state (snapshotItems) to the
 * bridge's current state (bridgeItems).
 */
export function computeIncoming(
	bridgeItems: Record<string, string>,
	snapshotItems: Record<string, string>,
): ChangeSet {
	const added: string[] = [];
	const removed: string[] = [];
	const modified: string[] = [];
	for (const [name, ver] of Object.entries(bridgeItems)) {
		const prev = snapshotItems[name];
		if (prev === undefined) added.push(name);
		else if (prev !== ver) modified.push(name);
	}
	for (const name of Object.keys(snapshotItems)) {
		if (!(name in bridgeItems)) removed.push(name);
	}
	return {
		added: added.sort(),
		removed: removed.sort(),
		modified: modified.sort(),
	};
}

/** True if the ChangeSet reflects any changes at all. */
export function hasChanges(c: ChangeSet): boolean {
	return c.added.length > 0 || c.removed.length > 0 || c.modified.length > 0;
}

// ─── Workspace-local files we manage outside the snapshot ────────────

/**
 * Ensure the workspace's `.gitignore` excludes `.plcassist/`. The
 * snapshot bare repo + config carry per-machine state (bridge port,
 * snapshot objects keyed by content hashes the bridge produces) that
 * has no business being committed to the user's own git history.
 *
 * Policy:
 *   - No `.gitignore` exists       → write a minimal one with the entry.
 *   - Exists, entry already present → no-op.
 *   - Exists without the entry      → append a small block at the end,
 *                                     preserving the user's existing
 *                                     ignores.
 *
 * Safe to call on non-git workspaces too (the file is harmless and
 * costs nothing).
 */
export function ensureGitignore(workspaceRoot: string): void {
	const path = join(workspaceRoot, ".gitignore");
	const block = "# plc local state — workspace-local snapshot + config\n/.plcassist/\n";

	if (!existsSync(path)) {
		writeFileSync(path, block, "utf-8");
		return;
	}

	// Match `.plcassist/` (with or without leading slash, trailing
	// slash optional) on its own line, anywhere in the file.
	const existing = readFileSync(path, "utf-8");
	const linePattern = /^\s*\/?\.plcassist\/?\s*$/m;
	if (linePattern.test(existing)) return;

	const separator = existing.endsWith("\n") ? "\n" : "\n\n";
	writeFileSync(path, existing + separator + block, "utf-8");
}

// ─── Workspace ⇄ snapshot ─────────────────────────────────────────────

/**
 * Hash every workspace file into the snapshot bare repo and return the
 * tree SHA. Used by `plc export` (to build a commit to diff against
 * snapshot HEAD) and by `detectWorkspaceDirty` (which only needs the
 * per-file blob shas, but this packages the same work).
 */
export function buildWorkspaceTreeSha(workspaceRoot: string, snapshotPath: string): string {
	const files = listWorkspaceFiles(workspaceRoot);
	const indexEntries = files.map((f) => ({
		path: f.path,
		sha: writeBlob(snapshotPath, f.content),
	}));
	return buildTree(snapshotPath, indexEntries);
}

/**
 * Return the workspace paths whose current content differs from the
 * snapshot HEAD's blob for the same path. Also reports files present
 * in HEAD but missing from the workspace (the user deleted them) —
 * because re-importing would re-create them, they're "dirty" too.
 *
 * Single source of truth for "what would `plc import` overwrite?" /
 * "what does `plc status` show as M?" — used by both verbs.
 */
export function detectWorkspaceDirty(
	snapshotPath: string,
	workspaceRoot: string,
	headCommitSha: string,
): string[] {
	const headEntries = listTree(snapshotPath, headCommitSha);
	const headByPath = new Map(headEntries.map((e) => [e.path, e.sha]));
	const wsFiles = listWorkspaceFiles(workspaceRoot);
	const wsByPath = new Map(wsFiles.map((f) => [f.path, f.content]));

	const dirty = new Set<string>();

	// Workspace files that differ from (or are absent from) HEAD.
	for (const [path, content] of wsByPath) {
		const wsSha = writeBlob(snapshotPath, content);
		if (headByPath.get(path) !== wsSha) dirty.add(path);
	}

	// HEAD-tracked files missing from the workspace (user deleted them).
	for (const path of headByPath.keys()) {
		if (!wsByPath.has(path) && isTrackedPath(path)) dirty.add(path);
	}

	return [...dirty].sort();
}

/**
 * "What `plc export` would push TO the bridge" — symmetric counterpart
 * to `computeIncoming`. Modeled on Mercurial's `hg outgoing` semantic
 * and git's `HEAD..@{u}` log: the delta from snapshot HEAD (= bridge's
 * last-known state) to the current workspace tree.
 *
 * One `.st` file = one top-level POU; the POU name is the basename.
 * Added/removed/modified follow the same rules as git's
 * `--name-status` against HEAD.
 */
export function computeOutgoing(
	snapshotPath: string,
	workspaceRoot: string,
	headCommitSha: string,
): ChangeSet {
	const headEntries = listTree(snapshotPath, headCommitSha);
	const headByPath = new Map(headEntries.map((e) => [e.path, e.sha]));
	const wsFiles = listWorkspaceFiles(workspaceRoot);
	const wsByPath = new Map(wsFiles.map((f) => [f.path, f.content]));

	const added = new Set<string>();
	const modified = new Set<string>();
	const removed = new Set<string>();

	for (const [path, content] of wsByPath) {
		if (!path.endsWith(".st")) continue;
		const name = nameFromStPath(path);
		const wsSha = writeBlob(snapshotPath, content);
		const headSha = headByPath.get(path);
		if (headSha === undefined) added.add(name);
		else if (headSha !== wsSha) modified.add(name);
	}
	for (const path of headByPath.keys()) {
		if (!path.endsWith(".st")) continue;
		if (!wsByPath.has(path)) removed.add(nameFromStPath(path));
	}

	return {
		added: [...added].sort(),
		modified: [...modified].sort(),
		removed: [...removed].sort(),
	};
}

function nameFromStPath(relPath: string): string {
	const slash = relPath.lastIndexOf("/");
	const base = slash >= 0 ? relPath.slice(slash + 1) : relPath;
	return base.endsWith(".st") ? base.slice(0, -".st".length) : base;
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** True if `relPath` is a file we own — `.st` source or our `.gitattributes`. */
function isTrackedPath(relPath: string): boolean {
	return relPath.endsWith(".st") || relPath === ".gitattributes";
}
