/**
 * volt-git status — incoming (bridge vs baseline), outgoing (workspace vs refs/volt/ide, via git diff),
 * and merge state (MERGE_HEAD present). Read-only; never mutates.
 */
import type { Remote } from "../bridge/types.js";
import { loadConfig, verifyBinding } from "../config/workspace.js";
import { diffNameStatus, isMerging, resolveGitDir, unmergedPaths } from "../git/plumbing.js";
import { computeIncoming, hasChanges } from "./diff.js";
import { loadIdeRefs, RANGE, voltIdeHead } from "./refs.js";
import type { ChangeSet, StatusResult } from "./types.js";

const stripSrc = (p: string): string => (p.startsWith("src/") ? p.slice(4) : p);

export async function status(root: string, bridge: Remote): Promise<StatusResult> {
	const gitDir = resolveGitDir(root);
	const cfg = loadConfig(root);

	let online = false;
	let detail = "";
	let bridgeItems: Record<string, string> = {};
	try {
		const health = await bridge.getHealth();
		online = health.connected === true;
		detail = online
			? `${health.platform}/${health.projectName ?? "?"}/${health.plcProjectName ?? "?"}`
			: (health.status ?? "offline");
		const bindErr = verifyBinding(cfg, health);
		if (bindErr !== undefined) detail = bindErr;
		const refs = await bridge.getRefs();
		bridgeItems = refs.items;
	} catch (err) {
		online = false;
		detail = err instanceof Error ? err.message : "bridge offline";
	}

	const sidecar = loadIdeRefs(root);
	const incoming: ChangeSet = online
		? computeIncoming(bridgeItems, sidecar?.items ?? {})
		: { added: [], modified: [], removed: [] };

	const outgoing: ChangeSet = { added: [], modified: [], removed: [] };
	if (voltIdeHead(gitDir) !== undefined) {
		for (const c of diffNameStatus(root, RANGE, "src")) {
			const p = stripSrc(c.path);
			if (c.status === "A") outgoing.added.push(p);
			else if (c.status === "D") outgoing.removed.push(p);
			else outgoing.modified.push(p);
		}
	}

	const merging = isMerging(root) ? { paths: unmergedPaths(root).map(stripSrc) } : null;

	let recommend: string | null = null;
	if (merging !== null) recommend = "resolve the conflict, then `git merge --continue`";
	else if (online && hasChanges(incoming)) recommend = "volt-git pull";
	else if (hasChanges(outgoing)) recommend = "volt-git push";

	return { bridge: { online, detail }, incoming, outgoing, merging, recommend };
}
