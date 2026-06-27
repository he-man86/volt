/**
 * volt-git pull — fetch the IDE, commit it onto refs/remotes/volt/ide, then `git merge` into the current branch.
 *
 *   no local edits  → fast-forward (no merge commit)
 *   local edits      → one merge commit (or conflict markers)
 *   dirty tree       → refused (commit/stash first — git won't merge a dirty tree)
 *
 * On conflict the sidecar baseline is intentionally NOT advanced: resolve via `git merge --continue`/
 * `--abort`, then run `volt-git pull` again to finalize.
 */
import type { Remote } from "../bridge/types.js";
import { loadConfig, verifyBinding } from "../config/workspace.js";
import {
	autoCommitSrc,
	currentBranch,
	gitMerge,
	headCommit,
	isMerging,
	readTreeToIndex,
	resolveGitDir,
	updateRef,
} from "../git/plumbing.js";
import { materializeItem } from "../translate/materialize.js";
import { ensureGitignore, stripSrcPrefix, writeSrcFiles } from "../workspace/files.js";
import { changeList, computeIncoming, hasChanges } from "./diff.js";
import { buildVoltIdeTree, commitVoltIde, loadIdeRefs, RANGE, saveIdeRefs, voltIdeHead, type IdeRefs } from "./refs.js";
import type { PullResult } from "./types.js";

export interface PullOptions {
	dryRun?: boolean;
}

export async function pull(root: string, bridge: Remote, opts: PullOptions = {}): Promise<PullResult> {
	const gitDir = resolveGitDir(root);
	ensureGitignore(root);

	if (isMerging(root)) {
		return { kind: "refused", reason: "a merge is already in progress — finish it with `git merge --continue` or `git merge --abort` first" };
	}

	const cfg = loadConfig(root);
	const bindErr = verifyBinding(cfg, await bridge.getHealth());
	if (bindErr !== undefined) return { kind: "refused", reason: bindErr };

	const refs = await bridge.getRefs();
	const sidecar = loadIdeRefs(root);
	const incoming = computeIncoming(refs.items, sidecar?.items ?? {});
	if (sidecar !== undefined && refs.projectVersion === sidecar.projectVersion && !hasChanges(incoming)) {
		return { kind: "ok", synced: [], message: "already up to date with the IDE" };
	}

	if (opts.dryRun === true) {
		return { kind: "ok", synced: changeList(incoming), message: "dry run — these IDE items would be merged in" };
	}

	// Simple flow (auto-commit-on-pull): commit any local edits, then merge — git won't merge a dirty tree.
	autoCommitSrc(root);

	const fetched = await bridge.fetchChanges({ knownItems: {} });
	const ideFiles = fetched.changed.flatMap(materializeItem);
	const newSidecar: IdeRefs = { projectVersion: fetched.projectVersion, items: fetched.items, folders: refs.folders };
	const head = headCommit(root);

	// Bootstrap: unborn HEAD — no merge target. Seed both refs + materialize files + sync the index.
	if (head === undefined) {
		const tree = buildVoltIdeTree(gitDir, undefined, ideFiles);
		const commit = commitVoltIde(gitDir, tree, undefined, `volt: IDE @ ${fetched.projectVersion}`);
		updateRef(gitDir, RANGE, commit);
		updateRef(gitDir, `refs/heads/${currentBranch(root) ?? "main"}`, commit);
		writeSrcFiles(root, ideFiles);
		readTreeToIndex(root, commit);
		saveIdeRefs(root, newSidecar);
		return { kind: "ok", synced: ideFiles.map((f) => f.path), message: "initialized workspace from the IDE" };
	}

	// Steady state: commit the IDE tree onto the volt/ide chain, then merge into the branch.
	const tree = buildVoltIdeTree(gitDir, head, ideFiles);
	const parent = voltIdeHead(gitDir) ?? head;
	const commit = commitVoltIde(gitDir, tree, parent, `volt: IDE @ ${fetched.projectVersion}`);
	updateRef(gitDir, RANGE, commit);

	const outcome = gitMerge(root, RANGE, `volt: merge IDE @ ${fetched.projectVersion}`);
	if (outcome.kind === "conflict") {
		return { kind: "conflict", paths: outcome.paths.map(stripSrcPrefix) };
	}
	saveIdeRefs(root, newSidecar);
	return { kind: "ok", synced: changeList(incoming) };
}
