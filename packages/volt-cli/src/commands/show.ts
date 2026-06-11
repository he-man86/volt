import { resolve } from "node:path"
import type { Remote } from "../bridge/types.js"
import { loadState } from "../snapshot/repo.js"
import { readBlob, resolveRef, lookupBlobInCommit } from "../git/plumbing.js"
import { workspacePaths } from "../config/workspace.js"

export async function show(workspace: string, _bridge: Remote, ref: string, path: string): Promise<void> {
	const root = resolve(workspace)
	const paths = workspacePaths(root)
	const state = loadState(paths.snapshotPath)
	if (!state) throw new Error("Workspace not initialized — run 'volt init' first")

	const resolved = ref === "HEAD" ? state.commitSha : resolveRef(paths.snapshotPath, ref)
	if (!resolved) {
		console.error(`ref not found: ${ref}`)
		process.exitCode = 1
		return
	}

	const blob = lookupBlobInCommit(paths.snapshotPath, resolved, path)
	if (!blob) {
		console.error(`path not found in commit ${resolved.slice(0, 8)}: ${path}`)
		process.exitCode = 2
		return
	}

	const content = readBlob(paths.snapshotPath, blob)
	process.stdout.write(content)
}
