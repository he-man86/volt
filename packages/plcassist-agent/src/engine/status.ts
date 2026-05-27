/**
 * `plc status` — answer the three questions that matter before
 * running `pull` or `push`:
 *
 *   1. Has the IDE changed since our last pull? (which items?)
 *   2. Has the workspace changed since our last pull? (which files?)
 *   3. What should the user / AI do next?
 *
 * Cheap (single /refs + a tree hash of the workspace, no per-file
 * bridge round-trips), so safe to run as often as the user wants.
 *
 * Vocabulary note: `incoming` / `outgoing` are the standard pair from
 * Mercurial (`hg incoming` / `hg outgoing`) and map directly to git's
 * `@{u}..HEAD` (outgoing) and `HEAD..@{u}` (incoming) ranges. We use
 * them as field names so anyone familiar with VCS workflows can read
 * the shape without translating PLC-specific jargon.
 */
import { resolve } from "node:path";
import { BridgeClient } from "../bridge/client.js";
import { configExists, loadConfig, workspacePaths } from "./config.js";
import { listActiveLeases, type Capability } from "./lease.js";
import { workspaceMatchesBridge } from "./ops.js";
import {
	computeIncoming,
	computeOutgoing,
	detectWorkspaceDirty,
	ensureSnapshotRepo,
	hasChanges,
	loadState,
	type ChangeSet,
} from "./snapshot.js";

/**
 * Active capability lease as surfaced in `StatusResult`. Lets the AI
 * see which elevated parameters it can use right now without having
 * to try-and-fail. Maps 1:1 to a file in `.plcassist/auth/`.
 */
export interface CapabilityGrant {
	capability: Capability;
	expiresAt: string;
	expiresInSeconds: number;
	oneShot: boolean;
}

/**
 * Recommendation for the consumer's next action. Computed from the
 * (ideDrifted, workspaceDirty, initialized) triple:
 *
 *   not initialized    → "init"
 *   clean both sides   → null  (nothing to do)
 *   IDE only           → "pull"
 *   workspace only     → "push"
 *   both               → "reconcile"  (run pull to merge, then push)
 */
export type NextAction = "init" | "pull" | "push" | "reconcile" | null;

export interface StatusResult {
	/** True if we have a snapshot at all (false on fresh `plc init`). */
	initialized: boolean;
	/** Bridge says: have the IDE's items changed since our last import? */
	ideDrifted: boolean;
	/** Workspace files differ from the last imported snapshot? */
	workspaceDirty: boolean;
	/**
	 * What `plc pull` would bring INTO the workspace from the bridge
	 * (= `hg incoming` / git's `HEAD..@{u}`). Engineer-side changes
	 * since our last pull: which POUs they added / removed / modified.
	 */
	incoming: ChangeSet;
	/** Paths the user/AI added/edited/deleted in the workspace vs the snapshot. */
	dirtyPaths: string[];
	/**
	 * What `plc push` would send TO the bridge from the workspace
	 * (= `hg outgoing` / git's `@{u}..HEAD`). Same shape as `incoming`
	 * — so consumers can render both directions identically and AI
	 * callers can preview both before running either verb.
	 */
	outgoing: ChangeSet;
	/**
	 * Set only when `ideDrifted` is true. True means the workspace
	 * already matches what the bridge has — drift is "self-caused"
	 * (most likely a previous `plc push` succeeded on the bridge but
	 * died before the snapshot receipt was saved). Running `plc pull`
	 * in this case is a content no-op; it just refreshes the snapshot.
	 *
	 * Costs one /fetch round-trip, so only computed when drift is
	 * present.
	 */
	driftLikelySelfCaused: boolean;
	/** Bridge's current projectVersion (informational). */
	bridgeProjectVersion: string;
	/** Snapshot's recorded projectVersion (informational). */
	snapshotProjectVersion: string | undefined;
	/** Suggested next verb, or null if nothing's needed. */
	nextAction: NextAction;
	/** One-line human-readable summary suitable for direct display. */
	summary: string;
	/**
	 * Currently-active capability leases the human has granted via
	 * `plc grant`. AI clients check this BEFORE calling elevated
	 * parameters (e.g. `plc_push({ force: true })`) so they can
	 * tell the human "I can do that now" vs "you need to grant me
	 * the capability first" without trial-and-error round trips.
	 * Empty when no capability is granted.
	 */
	availableCapabilities: CapabilityGrant[];
}

export async function runStatus(
	workspaceRoot: string,
	bridge: BridgeClient,
): Promise<StatusResult> {
	const root = resolve(workspaceRoot);
	const paths = workspacePaths(root);

	// Status must never throw on a missing workspace — it's a query,
	// not a mutation. Return initialized:false so the caller (CLI / AI)
	// can decide whether to run plc_init or bail.
	const hasConfig = configExists(root);
	if (hasConfig) loadConfig(root); // throws only on malformed config

	const refs = await bridge.getRefs();

	if (!hasConfig) {
		return {
			initialized: false,
			ideDrifted: false,
			workspaceDirty: false,
			incoming: { added: [], removed: [], modified: [] },
			dirtyPaths: [],
			outgoing: { added: [], removed: [], modified: [] },
			driftLikelySelfCaused: false,
			bridgeProjectVersion: refs.projectVersion,
			snapshotProjectVersion: undefined,
			nextAction: "init",
			summary: "Workspace not initialized — run plc init to bind it to the IDE project.",
			availableCapabilities: [],
		};
	}

	ensureSnapshotRepo(paths.snapshotPath);
	const state = loadState(paths.snapshotPath);
	if (state === undefined) {
		return {
			initialized: false,
			ideDrifted: false,
			workspaceDirty: false,
			incoming: { added: [], removed: [], modified: [] },
			dirtyPaths: [],
			outgoing: { added: [], removed: [], modified: [] },
			driftLikelySelfCaused: false,
			bridgeProjectVersion: refs.projectVersion,
			snapshotProjectVersion: undefined,
			nextAction: "pull",
			summary: "Workspace bound but never pulled — run plc pull to populate.",
			availableCapabilities: collectCapabilities(root),
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
	const driftLikelySelfCaused = ideDrifted
		? await workspaceMatchesBridge(root, bridge)
		: false;

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
		availableCapabilities: collectCapabilities(root),
	};
}

function collectCapabilities(workspaceRoot: string): CapabilityGrant[] {
	const leases = listActiveLeases(workspaceRoot);
	const now = Date.now();
	return leases.map((l) => ({
		capability: l.capability,
		expiresAt: l.expiresAt,
		expiresInSeconds: Math.max(0, Math.round((Date.parse(l.expiresAt) - now) / 1000)),
		oneShot: l.oneShot,
	}));
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
					`probably a previous plc push landed without saving its receipt. ` +
					`Run plc pull to refresh the snapshot (content no-op).`,
			};
		}
		return {
			nextAction: "pull",
			summary: `IDE has ${formatCounts(incoming)} — run plc pull.`,
		};
	}
	if (!ideDrifted && workspaceDirty) {
		return {
			nextAction: "push",
			summary: `Workspace has ${dirtyCount} change(s) — run plc push.`,
		};
	}
	return {
		nextAction: "reconcile",
		summary:
			`Both sides changed: IDE has ${formatCounts(incoming)}, workspace has ${dirtyCount} change(s). ` +
			`Run plc pull first to absorb IDE changes (use --force if you want to drop your workspace edits), ` +
			`then plc push.`,
	};
}

function formatCounts(c: ChangeSet): string {
	const parts: string[] = [];
	if (c.added.length > 0) parts.push(`+${c.added.length}`);
	if (c.modified.length > 0) parts.push(`M${c.modified.length}`);
	if (c.removed.length > 0) parts.push(`-${c.removed.length}`);
	return parts.length > 0 ? `${parts.join(" ")} change(s)` : "changes";
}
