/**
 * Workspace ↔ bridge translation. Used by `volt pull` and `volt push`.
 *
 * Wire-shape v2: the bridge owns structural parsing of `.st` (StSplitter)
 * and graphical body transpilation. The agent sends one file's raw contents
 * as `sourceText` and receives one assembled `sourceText` per item back —
 * always plain ST text regardless of original body language.
 */
import type { Remote } from "../bridge/types.js";
import type { FetchedItem, PushItemOp, PushOp, PushResponse } from "../bridge/types.js";
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
	getByPath,
	gitattributesContent,
	isKnownKind,
	isSourcePou,
	nameFromPath,
	nameIsVerbatim,
	pickExtension,
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
			process.stderr.write(`[skip] ${item.name} (${item.kind ?? "unknown kind"}): ${reason}\n`);
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
	if (item.kind === undefined || item.kind === null) {
		throw new Error(`bridge sent no "kind" for "${item.name}" — bridge binary is outdated, rebuild and restart it`);
	}
	const folder = item.folder ?? "";

	if (!isKnownKind(item.kind)) {
		throw new Error(
			`bridge sent unregistered kind "${item.kind}" for "${item.name}" — add it to registry/extensions.ts`,
		);
	}

	// A POU's extension follows its root body language (.st/.fbd/.ld/.cfc/.sfc); every other kind
	// uses its registry extension. The folder placeholder is the only kind with no extension.
	const ext = pickExtension(item.kind, item.language ?? undefined);
	if (ext.length === 0) {
		return [{ path: joinPath(folder, item.name, FOLDER_MARKER), content: "" }];
	}

	// Source POUs and read-only reference items are identical here — they differ only in whether
	// the filename is verbatim (e.g. tmc_file) or `name.ext`.
	const fileName = nameIsVerbatim(item.kind) ? item.name : `${item.name}.${ext}`;
	return [{ path: joinPath(folder, fileName), content: item.sourceText }];
}

function resolveOwnerItem(relPath: string, items: Record<string, string>): string | undefined {
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
	return undefined;
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
): Promise<{ accepted: true; commitSha: string } | { accepted: false; reason: string }> {
	const state = loadState(repoPath);
	if (state === null) {
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
		const def = getByPath(entry.path);
		if (def === undefined || !isSourcePou(def)) continue;
		const name = nameFromPath(entry.path);
		if (name === undefined) continue;
		const segs = entry.path.split("/");
		const folder = segs.slice(0, -1).join("/");
		const existing = out.get(name);
		if (existing !== undefined) {
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
		const ifVersion = state.items[name];
		if (ifVersion === undefined) continue;
		ops.push({ op: "deleteItem", name, ifVersion });
	}

	for (const [name, currFile] of curr) {
		const prevFile = prev.get(name);
		const currContent = readBlob(repoPath, currFile.entry.sha);

		if (prevFile === undefined) {
			ops.push(buildPushItemOp(name, currFile, currContent, null));
			continue;
		}

		const folderChanged = prevFile.folder !== currFile.folder;
		const contentChanged = prevFile.entry.sha !== currFile.entry.sha;
		if (!folderChanged && !contentChanged) continue;

		const ifVersion = state.items[name];
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

function joinPath(...parts: string[]): string {
	return parts.filter((p) => p.length > 0).join("/");
}

function normalizeLineEndings(s: string): string {
	return s.replace(/\r\n/g, "\n");
}

function denormalizeLineEndings(s: string): string {
	return s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
}
