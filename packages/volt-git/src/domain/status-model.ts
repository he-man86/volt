/**
 * The drift/status model — compute the incoming changeset and the full StatusData from a bridge snapshot +
 * local git state, with NO bridge calls. Shared by the `status` command (which fetches the snapshot live) and
 * by pull/push (which pass the snapshot they ALREADY fetched, so a UI action stays one bridge call: the action
 * itself, whose response carries the resulting status). The StatusJson subset matches @volt/control's contract
 * exactly, so the desktop panel + vscode parse it unchanged.
 *
 * incoming = bridge-refs vs the sidecar baseline (worktree-independent — the IDE axis). outgoing = the
 * WORKING TREE vs refs/remotes/volt/ide (item-name keyed), so an edit shows the moment you save — committed
 * or not, incl. untracked new files. (push still sends committed HEAD after auto-commit; this is the live
 * view.) merging = MERGE_HEAD present.
 */
import { configExists } from "../config.js";
import { diffWorktree, isMerging, resolveGitDir, unmergedPaths } from "../git.js";
import { fullNameFromPath } from "./extensions.js";
import { loadIdeRefs } from "./sidecar.js";
import { RANGE, voltIdeHead } from "./ide-tree.js";
import { stripSrcPrefix } from "../files.js";
import type { ChangeSet, ProjectMismatch, StatusData } from "../types.js";

/** The IDE-side changeset: the bridge's item→version map diffed against the baseline (what the IDE last had).
 *  Shared by `pull` (up-to-date short-circuit) and `buildStatusData` (the incoming bucket). */
export function computeIncoming(bridge: Record<string, string>, base: Record<string, string>): ChangeSet {
	const added: string[] = [];
	const modified: string[] = [];
	const removed: string[] = [];
	for (const [name, v] of Object.entries(bridge)) {
		if (!(name in base)) added.push(name);
		else if (base[name] !== v) modified.push(name);
	}
	for (const name of Object.keys(base)) if (!(name in bridge)) removed.push(name);
	return { added: added.sort(), modified: modified.sort(), removed: removed.sort() };
}

const count = (c: ChangeSet): number => c.added.length + c.modified.length + c.removed.length;
const empty = (): ChangeSet => ({ added: [], removed: [], modified: [] });

/** The bridge-side inputs a status computation needs. `volt status` fetches these live; `pull`/`push`
 *  pass the data they ALREADY fetched, so they build the post-action status with no extra bridge call. */
export interface BridgeSnapshot {
	online: boolean;
	detail: string;
	projectMismatch: ProjectMismatch | null;
	items: Record<string, string>;
	folders: Record<string, string>;
	projectVersion: string;
}

export function buildStatusData(root: string, snap: BridgeSnapshot): StatusData {
	const gitDir = resolveGitDir(root);
	const initialized = configExists(root);
	const { online, detail, projectMismatch, items: bridgeItems, folders: bridgeFolders, projectVersion: bridgeProjectVersion } = snap;

	const sidecar = loadIdeRefs(root);
	const incoming: ChangeSet =
		online && projectMismatch === null ? computeIncoming(bridgeItems, sidecar?.items ?? {}) : empty();

	const pathByName: Record<string, string> = {};
	const outgoing: ChangeSet = empty();
	if (voltIdeHead(gitDir) !== undefined) {
		const place = (path: string, bucket: string[]): void => {
			const name = fullNameFromPath(path) ?? path;
			pathByName[name] = path;
			bucket.push(name);
		};
		for (const row of diffWorktree(root, RANGE, "src")) {
			if (row.kind === "rename") {
				place(stripSrcPrefix(row.oldPath), outgoing.removed); // a rename surfaces as remove(old) + add(new)
				place(stripSrcPrefix(row.newPath), outgoing.added);
			} else if (row.kind === "add") place(stripSrcPrefix(row.path), outgoing.added);
			else if (row.kind === "delete") place(stripSrcPrefix(row.path), outgoing.removed);
			else place(stripSrcPrefix(row.path), outgoing.modified);
		}
	}
	for (const name of [...incoming.added, ...incoming.modified, ...incoming.removed]) {
		if (pathByName[name] === undefined) {
			const folder = bridgeFolders[name] ?? "";
			pathByName[name] = folder.length > 0 ? `${folder}/${name}` : name;
		}
	}

	const merging = isMerging(root)
		? { projectVersion: bridgeProjectVersion, conflicts: unmergedPaths(root).map((p) => ({ path: stripSrcPrefix(p), kind: "text", reason: "both-modified" })) }
		: null;

	let recommend: string | null = null;
	if (merging !== null) recommend = "resolve the conflict, then `git merge --continue`";
	else if (online && count(incoming) > 0) recommend = "volt pull";
	else if (count(outgoing) > 0) recommend = "volt push";

	const summary = !initialized
		? "not initialized"
		: projectMismatch !== null
			? "project mismatch — open the bound project in the IDE"
			: merging !== null
				? `merging — ${merging.conflicts.length} conflict(s)`
				: countSummary(incoming, outgoing);

	return { initialized, merging, incoming, outgoing, pathByName, projectMismatch, summary, online, detail, recommend };
}

function countSummary(incoming: ChangeSet, outgoing: ChangeSet): string {
	const i = count(incoming);
	const o = count(outgoing);
	if (i === 0 && o === 0) return "in sync with the IDE";
	return [i > 0 ? `${i} incoming` : "", o > 0 ? `${o} outgoing` : ""].filter((s) => s.length > 0).join(", ");
}
