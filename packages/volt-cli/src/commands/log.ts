import { resolve } from "node:path"
import type { Remote } from "../bridge/types.js"
import { loadState } from "../snapshot/repo.js"
import { listLog } from "../git/plumbing.js"
import { workspacePaths } from "../config/workspace.js"

type LogInput = { limit?: number; json?: boolean }

export async function log(workspace: string, _bridge: Remote, input: LogInput): Promise<void> {
	const root = resolve(workspace)
	const paths = workspacePaths(root)
	const state = loadState(paths.snapshotPath)
	if (!state) throw new Error("Workspace not initialized — run 'volt init' first")

	const entries = listLog(paths.snapshotPath, "refs/heads/main", input.limit ?? 20)
	for (const e of entries) {
		if (input.json) {
			console.log(JSON.stringify(e))
		} else {
			const date = new Date(e.timestampSec * 1000).toISOString().split("T")[0]
			console.log(`${e.sha.slice(0, 8)} ${date} ${e.subject}`)
		}
	}
}
