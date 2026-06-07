/**
 * Post-state shape published by `volt pull` / `volt push` for the VS
 * Code extension to apply directly (skipping a redundant `volt status
 * --json` round-trip).
 *
 * Shape mirrors what `volt status --json` produces — the extension uses
 * the same parser path either way. When a verb mutates the workspace,
 * it already walked /refs to know what to do, so it knows the post-
 * mutation status without a second walk. Publishing it inline (via the
 * `--json` output mode's `complete` event) means the extension can
 * update its tree instantly when the verb returns.
 *
 * This file is the ONE place that constructs the synced-post-state
 * payload — pull.ts and push.ts both call buildSyncedPostState so a
 * future field addition is a single edit.
 */

import type { BindingMismatch } from "../engine/binding.js";
import type { ConflictEntry } from "../engine/merge.js";
import type { ChangeSet } from "../engine/snapshot.js";

/**
 * Wire shape consumed by the VS Code extension's
 * `VoltWorkspace.applyStatus()`. Field-for-field equivalent to the
 * `out` payload built in `cli/status.ts`'s `--json` branch — adding a
 * field here means status.ts must also emit it, and vice versa.
 */
export interface PostState {
	initialized: boolean;
	merging: { projectVersion: string; conflicts: ConflictEntry[] } | null;
	incoming: ChangeSet;
	outgoing: ChangeSet;
	pathByName: Record<string, string>;
	snapshotProjectVersion: string | null;
	bridgeProjectVersion: string;
	ideDrifted: boolean;
	workspaceDirty: boolean;
	driftLikelySelfCaused: boolean;
	nextAction: "init" | "pull" | "push" | "reconcile" | "merge-continue" | null;
	summary: string;
	projectMismatch: BindingMismatch | null;
}

/**
 * Build the post-state for a clean pull/push success — workspace and
 * bridge are byte-for-byte in sync, no pending changes either way, no
 * merge in flight, no project-binding mismatch (verb would have refused).
 *
 * Inputs: just the post-mutation `projectVersion`. Everything else is
 * derivable from "we just synced cleanly."
 */
export function buildSyncedPostState(projectVersion: string): PostState {
	const empty: ChangeSet = { added: [], modified: [], removed: [], moved: [] };
	return {
		initialized: true,
		merging: null,
		incoming: empty,
		outgoing: empty,
		pathByName: {},
		snapshotProjectVersion: projectVersion,
		bridgeProjectVersion: projectVersion,
		ideDrifted: false,
		workspaceDirty: false,
		driftLikelySelfCaused: false,
		nextAction: null,
		summary: "Workspace synced with IDE.",
		projectMismatch: null,
	};
}

/**
 * Emit the `complete` event to stdout on the `--json` output path.
 *
 * The VS Code extension's NDJSON parser reads stdout line-by-line and
 * acts on the `{"event":"complete",...}` line:
 *   - `summary` always present → drives the success toast text.
 *   - `status` present (clean, no-conflict, no-skipped success) → applied
 *     directly to `VoltWorkspace`, skipping the slow `volt status --json`
 *     walk.
 *   - `status` absent (skipped items, partial success) → extension
 *     falls back to a status walk to discover the remaining incoming
 *     items, but still uses `summary` for the toast.
 *
 * Errors don't come through here — they exit non-zero and the VS Code
 * runner surfaces them via stderr + an error toast.
 */
export function emitCompleteEvent(args: { status?: PostState; summary: string }): void {
	const event: Record<string, unknown> = { event: "complete", summary: args.summary };
	if (args.status !== undefined) event.status = args.status;
	process.stdout.write(`${JSON.stringify(event)}\n`);
}
