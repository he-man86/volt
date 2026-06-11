import { listTree, writeBlob } from "../git/plumbing.js"
import { getByPath, nameFromPath } from "../registry/extensions.js"
import { listWorkspaceFiles, normalizeWorkspaceContent } from "./workspace.js"

export interface ChangeSet {
	added: string[]
	removed: string[]
	modified: string[]
	moved: Array<{ name: string; from: string; to: string }>
}

export function hasChanges(c: ChangeSet): boolean {
	return (
		c.added.length > 0 ||
		c.removed.length > 0 ||
		c.modified.length > 0 ||
		c.moved.length > 0
	)
}

export function computeIncoming(
	bridgeItems: Record<string, string>,
	snapshotItems: Record<string, string>,
): ChangeSet {
	const added: string[] = []
	const removed: string[] = []
	const modified: string[] = []
	for (const [name, ver] of Object.entries(bridgeItems)) {
		const prev = snapshotItems[name]
		if (prev === undefined) added.push(name)
		else if (prev !== ver) modified.push(name)
	}
	for (const name of Object.keys(snapshotItems)) {
		if (!(name in bridgeItems)) removed.push(name)
	}
	return {
		added: added.sort(),
		removed: removed.sort(),
		modified: modified.sort(),
		moved: [],
	}
}

export function computeOutgoing(
	snapshotPath: string,
	workspaceRoot: string,
	headCommitSha: string,
): ChangeSet {
	const headEntries = listTree(snapshotPath, headCommitSha)
	const headByPath = new Map(headEntries.map((e) => [e.path, e.sha]))
	const wsFiles = listWorkspaceFiles(workspaceRoot)
	const wsByPath = new Map(wsFiles.map((f) => [f.path, f.content]))

	const added = new Map<string, string>()
	const removed = new Map<string, string>()
	const modified = new Set<string>()

	const sourceOnly = (path: string): string | undefined => {
		const def = getByPath(path)
		if (def === undefined || def.family !== "source") return undefined
		return nameFromPath(path)
	}
	const folderOf = (path: string): string => {
		const segs = path.split("/")
		return segs.slice(0, -1).join("/")
	}
	for (const [path, content] of wsByPath) {
		const name = sourceOnly(path)
		if (name === undefined) continue
		const wsSha = writeBlob(snapshotPath, normalizeWorkspaceContent(content))
		const headSha = headByPath.get(path)
		if (headSha === undefined) added.set(name, folderOf(path))
		else if (headSha !== wsSha) modified.add(name)
	}
	for (const path of headByPath.keys()) {
		const name = sourceOnly(path)
		if (name === undefined) continue
		if (!wsByPath.has(path)) removed.set(name, folderOf(path))
	}

	const moved: Array<{ name: string; from: string; to: string }> = []
	for (const [name, toFolder] of added) {
		const fromFolder = removed.get(name)
		if (fromFolder === undefined) continue
		moved.push({ name, from: fromFolder, to: toFolder })
		added.delete(name)
		removed.delete(name)
	}
	moved.sort((a, b) => a.name.localeCompare(b.name))

	return {
		added: [...added.keys()].sort(),
		modified: [...modified].sort(),
		removed: [...removed.keys()].sort(),
		moved,
	}
}
