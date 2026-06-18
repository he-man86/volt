import { resolve } from "node:path"
import type { BindingMismatch } from "../config/binding.js"
import { verifyProjectBinding } from "../config/binding.js"
import { configExists, loadConfig, workspacePaths } from "../config/workspace.js"
import type { ConflictEntry } from "../merge/engine.js"
import { isMergingNow } from "../merge/engine.js"
import { workspaceMatchesBridge } from "../merge/ops.js"
import { nameFromPath as nameFromPouPath } from "../registry/extensions.js"
import {
	computeIncoming,
	computeOutgoing,
	hasChanges,
	type ChangeSet,
} from "../snapshot/state.js"
import {
	detectWorkspaceDirty,
	listWorkspaceFiles,
	WORKSPACE_SRC_DIR,
} from "../snapshot/workspace.js"
import {
	ensureSnapshotRepo,
	loadState,
	reportSnapshotHeal,
} from "../snapshot/repo.js"
import { listTree } from "../git/plumbing.js"
import { renderPorcelainStatus } from "../output/fmt.js"
import type { Remote } from "../bridge/types.js"

type StatusInput = { json?: boolean; porcelain?: boolean }
type NextAction = "init" | "pull" | "push" | "reconcile" | "merge-continue" | null

interface StatusResult {
	initialized: boolean
	ideDrifted: boolean
	workspaceDirty: boolean
	incoming: ChangeSet
	dirtyPaths: string[]
	outgoing: ChangeSet
	driftLikelySelfCaused: boolean
	bridgeProjectVersion: string
	snapshotProjectVersion: string | undefined
	nextAction: NextAction
	summary: string
	merging: { projectVersion: string; conflicts: ConflictEntry[] } | null
	pathByName: Record<string, string>
	projectMismatch: BindingMismatch | null
}

export type { StatusInput }

export async function status(workspace: string, bridge: Remote, input: StatusInput): Promise<void> {
	const r = await computeStatus(workspace, bridge)

	if (input.json) {
		const out = {
			initialized: r.initialized,
			merging: r.merging,
			incoming: r.incoming,
			outgoing: r.outgoing,
			pathByName: r.pathByName,
			snapshotProjectVersion: r.snapshotProjectVersion ?? null,
			bridgeProjectVersion: r.bridgeProjectVersion,
			ideDrifted: r.ideDrifted,
			workspaceDirty: r.workspaceDirty,
			driftLikelySelfCaused: r.driftLikelySelfCaused,
			nextAction: r.nextAction,
			summary: r.summary,
			projectMismatch: r.projectMismatch,
		}
		process.stdout.write(`${JSON.stringify(out)}\n`)
		return
	}

	if (input.porcelain) {
		if (!r.initialized) {
			process.stderr.write(`# ${r.summary}\n`)
			return
		}
		if (r.merging !== null) {
			process.stderr.write(`# merging from ${r.merging.projectVersion}\n`)
			for (const c of r.merging.conflicts) {
				process.stdout.write(`xU ${c.path}\n`)
			}
			return
		}
		process.stdout.write(renderPorcelainStatus(r.incoming, r.outgoing))
		if (r.incoming.added.length + r.incoming.modified.length + r.incoming.removed.length + r.outgoing.added.length + r.outgoing.modified.length + r.outgoing.removed.length > 0) {
			process.stdout.write("\n")
		}
		return
	}

	if (!r.initialized) {
		console.log(r.summary)
		console.log(`bridge projectVersion: ${r.bridgeProjectVersion}`)
		return
	}

	console.log(r.summary)
	console.log("")

	if (r.merging !== null) {
		console.log("Unmerged paths:")
		console.log(`  (use "volt merge --continue" to record the result)`)
		console.log(`  (use "volt merge --abort" to undo the merge)`)
		console.log("")
		for (const c of r.merging.conflicts) {
			const tag =
				c.reason === "both-modified"
					? "both modified"
					: c.reason === "delete-modify"
						? "deleted by us"
						: c.reason === "modify-delete"
							? "deleted by them"
							: "both added"
			const kindTag = c.kind === "graphical" ? " (graphical)" : ""
			console.log(`  ${tag}:${" ".repeat(Math.max(1, 14 - tag.length))}${c.path}${kindTag}`)
		}
		console.log("")
		console.log(`merge target projectVersion: ${r.merging.projectVersion}`)
		return
	}

	if (hasChanges(r.incoming)) {
		console.log("incoming — would land in workspace on volt pull:")
		for (const name of r.incoming.added) console.log(`  [IDE] + ${name}  (engineer created)`)
		for (const name of r.incoming.modified) console.log(`  [IDE] M ${name}  (engineer edited)`)
		for (const name of r.incoming.removed) console.log(`  [IDE] - ${name}  (engineer deleted)`)
	}
	if (r.workspaceDirty) {
		if (hasChanges(r.incoming)) console.log("")
		console.log("outgoing — would be sent to bridge on volt push:")
		for (const name of r.outgoing.added) console.log(`  [WS]  + ${name}  (you created)`)
		for (const name of r.outgoing.modified) console.log(`  [WS]  M ${name}  (you edited)`)
		for (const m of r.outgoing.moved) console.log(`  [WS]  → ${m.name}  (you moved ${m.from || "(root)"} → ${m.to || "(root)"})`)
		for (const name of r.outgoing.removed) console.log(`  [WS]  - ${name}  (you deleted)`)
	}

	console.log("")
	console.log(`snapshot projectVersion: ${r.snapshotProjectVersion ?? "<none>"}`)
	console.log(`bridge   projectVersion: ${r.bridgeProjectVersion}`)
}

async function computeStatus(workspaceRoot: string, bridge: Remote): Promise<StatusResult> {
	const root = resolve(workspaceRoot)
	const paths = workspacePaths(root)

	const hasConfig = configExists(root)
	const cfg = hasConfig ? loadConfig(root) : undefined

	const refs = await bridge.getRefs()

	if (!hasConfig || cfg === undefined) {
		return emptyStatus(refs.projectVersion, "init", "Workspace not initialized — run volt init to bind it to the IDE project.")
	}

	const health = await bridge.getHealth()
	const bindingCheck = verifyProjectBinding(cfg, health)
	const projectMismatch = bindingCheck.ok ? null : bindingCheck.mismatch

	reportSnapshotHeal(ensureSnapshotRepo(paths.snapshotPath))
	const state = loadState(paths.snapshotPath)

	if (state === null) {
		const incoming = computeIncoming(refs.items, {})
		const pathByName = computePathByName(
			paths.snapshotPath,
			undefined,
			refs.folders,
			refs.items,
			incoming,
			{ added: [], removed: [], modified: [], moved: [] },
		)
		const summary = hasChanges(incoming)
			? `IDE has ${formatCounts(incoming)} — run volt pull to populate the workspace.`
			: "Workspace bound — IDE project is empty. Nothing to pull."
		return {
			initialized: true,
			ideDrifted: hasChanges(incoming),
			workspaceDirty: false,
			incoming,
			dirtyPaths: [],
			outgoing: { added: [], removed: [], modified: [], moved: [] },
			driftLikelySelfCaused: false,
			bridgeProjectVersion: refs.projectVersion,
			snapshotProjectVersion: undefined,
			nextAction: "pull",
			summary,
			merging: null,
			pathByName,
			projectMismatch,
		}
	}

	const mergeState = isMergingNow(paths.snapshotPath)
	if (mergeState !== undefined) {
		const mergePathByName: Record<string, string> = {}
		for (const c of mergeState.conflicts) {
			const name = nameFromPouPath(c.path)
			if (name !== undefined) mergePathByName[name] = `${WORKSPACE_SRC_DIR}/${c.path}`
		}
		return {
			initialized: true,
			ideDrifted: false,
			workspaceDirty: true,
			incoming: { added: [], removed: [], modified: [], moved: [] },
			dirtyPaths: [],
			outgoing: { added: [], removed: [], modified: [], moved: [] },
			driftLikelySelfCaused: false,
			bridgeProjectVersion: refs.projectVersion,
			snapshotProjectVersion: state.projectVersion,
			nextAction: "merge-continue",
			summary: `merging IDE@${mergeState.projectVersion} into workspace — ${mergeState.conflicts.length} conflict(s) to resolve, then run \`volt merge --continue\`.`,
			merging: {
				projectVersion: mergeState.projectVersion,
				conflicts: mergeState.conflicts,
			},
			pathByName: mergePathByName,
			projectMismatch,
		}
	}

	const incoming = computeIncoming(refs.items, state.items)
	const ideDrifted = hasChanges(incoming) || refs.projectVersion !== state.projectVersion
	const dirtyPaths = detectWorkspaceDirty(paths.snapshotPath, root, state.commitSha)
	const workspaceDirty = dirtyPaths.length > 0
	const outgoing = workspaceDirty
		? computeOutgoing(paths.snapshotPath, root, state.commitSha)
		: { added: [], removed: [], modified: [], moved: [] }

	let driftLikelySelfCaused = false
	if (ideDrifted) {
		try {
			driftLikelySelfCaused = await workspaceMatchesBridge(root, bridge)
		} catch {
			driftLikelySelfCaused = false
		}
	}

	const { nextAction, summary } = recommend(
		ideDrifted,
		workspaceDirty,
		incoming,
		dirtyPaths.length,
		driftLikelySelfCaused,
	)

	const pathByName = computePathByName(
		paths.snapshotPath,
		state.commitSha,
		{ ...(state.folders ?? {}), ...refs.folders },
		refs.items,
		incoming,
		outgoing,
	)

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
		merging: null,
		pathByName,
		projectMismatch,
	}
}

function computePathByName(
	snapshotPath: string,
	commitSha: string | undefined,
	folders: Record<string, string>,
	bridgeItems: Record<string, string>,
	incoming: ChangeSet,
	outgoing: ChangeSet,
): Record<string, string> {
	const out: Record<string, string> = {}
	if (commitSha !== undefined) {
		for (const entry of listTree(snapshotPath, commitSha)) {
			const name = nameFromPouPath(entry.path)
			if (name !== undefined) out[name] = `${WORKSPACE_SRC_DIR}/${entry.path}`
		}
	}
	const allNames = new Set<string>([
		...incoming.added, ...incoming.modified, ...incoming.removed,
		...outgoing.added, ...outgoing.modified, ...outgoing.removed,
	])
	for (const name of allNames) {
		if (out[name] !== undefined) continue
		// Name already includes extension from the bridge (e.g. "PLC_PRG.st")
		const folder = folders[name] ?? "POUs"
		const vendorRel = folder.length > 0 ? `${folder}/${name}` : name
		out[name] = `${WORKSPACE_SRC_DIR}/${vendorRel}`
	}
	return out
}

function emptyStatus(bridgeProjectVersion: string, nextAction: NextAction, summary: string): StatusResult {
	return {
		initialized: false,
		ideDrifted: false,
		workspaceDirty: false,
		incoming: { added: [], removed: [], modified: [], moved: [] },
		dirtyPaths: [],
		outgoing: { added: [], removed: [], modified: [], moved: [] },
		driftLikelySelfCaused: false,
		bridgeProjectVersion,
		snapshotProjectVersion: undefined,
		nextAction,
		summary,
		merging: null,
		pathByName: {},
		projectMismatch: null,
	}
}

function recommend(
	ideDrifted: boolean,
	workspaceDirty: boolean,
	incoming: ChangeSet,
	dirtyCount: number,
	driftLikelySelfCaused: boolean,
): { nextAction: NextAction; summary: string } {
	if (!ideDrifted && !workspaceDirty) {
		return { nextAction: null, summary: "All in sync — nothing to do." }
	}
	if (ideDrifted && !workspaceDirty) {
		if (driftLikelySelfCaused) {
			return {
				nextAction: "pull",
				summary:
					`IDE reports ${formatCounts(incoming)} but workspace already matches — ` +
					`probably a previous volt push landed without saving its receipt. ` +
					`Run volt pull to refresh the snapshot (content no-op).`,
			}
		}
		return {
			nextAction: "pull",
			summary: `IDE has ${formatCounts(incoming)} — run volt pull.`,
		}
	}
	if (!ideDrifted && workspaceDirty) {
		return {
			nextAction: "push",
			summary: `Workspace has ${dirtyCount} change(s) — run volt push.`,
		}
	}
	return {
		nextAction: "reconcile",
		summary:
			`Both sides changed: IDE has ${formatCounts(incoming)}, workspace has ${dirtyCount} change(s). ` +
			`Run volt pull first to absorb IDE changes (use --force if you want to drop your workspace edits), ` +
			`then volt push.`,
	}
}

function formatCounts(c: ChangeSet): string {
	const parts: string[] = []
	if (c.added.length > 0) parts.push(`+${c.added.length}`)
	if (c.modified.length > 0) parts.push(`M${c.modified.length}`)
	if (c.removed.length > 0) parts.push(`-${c.removed.length}`)
	return parts.length > 0 ? `${parts.join(" ")} change(s)` : "changes"
}
