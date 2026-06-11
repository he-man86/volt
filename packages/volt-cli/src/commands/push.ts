import { createHash } from "node:crypto"
import { join, resolve } from "node:path"
import type { Remote } from "../bridge/types.js"
import type { WorkspaceConfig } from "../config/workspace.js"
import { isPushable } from "../config/access.js"
import { bindingMismatchMessage, verifyProjectBinding } from "../config/binding.js"
import { loadConfig, workspacePaths } from "../config/workspace.js"
import {
	createDeterministicCommit,
	listTree,
	readBlobBytes,
	resolveRef,
	updateRef,
} from "../git/plumbing.js"
import { isMergingNow } from "../merge/engine.js"
import { applyPushToBridge, syncFromBridge } from "../merge/ops.js"
import {
	buildWorkspaceTreeSha,
	listWorkspaceFiles,
	writeTreeToWorkspace,
	WORKSPACE_SRC_DIR,
} from "../snapshot/workspace.js"
import {
	computeIncoming,
	computeOutgoing,
	hasChanges,
	type ChangeSet,
} from "../snapshot/state.js"
import {
	ensureSnapshotRepo,
	loadState,
	reportSnapshotHeal,
	saveState,
} from "../snapshot/repo.js"

type PushInput = { force?: boolean; forceWithLease?: string; dryRun?: boolean; noDriftCheck?: boolean; json?: boolean }
type PushResult = { kind: "ok"; items: string[] } | { kind: "rejected"; reason: string }

export type { PushInput, PushResult }

export async function push(workspace: string, bridge: Remote, input: PushInput): Promise<PushResult> {
	const force = input.force ?? false
	const jsonMode = input.json ?? false
	const out = (msg: string): void => {
		if (!jsonMode) console.log(msg)
	}
	const forceWithLease = input.forceWithLease
	const dryRun = input.dryRun ?? false
	const noDriftCheck = input.noDriftCheck ?? false

	const root = resolve(workspace)
	const paths = workspacePaths(root)
	const cfg = loadConfig(root)
	const heal = ensureSnapshotRepo(paths.snapshotPath)
	reportSnapshotHeal(heal)

	if (isMergingNow(paths.snapshotPath) !== undefined) {
		return {
			kind: "rejected",
			reason: "push refused — merge in progress: you have unresolved conflicts from a 3-way merge. hint: run `volt merge --continue` (after resolving markers) or `volt merge --abort` to back out",
		}
	}

	const health = await bridge.getHealth()
	const binding = verifyProjectBinding(cfg, health)
	if (!binding.ok) {
		const m = (binding as { ok: false; mismatch: import("../config/binding.js").BindingMismatch }).mismatch
		return {
			kind: "rejected",
			reason: `push refused — project-binding mismatch: ${bindingMismatchMessage(m)}`,
		}
	}

	const state = loadState(paths.snapshotPath)
	if (state === null) {
		return {
			kind: "rejected",
			reason: heal.rebuilt
				? "no snapshot to diff against: the snapshot was just rebuilt because it was corrupt; there's nothing to diff yet. hint: run `volt pull` once before `volt push`"
				: "no snapshot to diff against: this workspace has never been pulled, so there's no baseline to compute changes from. hint: run `volt pull` once before `volt push`",
		}
	}

	let stateMutable = { ...state }
	const refs = await bridge.getRefs()
	const projectVersionBumped = refs.projectVersion !== stateMutable.projectVersion
	const incoming = projectVersionBumped
		? computeIncoming(refs.items, stateMutable.items)
		: { added: [], removed: [], modified: [], moved: [] }
	const realDrift = projectVersionBumped && hasChanges(incoming)

	let driftAdoptedItems: ChangeSet | undefined

	if (realDrift && !noDriftCheck) {
		const leaseHolds =
			forceWithLease !== undefined && forceWithLease === refs.projectVersion
		if (forceWithLease !== undefined && !leaseHolds) {
			return {
				kind: "rejected",
				reason: `--force-with-lease refused: bridge has moved further than what you expected. expected: ${forceWithLease}, current: ${refs.projectVersion}. Re-run \`volt status\` to see what's new, then retry.`,
			}
		}
		if (!force && !leaseHolds) {
			const changesStr = hasChanges(incoming)
				? `\nincoming: ${incoming.added.map((n) => `+${n}`).join(", ")} ${incoming.modified.map((n) => `M${n}`).join(", ")} ${incoming.removed.map((n) => `-${n}`).join(", ")}`.trim()
				: ""
			return {
				kind: "rejected",
				reason: `drift detected: IDE has changed since last pull. local snapshot: ${stateMutable.projectVersion}, bridge current: ${refs.projectVersion}.${changesStr}\nrun \`volt pull\` to bring in IDE changes, or \`volt push --force\` to push anyway`,
			}
		}
		driftAdoptedItems = incoming
	} else if (realDrift) {
		driftAdoptedItems = incoming
	}

	if (projectVersionBumped && !dryRun) {
		saveState(paths.snapshotPath, {
			projectVersion: refs.projectVersion,
			commitSha: stateMutable.commitSha,
			items: { ...refs.items },
			folders: stateMutable.folders,
		})
		stateMutable.projectVersion = refs.projectVersion
		stateMutable.items = { ...refs.items }
	} else if (projectVersionBumped) {
		stateMutable.projectVersion = refs.projectVersion
		stateMutable.items = { ...refs.items }
	}

	let newTreeSha: string
	try {
		newTreeSha = buildWorkspaceTreeSha(root, paths.snapshotPath)
	} catch (err) {
		return {
			kind: "rejected",
			reason: `build workspace tree failed: ${err instanceof Error ? err.message : String(err)}`,
		}
	}
	const parentSha = resolveRef(paths.snapshotPath, "refs/heads/main")
	if (parentSha !== stateMutable.commitSha) {
		return {
			kind: "rejected",
			reason: `internal snapshot inconsistency: snapshot HEAD (${parentSha ?? "<unborn>"}) doesn't match the recorded commit in state.json (${stateMutable.commitSha}). hint: delete .volt/snapshot/ and run \`volt pull --force\` to rebuild from the bridge`,
		}
	}
	const headTreeSha = resolveRef(paths.snapshotPath, `${stateMutable.commitSha}^{tree}`)
	if (newTreeSha === headTreeSha) {
		const noopSummary = "nothing to push — workspace matches snapshot."
		out(noopSummary)
		return { kind: "ok", items: [] }
	}

	const policyRefusals = findPolicyRefusals(root, paths.snapshotPath, stateMutable.commitSha, cfg)
	if (policyRefusals.length > 0) {
		const extList = policyRefusals.map((r) => `${r.ext.padEnd(14)} ${r.path}`).join("\n")
		return {
			kind: "rejected",
			reason: `refused: ${policyRefusals.length} file(s) have a read-only extension or are untracked.\nFiles refused:\n${extList}\nThese were pulled so the AI / you can READ them, but pushing them back risks overwriting engineer-managed config. To opt one in, edit .volt/config.json with "extensionAccess": { ".ext": "rw" }`,
		}
	}

	const pushed = computeOutgoing(paths.snapshotPath, root, stateMutable.commitSha)

	if (dryRun) {
		const adopted = driftAdoptedItems
			? [...driftAdoptedItems.added, ...driftAdoptedItems.modified].sort()
			: []
		if (!jsonMode) {
			printPushed(pushed, true)
			if (adopted.length > 0) printAdopted(adopted, true)
		}
		out("dry-run — nothing was sent to the bridge.")
		return { kind: "ok", items: [] }
	}

	const newCommitSha = createDeterministicCommit(
		paths.snapshotPath,
		newTreeSha,
		stateMutable.commitSha,
		"workspace push",
	)
	let result: Awaited<ReturnType<typeof applyPushToBridge>>
	try {
		result = await applyPushToBridge(paths.snapshotPath, bridge, newCommitSha)
	} catch (err) {
		return {
			kind: "rejected",
			reason: `send push to bridge failed: ${err instanceof Error ? err.message : String(err)}`,
		}
	}
	if (!result.accepted) {
		return {
			kind: "rejected",
			reason: `bridge rejected push: ${result.reason ?? "unknown reason"}. hint: run \`volt status\` to see current state, then \`volt pull\` to bring in IDE changes — or retry with \`--force\` to override`,
		}
	}

	updateRef(paths.snapshotPath, "refs/heads/main", result.commitSha)

	let adoptedNames: string[] | undefined
	if (driftAdoptedItems !== undefined) {
		await syncFromBridge(paths.snapshotPath, bridge)
		const postSyncState = loadState(paths.snapshotPath)
		if (postSyncState !== null) {
			const tree = listTree(paths.snapshotPath, postSyncState.commitSha)
			writeTreeToWorkspace(
				root,
				tree.map((e) => ({
					path: e.path,
					content: readBlobBytes(paths.snapshotPath, e.sha),
				})),
			)
		}
		const adopted = [
			...driftAdoptedItems.added,
			...driftAdoptedItems.modified,
		].sort()
		if (adopted.length > 0) adoptedNames = adopted
	}

	if (!jsonMode) {
		printPushed(pushed, false)
		if (adoptedNames !== undefined) printAdopted(adoptedNames, false)
	}
	const summary = `pushed. snapshot now @ ${result.commitSha.slice(0, 12)}`
	out(summary)

	const allItems = [
		...pushed.added,
		...pushed.modified,
		...pushed.moved.map((m) => m.name),
		...pushed.removed,
	]
	return { kind: "ok", items: allItems }
}

function printPushed(p: ChangeSet, dryRun: boolean): void {
	const total = p.added.length + p.modified.length + p.removed.length
	if (total === 0) return
	process.stdout.write(dryRun ? "would push to bridge (dry-run):\n" : "pushed to bridge:\n")
	for (const n of p.added) process.stdout.write(`  [WS]  + ${n}  (created)\n`)
	for (const n of p.modified) process.stdout.write(`  [WS]  M ${n}  (updated)\n`)
	for (const m of p.moved) process.stdout.write(`  [WS]  → ${m.name}  (moved ${m.from || "(root)"} → ${m.to || "(root)"})\n`)
	for (const n of p.removed) process.stdout.write(`  [WS]  - ${n}  (deleted)\n`)
}

function printAdopted(adopted: string[], dryRun: boolean): void {
	const header = dryRun
		? "--force / --force-with-lease was used. The following items would be pulled in as part of the post-push reconcile (NOT overwritten on the bridge):\n"
		: "--force was used. The following items were on the bridge but NOT in your workspace and have been pulled in as part of the post-push reconcile:\n"
	process.stderr.write(header)
	for (const n of adopted) process.stderr.write(`  [IDE] + ${n}  (added to workspace)\n`)
	if (!dryRun) {
		process.stderr.write(
			"These items were NOT overwritten — they survived the force-push and now live in your workspace too.\n\n",
		)
	}
}

function findPolicyRefusals(
	workspaceRoot: string,
	snapshotPath: string,
	commitSha: string,
	cfg: WorkspaceConfig,
): Array<{ path: string; ext: string }> {
	const refused: Array<{ path: string; ext: string }> = []

	const snapshotEntries = listTree(snapshotPath, commitSha)
	const snapshotByPath = new Map<string, string>()
	for (const e of snapshotEntries) snapshotByPath.set(e.path, e.sha)

	const wsFiles = listWorkspaceFiles(workspaceRoot)
	for (const wsFile of wsFiles) {
		const dot = wsFile.path.lastIndexOf(".")
		const ext = dot >= 0 ? wsFile.path.slice(dot).toLowerCase() : ""
		if (isPushable(ext, cfg)) continue

		const wsContent = wsFile.content
		const wsHash = hashBytes(wsContent)
		const snapshotSha = snapshotByPath.get(wsFile.path)
		if (snapshotSha !== undefined) {
			const snapHash = hashBytes(readBlobBytes(snapshotPath, snapshotSha))
			if (wsHash === snapHash) continue
		}
		refused.push({ path: wsFile.path, ext: ext.length > 0 ? ext : "(no ext)" })
	}
	return refused
}

function hashBytes(buf: Buffer): string {
	return createHash("sha1").update(buf).digest("hex")
}
