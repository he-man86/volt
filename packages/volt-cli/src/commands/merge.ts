import { resolve } from "node:path"
import type { Remote } from "../bridge/types.js"
import { isMergingNow, continueMerge, abortMerge, resolveConflict } from "../merge/engine.js"
import { loadState } from "../snapshot/repo.js"
import { workspacePaths } from "../config/workspace.js"

type MergeInput = { continue?: boolean; abort?: boolean; resolve?: string; useOurs?: boolean; useTheirs?: boolean }

export async function merge(workspace: string, _bridge: Remote, input: MergeInput): Promise<void> {
	const root = resolve(workspace)
	const paths = workspacePaths(root)
	const state = loadState(paths.snapshotPath)
	if (!state) throw new Error("Workspace not initialized — run 'volt init' first")

	if (input.continue) {
		if (isMergingNow(paths.snapshotPath) === undefined) throw new Error("No merge in progress")
		continueMerge(paths.snapshotPath, root)
		console.log("Merge continued.")
	} else if (input.abort) {
		if (isMergingNow(paths.snapshotPath) === undefined) throw new Error("No merge in progress")
		abortMerge(paths.snapshotPath, root)
		console.log("Merge aborted.")
	} else if (input.resolve) {
		if (isMergingNow(paths.snapshotPath) === undefined) throw new Error("No merge in progress")
		const side = input.useOurs ? "ours" as const : input.useTheirs ? "theirs" as const : undefined
		resolveConflict(paths.snapshotPath, root, input.resolve, side)
		console.log(`Resolved: ${input.resolve}`)
	} else {
		throw new Error("merge requires --continue, --abort, or --resolve <path>")
	}
}
