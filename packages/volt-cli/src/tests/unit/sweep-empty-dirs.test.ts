import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sweepEmptyDirs } from "../../snapshot/workspace.js"

function fresh(): string {
	const root = mkdtempSync(join(tmpdir(), "volt-sweep-"))
	mkdirSync(join(root, "src"))
	return root
}

describe("sweepEmptyDirs", () => {
	test("removes a top-level empty directory under src/", () => {
		const root = fresh()
		try {
			mkdirSync(join(root, "src/Alarm Configuration"))
			const removed = sweepEmptyDirs(root)
			expect(removed).toContain("Alarm Configuration")
			expect(existsSync(join(root, "src/Alarm Configuration"))).toBe(false)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("removes a deeply nested empty subtree (leaves up)", () => {
		const root = fresh()
		try {
			mkdirSync(join(root, "src/Device/Plc Logic/Application/Stale"), { recursive: true })
			const removed = sweepEmptyDirs(root)
			expect(removed).toContain("Device/Plc Logic/Application/Stale")
			expect(existsSync(join(root, "src/Device/Plc Logic/Application/Stale"))).toBe(false)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("keeps directories that contain files (anywhere in subtree)", () => {
		const root = fresh()
		try {
			mkdirSync(join(root, "src/Device/Plc Logic/Application"), { recursive: true })
			writeFileSync(join(root, "src/Device/Plc Logic/Application/PLC_PRG.st"), "PROGRAM x END_PROGRAM\n")
			const removed = sweepEmptyDirs(root)
			expect(removed).toEqual([])
			expect(existsSync(join(root, "src/Device/Plc Logic/Application/PLC_PRG.st"))).toBe(true)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("keeps engineer folders backed by a .gitkeep marker", () => {
		const root = fresh()
		try {
			mkdirSync(join(root, "src/Device/Plc Logic/Application/folder"), { recursive: true })
			writeFileSync(join(root, "src/Device/Plc Logic/Application/folder/.gitkeep"), "")
			const removed = sweepEmptyDirs(root)
			expect(removed).toEqual([])
			expect(existsSync(join(root, "src/Device/Plc Logic/Application/folder/.gitkeep"))).toBe(true)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("never touches siblings of src/ at the workspace root", () => {
		const root = fresh()
		try {
			mkdirSync(join(root, ".volt/snapshot/objects"), { recursive: true })
			mkdirSync(join(root, ".git/objects"), { recursive: true })
			mkdirSync(join(root, "node_modules/foo"), { recursive: true })
			const removed = sweepEmptyDirs(root)
			expect(removed).toEqual([])
			expect(existsSync(join(root, ".volt/snapshot/objects"))).toBe(true)
			expect(existsSync(join(root, ".git/objects"))).toBe(true)
			expect(existsSync(join(root, "node_modules/foo"))).toBe(true)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})
