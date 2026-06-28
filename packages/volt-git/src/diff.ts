/**
 * volt-git diff — the OUTGOING changes (working tree vs the IDE baseline `refs/remotes/volt/ide`) as a
 * per-file unified-diff list. This is what a `push` would send to the IDE; the desktop "IDE" changes
 * source renders it through the same review pipeline as git/branch/turn diffs.
 */
import { resolve } from "node:path";
import { outgoingDiffs, type FileDiff } from "./git/plumbing.js";

const VOLT_IDE = "refs/remotes/volt/ide";

export type DiffResult = { kind: "ok"; diffs: FileDiff[] } | { kind: "error"; reason: string };

export function diff(workspace: string): DiffResult {
	const root = resolve(workspace);
	try {
		return { kind: "ok", diffs: outgoingDiffs(root, VOLT_IDE, "src") };
	} catch (err) {
		// Not bound yet (no volt/ide ref) or git error → no outgoing diff.
		return { kind: "error", reason: err instanceof Error ? err.message : String(err) };
	}
}
