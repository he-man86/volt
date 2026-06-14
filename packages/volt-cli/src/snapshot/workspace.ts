import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { buildTree, listTree, writeBlob } from "../git/plumbing.js"
import { getByPath, isTrackedPath, nameFromPath, sourceExtensions } from "../registry/extensions.js"

export const WORKSPACE_SRC_DIR = "src"

function srcRoot(workspaceRoot: string): string {
	return join(workspaceRoot, WORKSPACE_SRC_DIR)
}

export function listWorkspaceFiles(workspaceRoot: string): Array<{ path: string; content: Buffer }> {
	const out: Array<{ path: string; content: Buffer }> = []
	const rootAbs = resolve(srcRoot(workspaceRoot))

	function walk(dir: string): void {
		let entries: string[]
		try {
			entries = readdirSync(dir, { withFileTypes: false }) as string[]
		} catch {
			return
		}
		for (const name of entries) {
			const abs = join(dir, name)
			let st: ReturnType<typeof statSync>
			try {
				st = statSync(abs)
			} catch {
				continue
			}
			if (st.isDirectory()) {
				walk(abs)
				continue
			}
			if (!st.isFile()) continue
			const rel = relative(rootAbs, abs).split(sep).join("/")
			if (!isTrackedPath(rel)) continue
			out.push({ path: rel, content: readFileSync(abs) })
		}
	}

	walk(rootAbs)
	out.sort((a, b) => a.path.localeCompare(b.path))
	return out
}

export function writeTreeToWorkspace(
	workspaceRoot: string,
	entries: ReadonlyArray<{ path: string; content: Buffer | string }>,
): void {
	const srcAbs = srcRoot(workspaceRoot)
	for (const e of entries) {
		const abs = join(srcAbs, e.path)
		mkdirSync(dirname(abs), { recursive: true })
		writeFileSync(abs, e.content)
	}
}

export function sweepEmptyDirs(workspaceRoot: string): string[] {
	const rootAbs = resolve(srcRoot(workspaceRoot))
	const removed: string[] = []

	function dirHasFiles(abs: string): boolean {
		let entries: import("node:fs").Dirent[]
		try {
			entries = readdirSync(abs, { withFileTypes: true }) as import("node:fs").Dirent[]
		} catch {
			return false
		}
		for (const e of entries) {
			if (e.isFile()) return true
			if (e.isDirectory()) {
				if (dirHasFiles(join(abs, e.name))) return true
			}
		}
		return false
	}

	function walk(abs: string): void {
		let entries: import("node:fs").Dirent[]
		try {
			entries = readdirSync(abs, { withFileTypes: true }) as import("node:fs").Dirent[]
		} catch {
			return
		}
		for (const e of entries) {
			if (!e.isDirectory()) continue
			const childAbs = join(abs, e.name)
			walk(childAbs)
			if (!dirHasFiles(childAbs)) {
				try {
					rmSync(childAbs, { recursive: true, force: true })
					removed.push(relative(rootAbs, childAbs).split(sep).join("/"))
				} catch {
					/* ignore — concurrent change or permission issue */
				}
			}
		}
	}

	walk(rootAbs)
	return removed
}

export function removeFilesFromWorkspace(workspaceRoot: string, paths: readonly string[]): void {
	const rootAbs = resolve(srcRoot(workspaceRoot))
	for (const rel of paths) {
		const abs = join(rootAbs, rel)
		try {
			rmSync(abs, { force: true })
		} catch {
			/* ignore — file already gone */
		}
		let dir = dirname(abs)
		while (dir.startsWith(rootAbs) && dir !== rootAbs) {
			let remaining: string[]
			try {
				remaining = readdirSync(dir, { withFileTypes: false }) as string[]
			} catch {
				break
			}
			if (remaining.length > 0) break
			try {
				rmSync(dir, { recursive: false, force: true })
			} catch {
				break
			}
			dir = dirname(dir)
		}
	}
}

export function normalizeWorkspaceContent(buf: Buffer): Buffer {
	const s = buf.toString("utf-8")
	const normalized = s.replace(/\r\n/g, "\n")
	if (normalized === s) return buf
	return Buffer.from(normalized, "utf-8")
}

export function buildWorkspaceTreeSha(workspaceRoot: string, snapshotPath: string): string {
	const files = listWorkspaceFiles(workspaceRoot)
	const indexEntries = files.map((f) => ({
		path: f.path,
		sha: writeBlob(snapshotPath, normalizeWorkspaceContent(f.content)),
	}))
	return buildTree(snapshotPath, indexEntries)
}

export function detectWorkspaceDirty(
	snapshotPath: string,
	workspaceRoot: string,
	headCommitSha: string,
): string[] {
	const headEntries = listTree(snapshotPath, headCommitSha)
	const headByPath = new Map(headEntries.map((e) => [e.path, e.sha]))
	const wsFiles = listWorkspaceFiles(workspaceRoot)
	const wsByPath = new Map(wsFiles.map((f) => [f.path, f.content]))

	const dirty = new Set<string>()

	for (const [path, content] of wsByPath) {
		const wsSha = writeBlob(snapshotPath, normalizeWorkspaceContent(content))
		if (headByPath.get(path) !== wsSha) dirty.add(path)
	}

	for (const path of headByPath.keys()) {
		if (!wsByPath.has(path) && isTrackedPath(path)) dirty.add(path)
	}

	return [...dirty].sort()
}

export function ensureGitignore(workspaceRoot: string): void {
	const voltPattern = /^\s*\/?\.volt\/?\s*$/m
	const nodeModulesPattern = /^\s*\/?node_modules\/?\s*$/m

	const gitignorePath = join(workspaceRoot, ".gitignore")
	const voltEntry = `# volt local state — workspace-local snapshot + config\n/.volt/\n`
	const nodeEntry = `# bun / node tooling\n/node_modules/\n`

	if (!existsSync(gitignorePath)) {
		writeFileSync(gitignorePath, `${voltEntry}\n${nodeEntry}`, "utf-8")
	} else {
		let existing = readFileSync(gitignorePath, "utf-8")
		let appended = false
		if (!voltPattern.test(existing)) {
			const sep = existing.endsWith("\n") ? "\n" : "\n\n"
			existing = existing + sep + voltEntry
			appended = true
		}
		if (!nodeModulesPattern.test(existing)) {
			const sep = existing.endsWith("\n") ? "\n" : "\n\n"
			existing = existing + sep + nodeEntry
			appended = true
		}
		if (appended) writeFileSync(gitignorePath, existing, "utf-8")
	}

	const gaPath = join(workspaceRoot, ".gitattributes")
	const gaContent = sourceExtensions().map((e) => `*${e} text eol=lf`).join("\n") + "\n"
	if (!existsSync(gaPath) || readFileSync(gaPath, "utf-8") !== gaContent) {
		writeFileSync(gaPath, gaContent, "utf-8")
	}
}
