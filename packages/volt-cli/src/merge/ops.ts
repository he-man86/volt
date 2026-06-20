/**
 * Workspace ↔ bridge translation. Used by `volt pull` and `volt push`.
 *
 * Wire-shape v2: the bridge owns structural parsing of `.st` (StSplitter)
 * and graphical body transpilation. The agent sends one file's raw contents
 * as `sourceText` and receives one assembled `sourceText` per item back —
 * always plain ST text regardless of original body language.
 */
import type { Remote } from "../bridge/types.js";
import type { DeleteItemOp, FetchedItem, MoveItemOp, PushItemOp, PushOp, PushResponse } from "../bridge/types.js";
import type { ChangeSet } from "../snapshot/state.js";
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
} from "../git/plumbing.js";
import { loadState, saveState, type RepoState } from "../snapshot/repo.js";
import { listWorkspaceFiles } from "../snapshot/workspace.js";
import {
	FOLDER_MARKER,
	defFromName,
	fullNameFromPath,
	getByPath,
	gitattributesContent,
	isSourcePou,
	nameFromPath,
	sourceExtensions,
} from "../registry/extensions.js";
import { isPullable, type AccessOverrides } from "../registry/access.js";

// ─── Bridge → workspace materialization ────────────────────────────────

interface SyncOptions {
	fullRebuild?: boolean;
	accessOverrides?: AccessOverrides;
	onProgress?: (event: string) => void;
}

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

	if (!opts.fullRebuild && state !== null && state.projectVersion === refs.projectVersion) {
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

	if (state !== null) {
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

	const skipped: Array<{ name: string; reason: string }> = [];
	for (const item of fetchResp.changed) {
		try {
			const outputs = materializeItem(item);
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
			process.stderr.write(`[skip] ${item.name}: ${reason}\n`);
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

export interface MaterializedFile {
	path: string;
	content: string;
}

function materializeItem(item: FetchedItem): MaterializedFile[] {
	const folder = item.folder ?? ""
	const name = item.name                    // already includes extension, e.g. "PLC_PRG.st"
	const def = defFromName(name)
	if (!def) {
		throw new Error(`unrecognized extension in "${name}" — add it to registry/extensions.ts`)
	}
	if (def.ext.length === 0) {
		return [{ path: joinPath(folder, name, FOLDER_MARKER), content: "" }]
	}
	return [{ path: joinPath(folder, name), content: item.sourceText }]
}

function resolveOwnerItem(relPath: string, items: Record<string, string>): string | undefined {
	// `items` is keyed by FULL wire name (the bridge's keying), and so is a workspace filename — they are
	// the same string. A folder marker is the one exception: a folder has no extension, so its key is its
	// bare name. No bare↔full resolution — the file IS its key.
	if (relPath.endsWith(`/${FOLDER_MARKER}`) || relPath === FOLDER_MARKER) {
		const name = nameFromPath(relPath);
		return name !== undefined && name in items ? name : undefined;
	}
	const basename = relPath.split("/").pop()!;   // the full filename = the item's wire key
	return basename in items ? basename : undefined;
}

// ─── Pure-read primitive: peekBridgeItem ──────────────────────────────

export async function peekBridgeItem(bridge: Remote, name: string): Promise<MaterializedFile[]> {
	const resp = await bridge.fetchChanges({
		knownItems: { [name]: "" },
		onlyItems: [name],
	});
	const item = resp.changed.find((i) => i.name === name);
	if (item === undefined) {
		throw new Error(
			`bridge has no item named '${name}' — check the spelling or run \`volt status\` to see what's available`,
		);
	}
	return materializeItem(item);
}

// ─── Drift-cause diagnostic ───────────────────────────────────────────

export async function workspaceMatchesBridge(
	workspaceRoot: string,
	bridge: Remote,
): Promise<boolean> {
	const { changed: bridgeItems } = await bridge.fetchChanges({ knownItems: {} });
	const wsFiles = listWorkspaceFiles(workspaceRoot);
	const wsByPath = new Map(
		wsFiles.map((f) => [f.path, normalizeLineEndings(f.content.toString("utf-8"))]),
	);

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

	const sourceExts = sourceExtensions();
	for (const wsPath of wsByPath.keys()) {
		if (!expectedPaths.has(wsPath) && sourceExts.some((e) => wsPath.endsWith(e))) return false;
	}

	return true;
}

// ─── Workspace → bridge push ──────────────────────────────────────────

export async function applyPushToBridge(
	repoPath: string,
	bridge: Remote,
	newCommitSha: string,
): Promise<{ accepted: true; commitSha: string; pushed: ChangeSet } | { accepted: false; reason: string }> {
	const state = loadState(repoPath);
	if (state === null) {
		return { accepted: false, reason: "no snapshot to diff against — run `volt pull` once first" };
	}

	const newTreeEntries = listTree(repoPath, newCommitSha);
	const prevTreeEntries = listTree(repoPath, state.commitSha);

	const ops = buildPushOps(repoPath, prevTreeEntries, newTreeEntries, state);
	// The receipt is derived from the ops ACTUALLY sent — one source of truth, so the printed summary can
	// never disagree with what hit the bridge (full wire names throughout).
	const pushed = changesetFromOps(ops, state);
	if (ops.length === 0) {
		saveState(repoPath, { ...state, commitSha: newCommitSha });
		return { accepted: true, commitSha: newCommitSha, pushed };
	}

	const pushReq = { ops, expectedProjectVersion: state.projectVersion };
	const resp: PushResponse = await bridge.pushBatch(pushReq);

	if (!resp.accepted) {
		// Return the bare conflict summary — push.ts adds the "bridge rejected push:" prefix + hint (don't
		// double it). Version fields only when present (a thrown-op-error conflict has none).
		const summary = resp.conflicts
			.map((c) => {
				const vers = c.yourVersion != null || c.currentVersion != null
					? ` (yours=${c.yourVersion ?? "null"}, current=${c.currentVersion ?? "null"})` : "";
				return `${c.name}: ${c.reason}${vers}`;
			})
			.join("; ");
		return { accepted: false, reason: summary };
	}

	const newFolders: Record<string, string> = {};   // full-keyed, matching resp.newItems
	for (const entry of newTreeEntries) {
		const name = fullNameFromPath(entry.path);
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

	return { accepted: true, commitSha: newCommitSha, pushed };
}

/** What a push WOULD send (full wire names) for a staged tree, WITHOUT sending — the dry-run preview runs the
 * exact same buildPushOps diff as the real push, so there is ONE diff algorithm, never a divergent second one. */
export function previewPushChangeset(repoPath: string, newTreeSha: string): ChangeSet {
	const state = loadState(repoPath);
	if (state === null) return { added: [], removed: [], modified: [], moved: [] };
	const ops = buildPushOps(repoPath, listTree(repoPath, state.commitSha), listTree(repoPath, newTreeSha), state);
	return changesetFromOps(ops, state);
}

/** The push receipt, derived straight from the ops sent (full wire names) — never a second diff. */
function changesetFromOps(ops: PushOp[], state: RepoState): ChangeSet {
	const isPush = (o: PushOp): o is PushItemOp => o.op === "pushItem";
	return {
		added: ops.filter(isPush).filter((o) => o.ifVersion === null).map((o) => o.name).sort(),
		modified: ops.filter(isPush).filter((o) => o.ifVersion !== null).map((o) => o.name).sort(),
		removed: ops.filter((o): o is DeleteItemOp => o.op === "deleteItem").map((o) => o.name).sort(),
		moved: ops
			.filter((o): o is MoveItemOp => o.op === "moveItem")
			.map((o) => ({ name: o.name, from: state.folders[o.name] ?? "", to: o.newFolder }))
			.sort((a, b) => a.name.localeCompare(b.name)),
	};
}

interface PouFile {
	name: string;
	folder: string;
	entry: TreeEntry;
}

function buildPouFileMap(entries: readonly TreeEntry[]): Map<string, PouFile> {
	const out = new Map<string, PouFile>();        // keyed by FULL wire name (the filename) — the wire/state identity
	const bareToFull = new Map<string, string>();  // bare IEC name → full name, to catch "two files, one POU"
	for (const entry of entries) {
		const def = getByPath(entry.path);
		if (def === undefined || !isSourcePou(def)) continue;
		const name = fullNameFromPath(entry.path);
		const bare = nameFromPath(entry.path);
		if (name === undefined || bare === undefined) continue;
		const clash = bareToFull.get(bare);
		if (clash !== undefined) {
			throw new Error(
				`two files produce the same POU '${bare}': '${clash}' and '${name}' — a POU has one body. ` +
					`Remove one of the files.`,
			);
		}
		bareToFull.set(bare, name);
		const segs = entry.path.split("/");
		const folder = segs.slice(0, -1).join("/");
		out.set(name, { name, folder, entry });
	}
	return out;
}

function buildPushOps(
	repoPath: string,
	prevEntries: readonly TreeEntry[],
	newEntries: readonly TreeEntry[],
	state: RepoState,
): PushOp[] {
	const prev = buildPouFileMap(prevEntries);
	const curr = buildPouFileMap(newEntries);
	const ops: PushOp[] = [];

	for (const [name] of prev) {
		if (curr.has(name)) continue;
		const ifVersion = state.items[name];   // `name` is the full wire name; state.items is full-keyed
		if (ifVersion === undefined) continue;
		ops.push({ op: "deleteItem", name, ifVersion });
	}

	for (const [name, currFile] of curr) {
		const prevFile = prev.get(name);
		const currContent = readBlob(repoPath, currFile.entry.sha);
		// First line of defence: a file's extension must match its content, so a mislabelled body (e.g. a
		// .st renamed to .fbd, or a .fbd holding ST/LD) is caught HERE — before it reaches the bridge, which
		// is extension-agnostic and could never tell. Runs for every current file (new/changed/even no-op).
		validateExtensionMatchesContent(currFile.entry.path, currContent);

		if (prevFile === undefined) {
			ops.push(buildPushItemOp(name, currFile, currContent, null));
			continue;
		}

		const folderChanged = prevFile.folder !== currFile.folder;
		const contentChanged = prevFile.entry.sha !== currFile.entry.sha;
		if (!folderChanged && !contentChanged) continue;

		const ifVersion = state.items[name];   // `name` is the full wire name; state.items is full-keyed
		if (ifVersion === undefined) continue;

		if (folderChanged && !contentChanged) {
			ops.push({ op: "moveItem", name, newFolder: currFile.folder, ifVersion });
			continue;
		}

		ops.push(buildPushItemOp(name, currFile, currContent, ifVersion));
	}

	return ops;
}

function buildPushItemOp(
	name: string,
	currFile: PouFile,
	currContent: string,
	ifVersion: string | null,
): PushItemOp {
	const folderField = currFile.folder.length > 0 ? { folder: currFile.folder } : {};
	const sourceText = denormalizeLineEndings(currContent);
	return { op: "pushItem", name, ...folderField, sourceText, ifVersion };
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Detect a workspace file's body language from its content, mirroring the bridge's VgBody: a graphical body
 * opens with `%LANG <x>` (read-only CFC/SFC) or `NETWORK <n> <LANG>` (FBD/LD). Returns the upper-cased
 * language, or null for textual (ST / DUT / declaration) content.
 */
function detectBodyLanguage(content: string): string | null {
	// An EDITABLE graphical body carries a `NETWORK <n> <LANG>` network line (FBD/LD) — same marker the
	// bridge's VgBody uses. For a ROOT POU file it sits AFTER the declaration (PROGRAM/VAR…END_VAR), so
	// search every LINE (multiline `^`), not just the start. (Read-only CFC/SFC are declaration-only —
	// no content marker — and not pushable, so they never reach here.)
	const net = /^[ \t]*NETWORK[ \t]+\d+[ \t]+([A-Za-z]\w*)/m.exec(content);
	return net ? net[1]!.toUpperCase() : null;
}

const GRAPHICAL_EXT: Record<string, string> = { fbd: "FBD", ld: "LD" };

/** Refuse a file whose extension and content disagree — the `.st`↔`.fbd`-style mislabel the bridge can't catch. */
export function validateExtensionMatchesContent(path: string, content: string): void {
	const dot = path.lastIndexOf(".");
	const ext = (dot >= 0 ? path.slice(dot + 1) : "").toLowerCase();
	const bodyLang = detectBodyLanguage(content); // null = textual; FBD/LD/CFC/SFC = graphical
	const expected = GRAPHICAL_EXT[ext];
	if (expected !== undefined) {
		if (bodyLang === null)
			throw new Error(
				`'${path}' is a .${ext} file but contains plain ST text, not a graphical body — ` +
					`did you rename a .st file? Rename it back, or fix the content.`,
			);
		if (bodyLang !== expected)
			throw new Error(
				`'${path}' is a .${ext} file but its body language is ${bodyLang} — ` +
					`rename it to '.${bodyLang.toLowerCase()}', or fix the content.`,
			);
		return;
	}
	// Every other source extension (.st/.struct/.enum/.itf/.gvl/…) is textual — a graphical marker is a mislabel.
	if (bodyLang !== null)
		throw new Error(
			`'${path}' has a .${ext} extension but contains a ${bodyLang} graphical body — ` +
				`did you rename a .${bodyLang.toLowerCase()} file? Rename it back, or fix the content.`,
		);
}

function joinPath(...parts: string[]): string {
	return parts.filter((p) => p.length > 0).join("/");
}

function normalizeLineEndings(s: string): string {
	return s.replace(/\r\n/g, "\n");
}

function denormalizeLineEndings(s: string): string {
	return s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
}
