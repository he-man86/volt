import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { initBareRepo, isRepo } from "../git/plumbing.js"

export interface RepoState {
	projectVersion: string
	commitSha: string
	items: Record<string, string>
	folders: Record<string, string>
}

export interface SnapshotHealResult {
	rebuilt: boolean
	reason?: string
}

function inspectSnapshot(snapshotPath: string):
	| undefined
	| { healthy: true }
	| { healthy: false; missing: string[] } {
	if (!existsSync(snapshotPath)) return undefined
	if (!isRepo(snapshotPath)) {
		return { healthy: false, missing: ["repo metadata (config / HEAD)"] }
	}
	const missing: string[] = []
	if (!existsSync(join(snapshotPath, "HEAD"))) missing.push("HEAD")
	if (!existsSync(join(snapshotPath, "objects"))) missing.push("objects/")
	if (!existsSync(join(snapshotPath, "refs"))) missing.push("refs/")
	return missing.length === 0 ? { healthy: true } : { healthy: false, missing }
}

export function ensureSnapshotRepo(snapshotPath: string): SnapshotHealResult {
	const audit = inspectSnapshot(snapshotPath)
	if (audit === undefined) {
		mkdirSync(snapshotPath, { recursive: true })
		initBareRepo(snapshotPath)
		return { rebuilt: false }
	}
	if (audit.healthy) return { rebuilt: false }
	const reason = `missing ${audit.missing.join(", ")}`
	for (const entry of readdirSync(snapshotPath)) {
		const full = join(snapshotPath, entry)
		try {
			const st = statSync(full)
			if (st.isDirectory()) rmSync(full, { recursive: true, force: true })
			else unlinkSync(full)
		} catch {
			// Best-effort — keep going so initBareRepo can do its job.
		}
	}
	initBareRepo(snapshotPath)
	return { rebuilt: true, reason }
}

export function reportSnapshotHeal(heal: SnapshotHealResult): void {
	if (!heal.rebuilt) return
	process.stderr.write(
		`volt: snapshot was corrupt (${heal.reason ?? "unknown reason"}); rebuilt from scratch.\n` +
			`      next pull will refetch every item from the bridge — no workspace files were touched.\n`,
	)
}

const STATE_FILE = "state.json"

export function loadState(snapshotPath: string): RepoState | null {
	const path = join(snapshotPath, STATE_FILE)
	if (!existsSync(path)) return null
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<RepoState>
		if (typeof parsed.projectVersion !== "string") return null
		if (typeof parsed.commitSha !== "string") return null
		if (parsed.items === undefined || typeof parsed.items !== "object") return null
		return {
			projectVersion: parsed.projectVersion,
			commitSha: parsed.commitSha,
			items: { ...parsed.items },
			folders: { ...(parsed.folders ?? {}) },
		}
	} catch {
		return null
	}
}

export function saveState(snapshotPath: string, state: RepoState): void {
	writeFileSync(
		join(snapshotPath, STATE_FILE),
		`${JSON.stringify(state, null, 2)}\n`,
		"utf-8",
	)
}
