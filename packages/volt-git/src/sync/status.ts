/**
 * volt-git status — produces the StatusData the text renderer uses, whose StatusJson subset matches
 * @volt/control's contract exactly (so the desktop panel + vscode parse it unchanged).
 * incoming = bridge-refs vs the sidecar baseline (worktree-independent — the IDE axis). outgoing = the
 * WORKING TREE vs refs/remotes/volt/ide (item-name keyed), so an edit shows the moment you save — committed
 * or not, incl. untracked new files. (push still sends committed HEAD after auto-commit; this is the live
 * view.) merging = MERGE_HEAD present.
 */
import type { HealthResponse, Remote } from "../bridge/types.js";
import { configExists, loadConfig, type WorkspaceConfig } from "../config/workspace.js";
import { diffWorktree, isMerging, resolveGitDir, unmergedPaths } from "../git/plumbing.js";
import { fullNameFromPath } from "../registry/extensions.js";
import { computeIncoming, countChanges, hasChanges } from "./diff.js";
import { loadIdeRefs, RANGE, voltIdeHead } from "./refs.js";
import { stripSrcPrefix } from "../workspace/files.js";
import type { ChangeSet, ProjectMismatch, StatusData } from "./types.js";

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

export async function status(root: string, bridge: Remote): Promise<StatusData> {
	const cfg = configExists(root) ? loadConfig(root) : undefined;
	let snap: BridgeSnapshot = { online: false, detail: "offline", projectMismatch: null, items: {}, folders: {}, projectVersion: "" };
	try {
		const health = await bridge.getHealth();
		const online = health.connected === true;
		const projectMismatch = cfg !== undefined ? mismatch(cfg, health) : null;
		const detail = online ? `${health.platform}/${health.projectName ?? "?"}` : (health.status ?? "offline");
		if (online && projectMismatch === null) {
			const refs = await bridge.getRefs();
			snap = { online, detail, projectMismatch, items: refs.items, folders: refs.folders, projectVersion: refs.projectVersion };
		} else {
			snap = { online, detail, projectMismatch, items: {}, folders: {}, projectVersion: "" };
		}
	} catch (err) {
		snap = { ...snap, online: false, detail: err instanceof Error ? err.message : "bridge offline" };
	}
	return buildStatusData(root, snap);
}

/** Compute StatusData from a bridge snapshot + the local git state — NO bridge calls. Shared by `volt status`
 *  (which fetches the snapshot live) and by `pull`/`push` (which pass the snapshot they already fetched, so a
 *  UI action stays one bridge call: the action itself, whose response carries the resulting status). */
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
	else if (online && hasChanges(incoming)) recommend = "volt pull";
	else if (hasChanges(outgoing)) recommend = "volt push";

	const summary = !initialized
		? "not initialized"
		: projectMismatch !== null
			? "project mismatch — open the bound project in the IDE"
			: merging !== null
				? `merging — ${merging.conflicts.length} conflict(s)`
				: countSummary(incoming, outgoing);

	return { initialized, merging, incoming, outgoing, pathByName, projectMismatch, summary, online, detail, recommend };
}

const empty = (): ChangeSet => ({ added: [], removed: [], modified: [] });

function mismatch(cfg: WorkspaceConfig, health: HealthResponse): ProjectMismatch | null {
	const bridgeReports = { platform: health.platform, projectName: health.projectName ?? "" };
	const configuredAs = { platform: cfg.project.platform, projectName: cfg.project.projectName };
	const diffFields = (["platform", "projectName"] as const).filter((f) => configuredAs[f] !== bridgeReports[f]);
	return diffFields.length > 0 ? { configuredAs, bridgeReports, diffFields: [...diffFields] } : null;
}

function countSummary(incoming: ChangeSet, outgoing: ChangeSet): string {
	const i = countChanges(incoming);
	const o = countChanges(outgoing);
	if (i === 0 && o === 0) return "in sync with the IDE";
	return [i > 0 ? `${i} incoming` : "", o > 0 ? `${o} outgoing` : ""].filter((s) => s.length > 0).join(", ");
}
