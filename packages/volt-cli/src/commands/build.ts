import type { Remote } from "../bridge/types.js"
import { loadState } from "../snapshot/repo.js"
import { workspacePaths } from "../config/workspace.js"

export type BuildInput = { full?: boolean }

export async function build(workspace: string, bridge: Remote, input: BuildInput): Promise<void> {
	const paths = workspacePaths(workspace)
	const state = loadState(paths.snapshotPath)
	if (!state) throw new Error("Workspace not initialized — run 'volt init' first")

	const result = await bridge.build({ buildType: input.full ? "full" : "incremental" })
	console.log(`Build ${result.success ? "succeeded" : "FAILED"} (${result.duration}ms)`)
	for (const d of result.diagnostics) {
		console.log(`  [${d.severity}] ${d.object ?? "(project)"}: ${d.message}`)
	}
	if (!result.success) process.exitCode = 2
}
