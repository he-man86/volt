/**
 * Workspace ↔ bridge translation. Used by `volt pull` and `volt push`
 * (in `cli/pull.ts` / `cli/push.ts`).
 *
 * Workspace layout: ONE FILE PER POU, extension picked by kind/language
 * (see `pou-files.ts`). Every file holds plain ST — bodies authored
 * graphically by the engineer are transpiled to ST at pull time so the
 * workspace stays single-language (memory `st-only-workspace`). The
 * source-language extension is preserved (`.fbd`, `.ld`) so the
 * engineer's intent is visible at a glance. The file is the unit of
 * transfer: it contains the outer POU (FUNCTION_BLOCK / PROGRAM /
 * FUNCTION / INTERFACE) followed by its children (METHOD / ACTION /
 * PROPERTY) as TOP-LEVEL SIBLINGS. Parent association is implicit from
 * the file name (`POUs/FB_Motor.st` contains everything related to
 * `FB_Motor`).
 *
 * Wire-shape v2 (2026-05-29): the bridge owns structural parsing of
 * `.st`. The agent sends a workspace file's raw contents as
 * `sourceText` and receives one assembled `sourceText` per item back.
 * No agent-side `st-parse.ts` / `st-assemble.ts` — the bridge does it
 * all via `StSplitter` / `StAssembler`.
 *
 * Two directions:
 *
 *   syncFromBridge: bridge state → snapshot commit
 *     Calls /fetch, writes each returned `sourceText` to its workspace
 *     path as a snapshot blob, builds a tree, creates a deterministic
 *     commit on top of the previous one.
 *
 *   applyPushToBridge: snapshot commit → bridge.pushBatch
 *     Diffs the workspace tree against the prior snapshot tree at the
 *     FILE level. For each POU file that changed, emits ONE pushItem
 *     op carrying the full new `sourceText`. The bridge splits and
 *     diffs internally.
 */
import type { Remote } from "../bridge/remote.js";
import type {
	FetchedItem,
	PushItemOp,
	PushOp,
	PushResponse,
} from "../bridge/types.js";
import {
	buildTree,
	createDeterministicCommit,
	listTree,
	readBlob,
	resolveRef,
	updateRef,
	writeBlob,
	type IndexEntry,
	type TreeEntry,
} from "./git-cmds.js";
import { listWorkspaceFiles, loadState, saveState, type RepoState } from "./snapshot.js";
import {
	CONFIG_EXTENSIONS,
	FOLDER_MARKER,
	POU_EXTENSIONS,
	asPouKind,
	gitattributesContent,
	isConfigKind,
	isFolderKind,
	nameFromPouPath,
	pickExtension,
} from "./pou-files.js";
import { materializeGraphicalPouAsST } from "./transpile-graphical-to-st.js";

// ─── Bridge → workspace materialization ────────────────────────────────

interface SyncOptions {
	/**
	 * Skip the cache short-circuit AND the per-item incremental-fetch
	 * optimization. Forces a full re-materialization from bridge state.
	 *
	 * Required after `volt push --force` adopts bridge state: at that
	 * point `state.projectVersion` already equals `refs.projectVersion`
	 * (we just synced them), so the normal sync would no-op — leaving
	 * the snapshot tree out of sync with `state.items`. With this flag,
	 * the snapshot tree gets rebuilt from a full `/fetch`, picking up
	 * the engineer-added items we adopted but never materialized.
	 */
	fullRebuild?: boolean;
}

export async function syncFromBridge(
	repoPath: string,
	bridge: Remote,
	opts: SyncOptions = {},
): Promise<string> {
	const refs = await bridge.getRefs();
	const state = loadState(repoPath);

	if (!opts.fullRebuild && state !== undefined && state.projectVersion === refs.projectVersion) {
		const sha = resolveRef(repoPath, "refs/heads/main");
		if (sha === state.commitSha) return sha;
	}

	const knownItems = opts.fullRebuild ? {} : (state?.items ?? {});
	const fetchResp = await bridge.fetchChanges({ knownItems });

	const entries = new Map<string, IndexEntry>();
	const folders: Record<string, string> = { ...(state?.folders ?? {}) };
	const items: Record<string, string> = { ...fetchResp.items };

	// Seed with prev tree entries we haven't been told to change.
	if (state !== undefined) {
		const prevTreeEntries = listTree(repoPath, state.commitSha);
		for (const entry of prevTreeEntries) {
			if (entry.path === ".gitattributes") {
				entries.set(entry.path, { path: entry.path, sha: entry.sha, mode: entry.mode });
				continue;
			}
			const name = nameFromPouPath(entry.path);
			if (name === undefined) continue;
			if (fetchResp.removed.includes(name)) continue;
			if (fetchResp.changed.some((c) => c.name === name)) continue;
			if (!(name in items)) continue;
			entries.set(entry.path, { path: entry.path, sha: entry.sha, mode: entry.mode });
		}
	}

	// Per-item materialization: one bad item must NOT prevent the
	// other 30+ from landing in the workspace. On failure we log a
	// clear per-item diagnostic (item name + computed path + the
	// underlying error) and skip JUST that item; the rest continue.
	//
	// Skipped items are also removed from `items` and `folders` so
	// they don't appear in `state.items` — that keeps push diff
	// from emitting a phantom "delete this item" op against the
	// bridge on the next push (where snapshot would say the item
	// exists but workspace doesn't). Net effect: the next pull
	// will try to materialize the item again with whatever the
	// bridge sends — fix-on-bridge-side recovery happens for free.
	const skipped: Array<{ name: string; reason: string }> = [];
	for (const item of fetchResp.changed) {
		try {
			const { path, content } = materializeItem(item);
			entries.set(path, { path, sha: writeBlob(repoPath, normalizeLineEndings(content)) });
			folders[item.name] = item.folder ?? "";
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			skipped.push({ name: item.name, reason });
			delete items[item.name];
			delete folders[item.name];
			process.stderr.write(
				`[skip] ${item.name} (${item.kind ?? "unknown kind"}): ${reason}\n`,
			);
		}
	}

	for (const name of fetchResp.removed) {
		delete folders[name];
	}

	if (skipped.length > 0) {
		process.stderr.write(
			`\n${skipped.length} item(s) could not be materialized and were skipped. ` +
				`The remaining items pulled cleanly. ` +
				`Fix the bridge-side cause for each skipped item, then re-run \`volt pull\`.\n`,
		);
	}

	const gitattributesSha = writeBlob(repoPath, gitattributesContent());
	entries.set(".gitattributes", { path: ".gitattributes", sha: gitattributesSha });

	const sortedEntries = [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
	const treeSha = buildTree(repoPath, sortedEntries);

	const message = `IDE state @ projectVersion=${refs.projectVersion}\nstructureVersion=${refs.structureVersion}\n`;
	const parentSha = state?.commitSha;
	const commitSha = createDeterministicCommit(repoPath, treeSha, parentSha, message);

	updateRef(repoPath, "refs/heads/main", commitSha);
	saveState(repoPath, {
		projectVersion: refs.projectVersion,
		commitSha,
		items,
		folders,
	});

	return commitSha;
}

/**
 * Materialize a bridge item into a single workspace file (path + content).
 *
 * Wire-shape v2: the bridge already assembled the file on its side
 * (POU + children → one `.st` blob), so we just route by extension
 * derived from kind/language and drop the `sourceText` into place.
 */
function materializeItem(item: FetchedItem): { path: string; content: string } {
	if (item.kind === undefined || item.kind === null) {
		throw new Error(
			`bridge sent no "kind" for "${item.name}" — bridge binary is outdated, rebuild and restart it`,
		);
	}
	const folder = item.folder ?? "";

	// Non-source config items (tasks, visualizations, library refs,
	// alarm configs, device tree, etc.) come through with a config
	// kind. Their `sourceText` is the raw PLCopenXML / native XML
	// export from the bridge — write verbatim, no assembly, no
	// graphical-body splicing.
	if (isConfigKind(item.kind)) {
		const ext = pickExtension(item.kind);
		// Empty ext = item name already has the right extension baked in
		// (e.g. TwinCAT .tmc files arrive as `Foo.tmc` and we'd produce
		// the ugly double `Foo.tmc.xml` if we appended). Treat empty ext
		// as "use item.name verbatim".
		const fileName = ext === "" ? item.name : `${item.name}.${ext}`;
		const path = joinPath(folder, fileName);
		return { path, content: item.sourceText };
	}

	// Empty CODESYS folder — materialize as `<folder>/<name>/.gitkeep`
	// so git preserves the otherwise-empty directory. Non-empty folders
	// are NOT emitted by the bridge (their dir appears naturally via
	// children's paths), so we never sprinkle redundant `.gitkeep`
	// markers inside populated directories.
	if (isFolderKind(item.kind)) {
		const path = joinPath(folder, item.name, FOLDER_MARKER);
		return { path, content: "" };
	}

	const kind = asPouKind(item.kind);
	if (kind === undefined) {
		throw new Error(
			`bridge sent unknown kind "${item.kind}" for "${item.name}" — extend KNOWN_KINDS (POU) or treat as config in pou-files.ts`,
		);
	}
	const ext = pickExtension(kind, item.language);
	const path = joinPath(folder, `${item.name}.${ext}`);
	// Graphical POUs (FBD/LD): the transpiler module owns the full
	// pipeline (vendor-markup strip → topology walk → ST splice). On
	// transpile failure it throws with a user-actionable message that
	// the pull error path surfaces — no silent best-effort writes.
	// See memory `st-only-workspace`.
	const content =
		item.implementationXml !== undefined && item.implementationXml !== null
			? materializeGraphicalPouAsST(item, item.implementationXml)
			: item.sourceText;
	return { path, content };
}

// ─── Pure-read primitive: peekBridgeItem ──────────────────────────────

/**
 * Pure-read primitive: ask the bridge for ONE item's current state
 * and return its materialized `{path, content}` representation
 * WITHOUT writing anywhere.
 *
 * Architectural boundary (see `project_graphical_read_only` and the
 * post-launch UX plan): `syncFromBridge` is the only operation that
 * persists bridge state to the snapshot and workspace. `peekBridgeItem`
 * is the read counterpart — it asks the bridge "what does X look like
 * right now?", runs the response through the same `materializeItem`
 * machinery, and hands the bytes back. It does NOT touch:
 *
 *   - the snapshot's git blobs (no `writeBlob`)
 *   - the snapshot's refs (no `updateRef`, no `buildTree`)
 *   - `.volt/snapshot/state.json` (no `saveState`)
 *   - the workspace tree (no `writeFileSync`)
 *
 * Used by `volt show BRIDGE <path>` to back the SCM extension's
 * incoming-side diff click. The user can browse incoming changes
 * freely; their workspace copy is never silently overwritten.
 *
 * If the bridge doesn't have the item, throws — the caller (`volt
 * show`) translates that into a clean exit-2 with a user-readable
 * error.
 */
export async function peekBridgeItem(
	bridge: Remote,
	name: string,
): Promise<{ path: string; content: string }> {
	// Force a full re-fetch of this single item by passing an empty
	// version string in `knownItems` — the bridge then includes its
	// current bytes in the `changed` array unconditionally.
	const resp = await bridge.fetchChanges({ knownItems: { [name]: "" } });
	const item = resp.changed.find((i) => i.name === name);
	if (item === undefined) {
		throw new Error(
			`bridge has no item named '${name}' — check the spelling or run \`volt status\` to see what's available`,
		);
	}
	// Reuse the same materializer the pull path uses, so the diff
	// shows EXACTLY what a subsequent `volt pull` would write to
	// the workspace. The return is `{path, content}` — no writes.
	return materializeItem(item);
}

// ─── Drift-cause diagnostic ───────────────────────────────────────────

/**
 * "Did WE cause this drift, or did someone external?" answer for a
 * workspace that's been flagged as drifted.
 *
 * Returns true when the workspace's current files would assemble to
 * EXACTLY what the bridge currently has — i.e. a `volt pull` would
 * be a content no-op (it'd only update the snapshot's recorded
 * version). Most common case: a previous `volt push` succeeded on
 * the bridge but the process died before `saveState` persisted the
 * receipt, leaving the snapshot stale-but-correct.
 *
 * Returns false on any real engineer-side change.
 *
 * Cost: one `/fetch` call. Caller decides whether to spend it
 * (currently only `runStatus` does, when drift is already detected).
 */
export async function workspaceMatchesBridge(
	workspaceRoot: string,
	bridge: Remote,
): Promise<boolean> {
	const { changed: bridgeItems } = await bridge.fetchChanges({ knownItems: {} });
	const wsFiles = listWorkspaceFiles(workspaceRoot);
	const wsByPath = new Map(
		wsFiles.map((f) => [f.path, normalizeLineEndings(f.content.toString("utf-8"))]),
	);

	// Every bridge item must materialize to a workspace file with the
	// identical content. A bridge item we can't materialize at all
	// (malformed declaration, unknown kind, etc.) means we cannot
	// answer "does the workspace match?" affirmatively — return false
	// to force the caller to treat this as "doesn't match", which is
	// the safe choice (worst case the user is shown drift they could
	// have ignored; the alternative — throwing — kills `volt status`
	// entirely on a single bad item).
	const expectedPaths = new Set<string>([".gitattributes"]);
	for (const item of bridgeItems) {
		let path: string;
		let content: string;
		try {
			({ path, content } = materializeItem(item));
		} catch {
			return false;
		}
		expectedPaths.add(path);
		const wsContent = wsByPath.get(path);
		if (wsContent === undefined) return false;
		if (normalizeLineEndings(content) !== wsContent) return false;
	}

	// Workspace must not have any extra POU files beyond what the
	// bridge has — anything else is a workspace-side addition that
	// would mean the workspace is AHEAD of the bridge, not in-sync.
	for (const wsPath of wsByPath.keys()) {
		if (!expectedPaths.has(wsPath) && POU_EXTENSIONS.some((e: string) => wsPath.endsWith(e))) return false;
	}

	return true;
}

// ─── Workspace → bridge push (file-level diff) ────────────────────────

/**
 * Translate the diff between two snapshot commits into a list of
 * item-level bridge ops. File-level: each POU file is one item, so
 * any content change emits ONE pushItem op (carrying full new
 * sourceText). The bridge handles the per-child diff internally.
 */
export async function applyPushToBridge(
	repoPath: string,
	bridge: Remote,
	newCommitSha: string,
): Promise<{ accepted: true; commitSha: string } | { accepted: false; reason: string }> {
	const state = loadState(repoPath);
	if (state === undefined) {
		return { accepted: false, reason: "no snapshot to diff against — run `volt pull` once first" };
	}

	const newTreeEntries = listTree(repoPath, newCommitSha);
	const prevTreeEntries = listTree(repoPath, state.commitSha);

	const ops = buildPushOps(repoPath, prevTreeEntries, newTreeEntries, state);
	if (ops.length === 0) {
		saveState(repoPath, { ...state, commitSha: newCommitSha });
		return { accepted: true, commitSha: newCommitSha };
	}

	const pushReq = { ops, expectedProjectVersion: state.projectVersion };
	const resp: PushResponse = await bridge.pushBatch(pushReq);

	if (!resp.accepted) {
		const summary = resp.conflicts
			.map((c) => `${c.name}: ${c.reason} (yours=${c.yourVersion ?? "null"}, current=${c.currentVersion ?? "null"})`)
			.join("; ");
		return { accepted: false, reason: `bridge rejected push: ${summary}` };
	}

	const newFolders: Record<string, string> = {};
	for (const entry of newTreeEntries) {
		const name = nameFromPouPath(entry.path);
		if (name === undefined) continue;
		const segs = entry.path.split("/");
		newFolders[name] = segs.slice(0, -1).join("/");
	}

	saveState(repoPath, {
		projectVersion: resp.newProjectVersion,
		commitSha: newCommitSha,
		items: { ...resp.newItems },
		folders: newFolders,
	});

	return { accepted: true, commitSha: newCommitSha };
}

interface PouFile {
	name: string;
	folder: string;
	entry: TreeEntry;
}

function buildPouFileMap(entries: readonly TreeEntry[]): Map<string, PouFile> {
	const out = new Map<string, PouFile>();
	for (const entry of entries) {
		const name = nameFromPouPath(entry.path);
		if (name === undefined) continue;
		const segs = entry.path.split("/");
		const folder = segs.slice(0, -1).join("/");
		const existing = out.get(name);
		if (existing !== undefined) {
			// Two files in the tree resolve to the same POU name.
			// Hard-fail so the caller sees the collision.
			throw new Error(
				`duplicate POU name '${name}' — two files in the workspace produce the same POU: ` +
					`'${existing.entry.path}' and '${entry.path}'. ` +
					`POU names must be unique across the project tree. Remove one of the files.`,
			);
		}
		out.set(name, { name, folder, entry });
	}
	return out;
}

// NOTE: workspace renames present here as `prev` having the old name
// AND `curr` having the new name, with no entry overlap — they're
// emitted as deleteItem(oldName) + pushItem(newName, ifVersion=null).
// The wire surface includes a `renameItem` op (the bridge accepts it),
// but THIS DIFF NEVER EMITS IT: agent-side file renames look identical
// to delete+create at the tree level, and we have no metadata to recover
// the "this is really a rename" intent. If you ever want renameItem
// emission, you'd need explicit rename-detection (e.g. content-hash
// matching across the delete + create candidates).
function buildPushOps(
	repoPath: string,
	prevEntries: readonly TreeEntry[],
	newEntries: readonly TreeEntry[],
	state: RepoState,
): PushOp[] {
	const prev = buildPouFileMap(prevEntries);
	const curr = buildPouFileMap(newEntries);
	const ops: PushOp[] = [];

	// 1. Deletions.
	for (const [name] of prev) {
		if (curr.has(name)) continue;
		const ifVersion = state.items[name];
		if (ifVersion === undefined) continue;
		ops.push({ op: "deleteItem", name, ifVersion });
	}

	// 2. Creates + updates.
	for (const [name, currFile] of curr) {
		const prevFile = prev.get(name);
		const currContent = denormalizeLineEndings(readBlob(repoPath, currFile.entry.sha));

		if (prevFile === undefined) {
			// New item — pushItem with ifVersion=null = create-new semantics.
			ops.push(buildPushItemOp(name, currFile, currContent, null));
			continue;
		}

		const folderChanged = prevFile.folder !== currFile.folder;
		const contentChanged = prevFile.entry.sha !== currFile.entry.sha;
		if (!folderChanged && !contentChanged) continue;

		const ifVersion = state.items[name];
		if (ifVersion === undefined) continue;

		if (folderChanged && !contentChanged) {
			// Folder-only change — moveItem keeps the content intact.
			ops.push({ op: "moveItem", name, newFolder: currFile.folder, ifVersion });
			continue;
		}

		// Content changed (folder may have changed too) — single
		// pushItem carries the full new sourceText AND the new folder.
		ops.push(buildPushItemOp(name, currFile, currContent, ifVersion));
	}

	return ops;
}

/**
 * Construct a `pushItem` op from a workspace file's content.
 *
 * The workspace is ST-only — graphical bodies are transpiled to ST
 * at pull time (memory: `st-only-workspace`). Every push therefore
 * carries plain text the bridge's StSplitter consumes directly.
 *
 * The agent NEVER sends `implementationXml` to the bridge. Graphical
 * bodies live exclusively on the IDE side; the engineer authors them
 * in CODESYS / TwinCAT, we only read them.
 */
function buildPushItemOp(
	name: string,
	currFile: PouFile,
	currContent: string,
	ifVersion: string | null,
): PushItemOp {
	const folderField = currFile.folder.length > 0 ? { folder: currFile.folder } : {};
	return {
		op: "pushItem",
		name,
		...folderField,
		sourceText: currContent,
		ifVersion,
	};
}

// ─── Helpers ──────────────────────────────────────────────────────────

function joinPath(...parts: string[]): string {
	return parts.filter((p) => p.length > 0).join("/");
}

function normalizeLineEndings(s: string): string {
	return s.replace(/\r\n/g, "\n");
}

function denormalizeLineEndings(s: string): string {
	return s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
}
