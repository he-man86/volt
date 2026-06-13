import { resolve } from "node:path"
import type { Remote } from "../bridge/types.js"
import { bindingMismatchMessage, verifyProjectBinding } from "../config/binding.js"
import { loadConfig, workspacePaths } from "../config/workspace.js"
import {
	createMergeCommit,
	listTree,
	readBlobsBytes,
	resolveRef,
	updateRef,
} from "../git/plumbing.js"
import {
	applyMerge,
	isMergingNow,
	planMerge,
} from "../merge/engine.js"
import { syncFromBridge } from "../merge/ops.js"
import { isTrackedPath } from "../registry/extensions.js"
import {
	buildWorkspaceTreeSha,
	detectWorkspaceDirty,
	ensureGitignore,
	listWorkspaceFiles,
	removeFilesFromWorkspace,
	sweepEmptyDirs,
	writeTreeToWorkspace,
} from "../snapshot/workspace.js"
import {
	computeIncoming,
	hasChanges,
} from "../snapshot/state.js"
import {
	ensureSnapshotRepo,
	loadState,
	reportSnapshotHeal,
	saveState,
} from "../snapshot/repo.js"

type PullInput = { force?: boolean; noMerge?: boolean; dryRun?: boolean; json?: boolean }
type PullResult = { kind: "ok"; synced: string[] } | { kind: "refused"; reason: string } | { kind: "conflict"; paths: string[] }

export type { PullInput, PullResult }

export async function pull(workspace: string, bridge: Remote, input: PullInput): Promise<PullResult> {
	const force = input.force ?? false
	const dryRun = input.dryRun ?? false
	const noMerge = input.noMerge ?? false
	const jsonMode = input.json ?? false
	const out = (msg: string): void => {
		if (!jsonMode) console.log(msg)
	}

	const root = resolve(workspace)
	const paths = workspacePaths(root)
	const cfg = loadConfig(root)
	const heal = ensureSnapshotRepo(paths.snapshotPath)
	reportSnapshotHeal(heal)
	ensureGitignore(root)

	if (isMergingNow(paths.snapshotPath) !== undefined) {
		return {
			kind: "refused",
			reason: "pull refused — merge in progress: a 3-way merge from a previous pull hasn't been finalized yet. hint: resolve any conflict markers, then run `volt merge --continue` — or `volt merge --abort` to back out",
		}
	}

	const health = await bridge.getHealth()
	const binding = verifyProjectBinding(cfg, health)
	if (!binding.ok) {
		return {
			kind: "refused",
			reason: `pull refused — project-binding mismatch: ${bindingMismatchMessage(binding.mismatch)}`,
		}
	}

	const prePaths = new Set(listWorkspaceFiles(root).map((f) => f.path))
	const preState = loadState(paths.snapshotPath)

	let dirty: string[] = []
	if (preState !== null && !force) {
		dirty = detectWorkspaceDirty(paths.snapshotPath, root, preState.commitSha)
	}
	if (dirty.length > 0 && !force) {
		const refs = await bridge.getRefs()
		const incoming = computeIncoming(refs.items, preState?.items ?? {})
		const bridgeChanged = preState !== null && hasChanges(incoming)

		if (!bridgeChanged) {
			// dirty but bridge unchanged — fall through to refuse below.
		} else if (noMerge) {
			const lines = dirty.map((p) => `  - ${p}`)
			return {
				kind: "refused",
				reason: `pull refused — ${dirty.length} workspace edit(s) would be overwritten: the IDE has changes too, but --no-merge was set; the following files differ from the snapshot:\n${lines.join("\n")}\nhint: send them first with \`volt push\`, discard with \`volt pull --force\`, or omit --no-merge to 3-way merge`,
			}
		} else if (dryRun) {
			out(`would 3-way merge ${dirty.length} workspace edit(s) with incoming IDE changes:`)
			for (const n of incoming.added) out(`  [IDE] + ${n}`)
			for (const n of incoming.modified) out(`  [IDE] M ${n}`)
			for (const n of incoming.removed) out(`  [IDE] - ${n}`)
			out("dry-run — workspace and snapshot were NOT touched.")
			return { kind: "ok", synced: [] }
		} else {
			const plan = await planMerge(paths.snapshotPath, root, bridge)
			const mergeState = applyMerge(paths.snapshotPath, root, plan)
			if (mergeState === undefined) {
				const head = resolveRef(paths.snapshotPath, "refs/heads/main")
				if (head === undefined) {
					return {
						kind: "refused",
						reason: "merge finalize failed: refs/heads/main is missing after a clean auto-merge — snapshot was modified concurrently or is corrupt. hint: delete .volt/snapshot/ and run `volt pull --force` to rebuild from the bridge",
					}
				}
				const treeSha = buildWorkspaceTreeSha(root, paths.snapshotPath)
				const commit = createMergeCommit(
					paths.snapshotPath,
					treeSha,
					[head, plan.theirsCommitSha],
					`Merge IDE@${plan.targetProjectVersion} into workspace (clean auto-merge)\n`,
				)
				updateRef(paths.snapshotPath, "refs/heads/main", commit)
				saveState(paths.snapshotPath, {
					projectVersion: plan.targetProjectVersion,
					commitSha: commit,
					items: plan.targetState.items,
					folders: plan.targetState.folders,
				})
				out(`merged ${plan.auto.length} file(s) cleanly; workspace now reflects IDE@${plan.targetProjectVersion}.`)
				return { kind: "ok", synced: plan.auto.map((e) => e.path) }
			}
			return {
				kind: "conflict",
				paths: mergeState.conflicts.map((c) => c.path),
			}
		}
	}

	if (dirty.length > 0 && !force) {
		const lines = dirty.map((p) => `  - ${p}`)
		return {
			kind: "refused",
			reason: `pull refused — ${dirty.length} workspace edit(s) would be overwritten: the following files differ from the snapshot:\n${lines.join("\n")}\nhint: send them first with \`volt push\`, drop them with \`volt pull --force\`, or \`volt pull --no-merge\` to refuse on dirty`,
		}
	}

	if (dryRun) {
		const refs = await bridge.getRefs()
		const incoming = computeIncoming(refs.items, preState?.items ?? {})
		const upToDate =
			preState !== null &&
			preState.projectVersion === refs.projectVersion &&
			!hasChanges(incoming)
		const incCount = incoming.added.length + incoming.modified.length + incoming.removed.length
		if (upToDate || incCount === 0) {
			out("dry-run — already up to date, nothing to pull.")
		} else {
			out("would pull from bridge (dry-run):")
			for (const n of incoming.added) out(`  [IDE] + ${n}  (engineer created)`)
			for (const n of incoming.modified) out(`  [IDE] M ${n}  (engineer edited)`)
			for (const n of incoming.removed) out(`  [IDE] - ${n}  (engineer deleted)`)
			out("dry-run — workspace and snapshot were NOT touched.")
		}
		return { kind: "ok", synced: [] }
	}

	if (!jsonMode) process.stderr.write("  → querying bridge state...\n")
	let syncResult
	try {
		syncResult = await syncFromBridge(paths.snapshotPath, bridge, { fullRebuild: force })
	} catch (err) {
		return {
			kind: "refused",
			reason: `pull from bridge failed: ${err instanceof Error ? err.message : String(err)}`,
		}
	}
	const stateAfter = loadState(paths.snapshotPath)
	if (stateAfter === null) {
		return {
			kind: "refused",
			reason: "snapshot state missing after pull: syncFromBridge completed but no state.json was written — bridge may have returned an empty refs list. hint: verify the bridge has a project open (volt status), then retry",
		}
	}

	const newEntries = listTree(paths.snapshotPath, stateAfter.commitSha)
	const newPaths = new Set(newEntries.map((e) => e.path))
	if (!jsonMode) process.stderr.write(`  → writing ${newEntries.length} file(s) to workspace...\n`)
	// Read every blob back in one batched cat-file spawn (not one per file).
	const newContents = readBlobsBytes(paths.snapshotPath, newEntries.map((e) => e.sha))
	writeTreeToWorkspace(
		root,
		newEntries.map((e, i) => ({ path: e.path, content: newContents[i]! })),
	)

	const removed: string[] = []
	for (const p of prePaths) {
		if (newPaths.has(p)) continue
		if (isTrackedPath(p)) removed.push(p)
	}
	removeFilesFromWorkspace(root, removed)

	const removedDirs = sweepEmptyDirs(root)

	const upToDate =
		preState !== null && preState.projectVersion === stateAfter.projectVersion
	let summary: string
	if (upToDate && newPaths.size > 0 && removed.length === 0 && removedDirs.length === 0) {
		summary = "already up to date."
	} else {
		const byExt: Record<string, number> = {}
		for (const p of newPaths) {
			const dot = p.lastIndexOf(".")
			const ext = dot >= 0 ? p.slice(dot + 1) : "(no-ext)"
			byExt[ext] = (byExt[ext] ?? 0) + 1
		}
		const breakdown = Object.entries(byExt)
			.sort((a, b) => b[1] - a[1])
			.map(([ext, count]) => `${count} ${ext}`)
			.join(", ")
		const dirSuffix = removedDirs.length > 0
			? `, swept ${removedDirs.length} empty dir(s): ${removedDirs.join(", ")}`
			: ""
		const headline = `pulled: ${newPaths.size} file(s), removed: ${removed.length} file(s)${dirSuffix}.`
		summary = breakdown.length > 0 ? `${headline} (${breakdown})` : headline
	}
	out(summary)

	if (syncResult.skipped.length > 0) {
		out(`\n! skipped ${syncResult.skipped.length} item(s) the bridge sent but Volt couldn't materialize:`)
		for (const s of syncResult.skipped) {
			out(`  - ${s.name}: ${s.reason}`)
		}
		out("  fix the bridge-side cause for each (re-export the POU in the IDE, or report the case), then re-run `volt pull`.")
	}

	return { kind: "ok", synced: [...newPaths] }
}
