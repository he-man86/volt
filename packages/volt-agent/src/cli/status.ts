/**
 * `volt status` verb — answer the three questions that matter before
 * running `pull` or `push`:
 *
 *   1. Has the IDE changed since our last pull? (which items?)
 *   2. Has the workspace changed since our last pull? (which files?)
 *   3. What should the user / AI do next?
 *
 * Cheap (single /refs + a tree hash of the workspace, no per-file
 * bridge round-trips), so safe to run as often as the user wants.
 *
 * Default output is shaped like `git status`: a one-line summary, then
 * a per-item breakdown labelled with the VCS-standard direction terms.
 * `incoming` ([IDE] block) = `hg incoming` / `HEAD..@{u}`.
 * `outgoing` ([WS] block)  = `hg outgoing` / `@{u}..HEAD`.
 *
 * `--porcelain` outputs ONLY one line per item, in a stable
 * machine-parseable format (inspired by `git status --porcelain`):
 *   <dir><code> <name>
 * where <dir> is `i` (incoming) or `o` (outgoing), <code> is `A`
 * (added), `M` (modified), or `D` (deleted), separated from the name
 * by a single space.
 */
import { resolve } from "node:path";
import { configExists, loadConfig, workspacePaths } from "../engine/config.js";
import { listTree } from "../engine/git-cmds.js";
import { isMergingNow, type ConflictEntry } from "../engine/merge.js";
import { workspaceMatchesBridge } from "../engine/ops.js";
import { nameFromPouPath, pickExtension } from "../engine/pou-files.js";
import {
	computeIncoming,
	computeOutgoing,
	detectWorkspaceDirty,
	ensureSnapshotRepo,
	hasChanges,
	loadState,
	reportSnapshotHeal,
	type ChangeSet,
} from "../engine/snapshot.js";
import { flagBool, type VerbFn } from "./_shared.js";

type NextAction = "init" | "pull" | "push" | "reconcile" | "merge-continue" | null;

interface StatusResult {
	initialized: boolean;
	ideDrifted: boolean;
	workspaceDirty: boolean;
	incoming: ChangeSet;
	dirtyPaths: string[];
	outgoing: ChangeSet;
	driftLikelySelfCaused: boolean;
	bridgeProjectVersion: string;
	snapshotProjectVersion: string | undefined;
	nextAction: NextAction;
	summary: string;
	/** Populated when MERGE_HEAD is present; null when not mid-merge. */
	merging: { projectVersion: string; conflicts: ConflictEntry[] } | null;
	/**
	 * Item name → workspace-relative path. Covers every name appearing
	 * in `incoming`, `outgoing`, or `merging.conflicts`. Lets UI clients
	 * (VS Code extension) construct workspace-file URIs without guessing
	 * extensions. Paths use forward slashes.
	 */
	pathByName: Record<string, string>;
}

export const status: VerbFn = async ({ workspace, bridge, flags }) => {
	const r = await computeStatus(workspace, bridge);

	if (flagBool(flags, "json")) {
		// Single JSON object — the surface the VS Code extension reads.
		// Omits the dirtyPaths flat list (callers can derive from outgoing).
		//
		// `pathByName` lets the UI construct workspace-file URIs without
		// guessing extensions. Items in the snapshot get their tree path
		// directly; incoming-added items (not in snapshot yet) get their
		// extension derived from the bridge's `kinds` map.
		const out = {
			initialized: r.initialized,
			merging: r.merging,
			incoming: r.incoming,
			outgoing: r.outgoing,
			pathByName: r.pathByName,
			snapshotProjectVersion: r.snapshotProjectVersion ?? null,
			bridgeProjectVersion: r.bridgeProjectVersion,
			ideDrifted: r.ideDrifted,
			workspaceDirty: r.workspaceDirty,
			driftLikelySelfCaused: r.driftLikelySelfCaused,
			nextAction: r.nextAction,
			summary: r.summary,
		};
		process.stdout.write(`${JSON.stringify(out)}\n`);
		return 0;
	}

	if (flagBool(flags, "porcelain")) {
		// Pre-init / pre-bind: empty stdout is the correct porcelain
		// answer. Print a sentinel to stderr for interactive humans.
		if (!r.initialized) {
			process.stderr.write(`# ${r.summary}\n`);
			return 0;
		}
		if (r.merging !== null) {
			// Mid-merge: emit `xU <name>` rows for each conflict (direction-
			// agnostic, mirroring git porcelain v1's `U` for unmerged).
			process.stderr.write(`# merging from ${r.merging.projectVersion}\n`);
			for (const c of r.merging.conflicts) {
				process.stdout.write(`xU ${c.path}\n`);
			}
			return 0;
		}
		writePorcelain("i", r.incoming);
		writePorcelain("o", r.outgoing);
		return 0;
	}

	if (!r.initialized) {
		console.log(r.summary);
		console.log(`bridge projectVersion: ${r.bridgeProjectVersion}`);
		return 0;
	}

	console.log(r.summary);
	console.log("");

	if (r.merging !== null) {
		// Mid-merge: list the unresolved files mirror-style to
		// `git status` after a merge conflict.
		console.log("Unmerged paths:");
		console.log(`  (use "volt merge --continue" to record the result)`);
		console.log(`  (use "volt merge --abort" to undo the merge)`);
		console.log("");
		for (const c of r.merging.conflicts) {
			const tag =
				c.reason === "both-modified"
					? "both modified"
					: c.reason === "delete-modify"
						? "deleted by us"
						: c.reason === "modify-delete"
							? "deleted by them"
							: "both added";
			const kindTag = c.kind === "graphical" ? " (graphical)" : "";
			console.log(`  ${tag}:${" ".repeat(Math.max(1, 14 - tag.length))}${c.path}${kindTag}`);
		}
		console.log("");
		console.log(`merge target projectVersion: ${r.merging.projectVersion}`);
		return 0;
	}

	if (hasChanges(r.incoming)) {
		console.log("incoming — would land in workspace on volt pull:");
		for (const name of r.incoming.added) console.log(`  [IDE] + ${name}  (engineer created)`);
		for (const name of r.incoming.modified) console.log(`  [IDE] M ${name}  (engineer edited)`);
		for (const name of r.incoming.removed) console.log(`  [IDE] - ${name}  (engineer deleted)`);
	}
	if (r.workspaceDirty) {
		if (hasChanges(r.incoming)) console.log("");
		console.log("outgoing — would be sent to bridge on volt push:");
		for (const name of r.outgoing.added) console.log(`  [WS]  + ${name}  (you created)`);
		for (const name of r.outgoing.modified) console.log(`  [WS]  M ${name}  (you edited)`);
		for (const name of r.outgoing.removed) console.log(`  [WS]  - ${name}  (you deleted)`);
	}

	console.log("");
	console.log(`snapshot projectVersion: ${r.snapshotProjectVersion ?? "<none>"}`);
	console.log(`bridge   projectVersion: ${r.bridgeProjectVersion}`);
	return 0;
};

async function computeStatus(workspaceRoot: string, bridge: Parameters<VerbFn>[0]["bridge"]): Promise<StatusResult> {
	const root = resolve(workspaceRoot);
	const paths = workspacePaths(root);

	const hasConfig = configExists(root);
	if (hasConfig) loadConfig(root); // throws only on malformed config

	const refs = await bridge.getRefs();

	if (!hasConfig) {
		return emptyStatus(refs.projectVersion, "init", "Workspace not initialized — run volt init to bind it to the IDE project.");
	}

	reportSnapshotHeal(ensureSnapshotRepo(paths.snapshotPath));
	const state = loadState(paths.snapshotPath);
	if (state === undefined) {
		return emptyStatus(refs.projectVersion, "pull", "Workspace bound but never pulled — run volt pull to populate.");
	}

	// Mid-merge check first — it short-circuits the normal status flow.
	// While MERGE_HEAD is present, both `pull` and `push` are refused;
	// the only sensible next action is to resolve and continue.
	const mergeState = isMergingNow(paths.snapshotPath);
	if (mergeState !== undefined) {
		// Mid-merge: conflicts.paths already give us the workspace
		// paths directly, so the map is trivial.
		const mergePathByName: Record<string, string> = {};
		for (const c of mergeState.conflicts) {
			const name = nameFromPouPath(c.path);
			if (name !== undefined) mergePathByName[name] = c.path;
		}
		return {
			initialized: true,
			ideDrifted: false,
			workspaceDirty: true,
			incoming: { added: [], removed: [], modified: [] },
			dirtyPaths: [],
			outgoing: { added: [], removed: [], modified: [] },
			driftLikelySelfCaused: false,
			bridgeProjectVersion: refs.projectVersion,
			snapshotProjectVersion: state.projectVersion,
			nextAction: "merge-continue",
			summary: `merging IDE@${mergeState.projectVersion} into workspace — ${mergeState.conflicts.length} conflict(s) to resolve, then run \`volt merge --continue\`.`,
			merging: {
				projectVersion: mergeState.projectVersion,
				conflicts: mergeState.conflicts,
			},
			pathByName: mergePathByName,
		};
	}

	const incoming = computeIncoming(refs.items, state.items);
	const ideDrifted = hasChanges(incoming) || refs.projectVersion !== state.projectVersion;
	const dirtyPaths = detectWorkspaceDirty(paths.snapshotPath, root, state.commitSha);
	const workspaceDirty = dirtyPaths.length > 0;
	const outgoing = workspaceDirty
		? computeOutgoing(paths.snapshotPath, root, state.commitSha)
		: { added: [], removed: [], modified: [] };

	// When drift is detected, ask "did we cause this?" by comparing
	// the workspace files to what the bridge would re-materialize.
	// Self-caused = workspace IS already what bridge has → pull is
	// safe (content no-op). Costs one /fetch.
	const driftLikelySelfCaused = ideDrifted ? await workspaceMatchesBridge(root, bridge) : false;

	const { nextAction, summary } = recommend(
		ideDrifted,
		workspaceDirty,
		incoming,
		dirtyPaths.length,
		driftLikelySelfCaused,
	);

	const pathByName = computePathByName(
		paths.snapshotPath,
		state.commitSha,
		state.folders ?? {},
		refs.items,
		refs.kinds ?? {},
		incoming,
		outgoing,
	);

	return {
		initialized: true,
		ideDrifted,
		workspaceDirty,
		incoming,
		dirtyPaths,
		outgoing,
		driftLikelySelfCaused,
		bridgeProjectVersion: refs.projectVersion,
		snapshotProjectVersion: state.projectVersion,
		nextAction,
		summary,
		merging: null,
		pathByName,
	};
}

/**
 * Build a name → workspace-relative-path map covering every item
 * referenced in `incoming` or `outgoing`. Used by the VS Code
 * extension's TreeView to construct workspace-file URIs without
 * guessing extensions.
 *
 * Resolution order:
 *   1. Items already in the snapshot tree → use the tree entry's path
 *      (authoritative: it's exactly where pull materialized the file).
 *   2. Incoming-added items (NOT in snapshot yet) → derive path from
 *      the bridge's `kinds` map + `folders` (or default "POUs") +
 *      `pickExtension`. We may not know language for graphical kinds,
 *      so this is best-effort for those.
 */
function computePathByName(
	snapshotPath: string,
	commitSha: string,
	folders: Record<string, string>,
	bridgeItems: Record<string, string>,
	bridgeKinds: Record<string, string>,
	incoming: ChangeSet,
	outgoing: ChangeSet,
): Record<string, string> {
	const out: Record<string, string> = {};
	// 1. Names present in the snapshot tree — authoritative path.
	for (const entry of listTree(snapshotPath, commitSha)) {
		const name = nameFromPouPath(entry.path);
		if (name !== undefined) out[name] = entry.path;
	}
	// 2. Incoming-added items aren't in the snapshot yet — synthesize
	//    a path from kinds + folders.
	const allNames = new Set<string>([
		...incoming.added, ...incoming.modified, ...incoming.removed,
		...outgoing.added, ...outgoing.modified, ...outgoing.removed,
	]);
	for (const name of allNames) {
		if (out[name] !== undefined) continue;
		const kind = bridgeKinds[name];
		// Best-effort: no kind = treat as ST (most common). If wrong,
		// the diff click still opens but the workspace URI may point
		// at a non-existent file — TreeView's content provider handles
		// missing-file with an empty-RIGHT diff pane.
		const ext = kind !== undefined ? pickExtension(kind) : "st";
		const folder = folders[name] ?? "POUs";
		out[name] = folder.length > 0 ? `${folder}/${name}.${ext}` : `${name}.${ext}`;
	}
	return out;
}

function emptyStatus(bridgeProjectVersion: string, nextAction: NextAction, summary: string): StatusResult {
	return {
		initialized: false,
		ideDrifted: false,
		workspaceDirty: false,
		incoming: { added: [], removed: [], modified: [] },
		dirtyPaths: [],
		outgoing: { added: [], removed: [], modified: [] },
		driftLikelySelfCaused: false,
		bridgeProjectVersion,
		snapshotProjectVersion: undefined,
		nextAction,
		summary,
		merging: null,
		pathByName: {},
	};
}

function recommend(
	ideDrifted: boolean,
	workspaceDirty: boolean,
	incoming: ChangeSet,
	dirtyCount: number,
	driftLikelySelfCaused: boolean,
): { nextAction: NextAction; summary: string } {
	if (!ideDrifted && !workspaceDirty) {
		return { nextAction: null, summary: "All in sync — nothing to do." };
	}
	if (ideDrifted && !workspaceDirty) {
		if (driftLikelySelfCaused) {
			return {
				nextAction: "pull",
				summary:
					`IDE reports ${formatCounts(incoming)} but workspace already matches — ` +
					`probably a previous volt push landed without saving its receipt. ` +
					`Run volt pull to refresh the snapshot (content no-op).`,
			};
		}
		return {
			nextAction: "pull",
			summary: `IDE has ${formatCounts(incoming)} — run volt pull.`,
		};
	}
	if (!ideDrifted && workspaceDirty) {
		return {
			nextAction: "push",
			summary: `Workspace has ${dirtyCount} change(s) — run volt push.`,
		};
	}
	return {
		nextAction: "reconcile",
		summary:
			`Both sides changed: IDE has ${formatCounts(incoming)}, workspace has ${dirtyCount} change(s). ` +
			`Run volt pull first to absorb IDE changes (use --force if you want to drop your workspace edits), ` +
			`then volt push.`,
	};
}

function formatCounts(c: ChangeSet): string {
	const parts: string[] = [];
	if (c.added.length > 0) parts.push(`+${c.added.length}`);
	if (c.modified.length > 0) parts.push(`M${c.modified.length}`);
	if (c.removed.length > 0) parts.push(`-${c.removed.length}`);
	return parts.length > 0 ? `${parts.join(" ")} change(s)` : "changes";
}

function writePorcelain(dir: "i" | "o", c: ChangeSet): void {
	for (const n of c.added) process.stdout.write(`${dir}A ${n}\n`);
	for (const n of c.modified) process.stdout.write(`${dir}M ${n}\n`);
	for (const n of c.removed) process.stdout.write(`${dir}D ${n}\n`);
}
