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
import { workspaceMatchesBridge } from "../engine/ops.js";
import {
	computeIncoming,
	computeOutgoing,
	detectWorkspaceDirty,
	ensureSnapshotRepo,
	hasChanges,
	loadState,
	type ChangeSet,
} from "../engine/snapshot.js";
import { flagBool, type VerbFn } from "./_shared.js";

type NextAction = "init" | "pull" | "push" | "reconcile" | null;

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
}

export const status: VerbFn = async ({ workspace, bridge, flags }) => {
	const r = await computeStatus(workspace, bridge);

	if (flagBool(flags, "porcelain")) {
		// Pre-init / pre-bind: empty stdout is the correct porcelain
		// answer. Print a sentinel to stderr for interactive humans.
		if (!r.initialized) {
			process.stderr.write(`# ${r.summary}\n`);
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

	ensureSnapshotRepo(paths.snapshotPath);
	const state = loadState(paths.snapshotPath);
	if (state === undefined) {
		return emptyStatus(refs.projectVersion, "pull", "Workspace bound but never pulled — run volt pull to populate.");
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
	};
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
