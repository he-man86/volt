/**
 * volt-git status — produces the StatusData the text renderer uses, whose StatusJson subset matches
 * @opencode-ai/volt-control's contract exactly (so the desktop panel + vscode parse it unchanged).
 * incoming = bridge vs baseline; outgoing = workspace vs refs/volt/ide (git diff, item-name keyed);
 * merging = MERGE_HEAD present.
 */
import type { HealthResponse, Remote } from "../bridge/types.js";
import { configExists, loadConfig, type WorkspaceConfig } from "../config/workspace.js";
import { diffNameStatus, isMerging, resolveGitDir, unmergedPaths } from "../git/plumbing.js";
import { fullNameFromPath } from "../registry/extensions.js";
import { computeIncoming, hasChanges } from "./diff.js";
import { loadIdeRefs, RANGE, voltIdeHead } from "./refs.js";
import { stripSrcPrefix } from "../workspace/files.js";
import type { ChangeSet, ProjectMismatch, StatusData } from "./types.js";

export async function status(root: string, bridge: Remote): Promise<StatusData> {
	const gitDir = resolveGitDir(root);
	const initialized = configExists(root);
	const cfg = initialized ? loadConfig(root) : undefined;

	let online = false;
	let detail = "";
	let bridgeItems: Record<string, string> = {};
	let bridgeFolders: Record<string, string> = {};
	let bridgeProjectVersion = "";
	let projectMismatch: ProjectMismatch | null = null;
	try {
		const health = await bridge.getHealth();
		online = health.connected === true;
		detail = online ? `${health.platform}/${health.projectName ?? "?"}/${health.plcProjectName ?? "?"}` : (health.status ?? "offline");
		if (cfg !== undefined) projectMismatch = mismatch(cfg, health);
		if (projectMismatch === null) {
			const refs = await bridge.getRefs();
			bridgeItems = refs.items;
			bridgeFolders = refs.folders;
			bridgeProjectVersion = refs.projectVersion;
		}
	} catch (err) {
		online = false;
		detail = err instanceof Error ? err.message : "bridge offline";
	}

	const sidecar = loadIdeRefs(root);
	const incoming: ChangeSet =
		online && projectMismatch === null ? computeIncoming(bridgeItems, sidecar?.items ?? {}) : empty();

	const pathByName: Record<string, string> = {};
	const outgoing: ChangeSet = empty();
	if (voltIdeHead(gitDir) !== undefined) {
		for (const c of diffNameStatus(root, RANGE, "src")) {
			const path = stripSrcPrefix(c.path);
			const name = fullNameFromPath(path) ?? path;
			pathByName[name] = path;
			if (c.status === "A") outgoing.added.push(name);
			else if (c.status === "D") outgoing.removed.push(name);
			else outgoing.modified.push(name);
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
	else if (online && hasChanges(incoming)) recommend = "volt-git pull";
	else if (hasChanges(outgoing)) recommend = "volt-git push";

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
	const bridgeReports = { platform: health.platform, projectName: health.projectName ?? "", plcProjectName: health.plcProjectName ?? "" };
	const configuredAs = { platform: cfg.project.platform, projectName: cfg.project.projectName, plcProjectName: cfg.project.plcProjectName };
	const diffFields = (["platform", "projectName", "plcProjectName"] as const).filter((f) => configuredAs[f] !== bridgeReports[f]);
	return diffFields.length > 0 ? { configuredAs, bridgeReports, diffFields: [...diffFields] } : null;
}

function countSummary(incoming: ChangeSet, outgoing: ChangeSet): string {
	const i = incoming.added.length + incoming.modified.length + incoming.removed.length;
	const o = outgoing.added.length + outgoing.modified.length + outgoing.removed.length;
	if (i === 0 && o === 0) return "in sync with the IDE";
	return [i > 0 ? `${i} incoming` : "", o > 0 ? `${o} outgoing` : ""].filter((s) => s.length > 0).join(", ");
}
