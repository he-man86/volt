import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

export function listWorkspace(workspace: string): string[] {
	const out: string[] = []
	function walk(dir: string): void {
		let entries: import("node:fs").Dirent[]
		try {
			entries = readdirSync(dir, { withFileTypes: true }) as import("node:fs").Dirent[]
		} catch {
			return
		}
		for (const e of entries) {
			if (dir === workspace && (e.name === ".volt" || e.name === ".git")) continue
			const full = join(dir, e.name)
			if (e.isDirectory()) {
				walk(full)
			} else if (e.isFile()) {
				out.push(relative(workspace, full).split(sep).join("/"))
			}
		}
	}
	walk(workspace)
	out.sort()
	return out
}

export function readWorkspace(workspace: string, relPath: string): string {
	return readFileSync(join(workspace, relPath), "utf-8")
}

export function workspaceHas(workspace: string, relPath: string): boolean {
	return existsSync(join(workspace, relPath))
}

export function workspaceHasFile(workspace: string, relPath: string): boolean {
	const abs = join(workspace, relPath)
	if (!existsSync(abs)) return false
	try {
		return statSync(abs).isFile()
	} catch {
		return false
	}
}

export function workspaceCountByExtension(workspace: string): Record<string, number> {
	const counts: Record<string, number> = {}
	for (const path of listWorkspace(workspace)) {
		const dot = path.lastIndexOf(".")
		const ext = dot >= 0 ? path.slice(dot) : "(no-ext)"
		counts[ext] = (counts[ext] ?? 0) + 1
	}
	return counts
}
