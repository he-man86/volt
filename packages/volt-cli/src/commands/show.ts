import { resolve } from "node:path"
import type { Remote } from "../bridge/types.js"
import { loadState } from "../snapshot/repo.js"
import { readBlob, resolveRef, lookupBlobInCommit } from "../git/plumbing.js"
import { workspacePaths } from "../config/workspace.js"
import { nameFromPath } from "../registry/extensions.js"

export async function show(workspace: string, bridge: Remote, ref: string, path: string): Promise<void> {
	const root = resolve(workspace)
	const paths = workspacePaths(root)
	const state = loadState(paths.snapshotPath)
	if (!state) throw new Error("Workspace not initialized — run 'volt init' first")

	// The snapshot tree is rooted at the workspace's src/, so its paths are
	// src-relative ("POUs/Foo.st"). Tolerate callers that pass the src/-prefixed
	// workspace path ("src/POUs/Foo.st") — the SCM/diff views do — so neither form fails.
	const treePath = path.startsWith("src/") ? path.slice(4) : path

	// BRIDGE = the item's CURRENT content live from the IDE (what a pull would bring).
	// Lets the editor diff workspace/HEAD ↔ the live IDE without pulling.
	if (ref === "BRIDGE") {
		const name = nameFromPath(treePath)
		if (name === undefined) { console.error(`cannot derive item name from path: ${path}`); process.exitCode = 2; return }
		const fetched = await bridge.fetchChanges({ knownItems: {}, onlyItems: [name] })
		const item = fetched.changed.find((i) => i.name === name)
		if (item === undefined) { console.error(`item not found on bridge: ${name}`); process.exitCode = 2; return }
		process.stdout.write(item.sourceText ?? "")
		return
	}

	const resolved = ref === "HEAD" ? state.commitSha : resolveRef(paths.snapshotPath, ref)
	if (!resolved) {
		console.error(`ref not found: ${ref}`)
		process.exitCode = 1
		return
	}

	const blob = lookupBlobInCommit(paths.snapshotPath, resolved, treePath)
	if (!blob) {
		console.error(`path not found in commit ${resolved.slice(0, 8)}: ${treePath}`)
		process.exitCode = 2
		return
	}

	const content = readBlob(paths.snapshotPath, blob)
	process.stdout.write(content)
}
