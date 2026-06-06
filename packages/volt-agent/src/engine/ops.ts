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
	FOLDER_MARKER,
	getByKind,
	getByPath,
	gitattributesContent,
	nameFromPath,
	pickExtension,
	sourceExtensions,
} from "./extension-registry.js";
import { isPullable, type AccessOverrides } from "./access.js";
import {
	materializeGraphicalChildAsST,
	materializeGraphicalPouAsST,
} from "./transpile-graphical-to-st.js";

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

	/**
	 * Per-extension access overrides from `.volt/config.json`. Items
	 * whose extension resolves to `"off"` are KEPT in `state.items`
	 * (so subsequent /refs doesn't loop refetching them) but their
	 * content is NOT materialized to disk — the workspace pretends
	 * the engineer doesn't have them.
	 */
	accessOverrides?: AccessOverrides;

	/**
	 * Optional callback invoked at phase boundaries during the sync:
	 * `"bridge state queried (NNN items)"`, `"fetching NNN items..."`,
	 * `"received NNN items, materializing"`. Used by `volt pull` to
	 * give the user phase-level progress feedback during long syncs
	 * (large CODESYS projects can spend 10+ seconds in /refs and /fetch
	 * each, which would otherwise feel like the command is hung).
	 */
	onProgress?: (event: string) => void;
}

/**
 * Result of a sync. `commitSha` is the new HEAD; `skipped` is the list
 * of items the bridge sent but we couldn't materialize (unclassifiable
 * body language, transpile failure, etc.) — exposed so the CLI can
 * surface them to the user without parsing stderr.
 */
export interface SyncResult {
	commitSha: string;
	skipped: ReadonlyArray<{ name: string; reason: string }>;
}

export async function syncFromBridge(
	repoPath: string,
	bridge: Remote,
	opts: SyncOptions = {},
): Promise<SyncResult> {
	const notify = opts.onProgress ?? (() => {});
	const refs = await bridge.getRefs();
	notify(`bridge has ${Object.keys(refs.items).length} items @ projectVersion=${refs.projectVersion.slice(0, 12)}`);
	const state = loadState(repoPath);

	if (!opts.fullRebuild && state !== undefined && state.projectVersion === refs.projectVersion) {
		const sha = resolveRef(repoPath, "refs/heads/main");
		if (sha === state.commitSha) {
			notify("already up to date, nothing to fetch");
			return { commitSha: sha, skipped: [] };
		}
	}

	const knownItems = opts.fullRebuild ? {} : (state?.items ?? {});
	notify(`fetching ${opts.fullRebuild ? "all" : "changed"} items from bridge...`);
	const fetchResp = await bridge.fetchChanges({ knownItems });
	notify(`received ${fetchResp.changed.length} item(s), materializing`);

	const entries = new Map<string, IndexEntry>();
	const folders: Record<string, string> = { ...(state?.folders ?? {}) };
	const items: Record<string, string> = { ...fetchResp.items };

	// Seed with prev tree entries we haven't been told to change.
	// Each prev entry resolves to its owning top-level item via
	// `resolveOwnerItem`, which handles BOTH direct paths
	// (`<folder>/<name>.<ext>`) AND graphical-child sibling paths
	// (`<folder>/<name>/<child>.<lang_ext>` — basename matches the
	// child but the OWNER is the parent directory).
	if (state !== undefined) {
		const prevTreeEntries = listTree(repoPath, state.commitSha);
		for (const entry of prevTreeEntries) {
			if (entry.path === ".gitattributes") {
				entries.set(entry.path, { path: entry.path, sha: entry.sha, mode: entry.mode });
				continue;
			}
			const owner = resolveOwnerItem(entry.path, items);
			if (owner === undefined) continue;
			if (fetchResp.removed.includes(owner)) continue;
			if (fetchResp.changed.some((c) => c.name === owner)) continue;
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
			const outputs = materializeItem(item);
			// Drop the WHOLE item if its primary file isn't pullable
			// (config-driven `"off"` or untracked extension). The first
			// output is always the parent file; subsequent outputs are
			// graphical children — they ride along iff the parent rides.
			const primaryExt = outputs[0]!.path.slice(outputs[0]!.path.lastIndexOf("."));
			if (!isPullable(primaryExt, opts.accessOverrides)) {
				notify(`skipped (access=off): ${item.name}`);
				continue;
			}
			for (const out of outputs) {
				entries.set(out.path, {
					path: out.path,
					sha: writeBlob(repoPath, normalizeLineEndings(out.content)),
				});
			}
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

	return { commitSha, skipped };
}

/** One file the materializer wants written: workspace-relative path
 *  + the bytes. A single bridge item can produce multiple outputs
 *  when it has graphical children (parent `.st` + one `.fbd` per
 *  non-textual action/method). */
export interface MaterializedFile {
	path: string;
	content: string;
}

/**
 * Materialize a bridge item into one-or-more workspace files.
 *
 * Wire-shape v2: the bridge already assembled the parent file on its
 * side (POU + textual children → one `.st` blob). When a parent has
 * non-textual (FBD/LD/SFC/CFC) children, the bridge surfaces those
 * separately via `graphicalChildren` and we emit each as a read-only
 * sibling file under `<parent_name>/<child_name>.<lang_ext>`.
 *
 * Throws on:
 *   - unregistered kind
 *   - source POU kind with unknown / missing body language
 *   - transpile failure for graphical POU bodies
 *
 * Caller (`syncFromBridge`) catches per item so one bad item doesn't
 * abort the whole pull.
 */
function materializeItem(item: FetchedItem): MaterializedFile[] {
	if (item.kind === undefined || item.kind === null) {
		throw new Error(
			`bridge sent no "kind" for "${item.name}" — bridge binary is outdated, rebuild and restart it`,
		);
	}
	const folder = item.folder ?? "";

	// Look up the registry entry for this kind. Branch by family —
	// folder / config / source each have their own materialization
	// path. Unknown kinds throw loudly (no silent fallback, per
	// `feedback_no_fallbacks` memory).
	const def = getByKind(item.kind);
	if (def === undefined) {
		throw new Error(
			`bridge sent unregistered kind "${item.kind}" for "${item.name}" — ` +
				`add it to engine/extension-registry.ts or drop it at the bridge.`,
		);
	}

	// Empty CODESYS folder — materialize as `<folder>/<name>/.gitkeep`
	// so git preserves the otherwise-empty directory. Non-empty
	// folders are NOT emitted by the bridge (their dir appears
	// naturally via children's paths), so we never sprinkle redundant
	// markers inside populated directories.
	if (def.family === "folder") {
		return [{ path: joinPath(folder, item.name, FOLDER_MARKER), content: "" }];
	}

	// Config kinds — bridge produces a structured manifest as
	// sourceText (library refs, tasks, devices, …). Write verbatim
	// with the per-kind extension. TMC files arrive with the
	// extension already in the item name (e.g. `Foo.tmc`); the
	// `nameIsVerbatim` flag tells us to skip the suffix append.
	if (def.family === "config") {
		const fileName = def.nameIsVerbatim
			? item.name
			: `${item.name}.${pickExtension(item.kind)}`;
		return [{ path: joinPath(folder, fileName), content: item.sourceText }];
	}

	// Source POU branch. Body language picks the disk extension
	// (.st / .fbd / .ld / .cfc / .sfc). `pickExtension` throws when
	// the body language is missing or unrecognized — the bridge is
	// required to commit to a real language.
	const ext = pickExtension(item.kind, item.language);
	const hasGraphicalChildren =
		item.graphicalChildren !== undefined && item.graphicalChildren.length > 0;

	// Layout: when the POU has graphical children, nest its own .st
	// inside a directory named after the POU, alongside the sibling
	// `.fbd`/`.ld`/`.sfc`/`.cfc` child files. Engineers landing on
	// `<name>/` see everything belonging to that POU at once.
	//
	//   POUs/FB_Pump.st                      (no graphical children)
	//   POUs/FB_Motion/FB_Motion.st          (has graphical children)
	//   POUs/FB_Motion/Cyclic.fbd            (graphical child of FB_Motion)
	//
	// When a graphical child is added (or the last one removed), the
	// parent's .st moves between these two locations. The pull's
	// retired-files sweep handles the cleanup naturally — the old
	// path isn't in the new tree, so it gets removed.
	const parentDir = hasGraphicalChildren ? joinPath(folder, item.name) : folder;
	const parentPath = joinPath(parentDir, `${item.name}.${ext}`);
	const parentContent = renderSourcePou(item);
	const outputs: MaterializedFile[] = [{ path: parentPath, content: parentContent }];

	if (item.graphicalChildren !== undefined) {
		for (const child of item.graphicalChildren) {
			outputs.push(renderGraphicalChild(parentDir, child));
		}
	}
	return outputs;
}

/**
 * Render the parent file's bytes. FBD/LD bodies go through the
 * transpiler that emits ST + splices into the declaration shell.
 * SFC/CFC have no transpile path — we write `sourceText` (declaration
 * + empty body shell) and rely on the read-only access mode of
 * `.sfc` / `.cfc` to prevent round-trip-write attempts. ST POUs are
 * already complete in `sourceText`.
 */
function renderSourcePou(item: FetchedItem): string {
	const language = item.language;
	const hasBodyXml = item.implementationXml !== undefined && item.implementationXml !== null;
	if (hasBodyXml && (language === "FBD" || language === "LD")) {
		return materializeGraphicalPouAsST(item, item.implementationXml!);
	}
	// ST / SFC / CFC — write the bridge's sourceText verbatim. For SFC
	// and CFC this is the declaration shell with no body content; the
	// engineer keeps the body in the IDE, Volt only tracks the
	// declarations and the fact the POU exists.
	return item.sourceText;
}

/**
 * Render one graphical child as a workspace file inside the parent's
 * namespace directory. Same transpile pipeline as top-level graphical
 * POUs (`materializeGraphicalPouAsST`) — strip vendor markup,
 * transpile, splice into the declaration shell — so the engineer sees
 * the SAME shape they'd see for a top-level FBD POU, just wrapped as
 * `ACTION X / <ST> / END_ACTION` instead of `FUNCTION_BLOCK X / <ST> /
 * END_FUNCTION_BLOCK`.
 *
 * Language-by-language:
 *   FBD / LD  → transpiled to ST and wrapped (throws on transpile
 *                failure; the per-item catch in `syncFromBridge`
 *                skips the WHOLE parent with a clear reason, matching
 *                the top-level FBD POU error path)
 *   SFC / CFC → no transpiler exists; emit declaration + END_<KIND>
 *                with a note that the body lives in the IDE. Read-only
 *                via the access registry's per-language `r` mode.
 */
function renderGraphicalChild(
	parentDir: string,
	child: import("../bridge/types.js").GraphicalChild,
): MaterializedFile {
	const path = joinPath(parentDir, `${child.name}.${child.language.toLowerCase()}`);
	const content =
		child.language === "FBD" || child.language === "LD"
			? materializeGraphicalChildAsST(child)
			: renderGraphicalChildShell(child);
	return { path, content };
}

/**
 * Resolve which top-level item a workspace path belongs to.
 *
 * Two shapes are valid:
 *   1. Direct          `<folder>/<name>.<ext>`  → owner = name
 *   2. Graphical child `<folder>/<owner>/<child>.<lang_ext>` → owner = the
 *      enclosing directory name (the parent POU). Used when the
 *      parent has graphical members surfaced as read-only siblings.
 *
 * Walks the path bottom-up, first checking the basename stem against
 * known items (direct path), then climbing the directory chain (sibling
 * file under a parent's namespace folder). Returns the first dir
 * segment that matches an item name, or `undefined` if no segment
 * resolves.
 *
 * Folder-marker paths (`<folder>/<name>/.gitkeep`) need special
 * handling and are routed through `nameFromPath` instead.
 */
function resolveOwnerItem(relPath: string, items: Record<string, string>): string | undefined {
	// Folder-marker paths — delegate to the existing helper that
	// understands the marker convention.
	if (relPath.endsWith(`/${FOLDER_MARKER}`) || relPath === FOLDER_MARKER) {
		const name = nameFromPath(relPath);
		return name !== undefined && name in items ? name : undefined;
	}
	const segments = relPath.split("/");
	const basename = segments[segments.length - 1]!;
	const dot = basename.lastIndexOf(".");
	if (dot > 0) {
		const stem = basename.slice(0, dot);
		if (stem in items) return stem;
	}
	// Climb the directory chain. For `<folder>/<parent>/<child>.fbd`
	// the parent directory `<parent>` is the owner when it's in items.
	for (let i = segments.length - 2; i >= 0; i--) {
		const seg = segments[i]!;
		if (seg in items) return seg;
	}
	return undefined;
}

/** SFC/CFC graphical-child fallback shell. No transpiler exists for
 *  these languages, so we emit the declaration + an honest "body
 *  lives in IDE" comment + the closing END_<KIND>. Read-only by the
 *  access registry; engineer edits the IDE for content. */
function renderGraphicalChildShell(
	child: import("../bridge/types.js").GraphicalChild,
): string {
	const endKeyword = `END_${child.kind.toUpperCase()}`;
	return [
		child.declaration.trimEnd(),
		`(* body authored in IDE — Volt has no ${child.language} transpiler *)`,
		endKeyword,
		"",
	].join("\n");
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
): Promise<MaterializedFile[]> {
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
	// the workspace. A POU with graphical children produces multiple
	// files; the caller picks the one matching the requested path.
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
		let outputs: MaterializedFile[];
		try {
			outputs = materializeItem(item);
		} catch {
			return false;
		}
		for (const out of outputs) {
			expectedPaths.add(out.path);
			const wsContent = wsByPath.get(out.path);
			if (wsContent === undefined) return false;
			if (normalizeLineEndings(out.content) !== wsContent) return false;
		}
	}

	// Workspace must not have any extra POU files beyond what the
	// bridge has — anything else is a workspace-side addition that
	// would mean the workspace is AHEAD of the bridge, not in-sync.
	// We only consider SOURCE files here because config items
	// (.library/.task/etc.) are read-only by default — extra ones
	// can't have been added by the agent, only retired by the bridge.
	const sourceExts = sourceExtensions();
	for (const wsPath of wsByPath.keys()) {
		if (!expectedPaths.has(wsPath) && sourceExts.some((e) => wsPath.endsWith(e))) return false;
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
		// Recognize every tracked extension, not just POU sources, so
		// .library / .device / .task / etc. entries land in
		// state.folders alongside source items. Otherwise drift
		// detection would lose track of non-source items on every push.
		const name = nameFromPath(entry.path);
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
		// Push diff is SOURCE-only — config items (.library/.task/…)
		// are read-only by default and never sent back to the bridge.
		// Filter by family rather than by extension so adding a new
		// source kind doesn't require touching this function.
		const def = getByPath(entry.path);
		if (def === undefined || def.family !== "source") continue;
		const name = nameFromPath(entry.path);
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
