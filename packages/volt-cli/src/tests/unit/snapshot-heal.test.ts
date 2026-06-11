import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensureSnapshotRepo } from "../../snapshot/repo.js"

function freshTmpRoot(): string {
	return mkdtempSync(join(tmpdir(), "volt-heal-"))
}

describe("ensureSnapshotRepo — health detection + heal", () => {
	test("fresh dir: initializes a bare repo, reports no heal", () => {
		const root = freshTmpRoot()
		try {
			const snap = join(root, ".volt", "snapshot")
			const res = ensureSnapshotRepo(snap)
			expect(res.rebuilt).toBe(false)
			expect(existsSync(join(snap, "HEAD"))).toBe(true)
			expect(existsSync(join(snap, "objects"))).toBe(true)
			expect(existsSync(join(snap, "refs"))).toBe(true)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("healthy bare repo: no-op, no heal", () => {
		const root = freshTmpRoot()
		try {
			const snap = join(root, ".volt", "snapshot")
			ensureSnapshotRepo(snap)
			const res = ensureSnapshotRepo(snap)
			expect(res.rebuilt).toBe(false)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("corrupted: directory with objects/ subdir but no HEAD/refs gets healed", () => {
		const root = freshTmpRoot()
		try {
			const snap = join(root, ".volt", "snapshot")
			mkdirSync(join(snap, ".git", "objects"), { recursive: true })
			const res = ensureSnapshotRepo(snap)
			expect(res.rebuilt).toBe(true)
			expect(res.reason).toBeDefined()
			expect(existsSync(join(snap, "HEAD"))).toBe(true)
			expect(existsSync(join(snap, "objects"))).toBe(true)
			expect(existsSync(join(snap, "refs"))).toBe(true)
			expect(existsSync(join(snap, ".git"))).toBe(false)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("corrupted: stale state.json gets wiped along with the repo", () => {
		const root = freshTmpRoot()
		try {
			const snap = join(root, ".volt", "snapshot")
			mkdirSync(snap, { recursive: true })
			writeFileSync(join(snap, "state.json"), JSON.stringify({ projectVersion: "v1", commitSha: "deadbeef", items: {}, folders: {} }))
			writeFileSync(join(snap, "HEAD"), "ref: refs/heads/main\n")
			const res = ensureSnapshotRepo(snap)
			expect(res.rebuilt).toBe(true)
			expect(existsSync(join(snap, "state.json"))).toBe(false)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("corrupted snapshot nested inside a workspace git repo still heals", () => {
		const root = freshTmpRoot()
		try {
			const { spawnSync } = require("node:child_process") as typeof import("node:child_process")
			spawnSync("git", ["init", "--quiet", root], { encoding: "utf-8" })
			const snap = join(root, ".volt", "snapshot")
			mkdirSync(join(snap, ".git", "objects"), { recursive: true })
			writeFileSync(
				join(snap, "state.json"),
				JSON.stringify({ projectVersion: "v1", commitSha: "deadbeef", items: {}, folders: {} }),
			)
			const res = ensureSnapshotRepo(snap)
			expect(res.rebuilt).toBe(true)
			expect(existsSync(join(snap, "HEAD"))).toBe(true)
			expect(existsSync(join(snap, "objects"))).toBe(true)
			expect(existsSync(join(snap, "refs"))).toBe(true)
			expect(existsSync(join(snap, ".git"))).toBe(false)
			expect(existsSync(join(snap, "state.json"))).toBe(false)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("heal reason is descriptive when bare repo is incomplete", () => {
		const root = freshTmpRoot()
		try {
			const snap = join(root, ".volt", "snapshot")
			mkdirSync(snap, { recursive: true })
			writeFileSync(join(snap, "HEAD"), "ref: refs/heads/main\n")
			const res = ensureSnapshotRepo(snap)
			expect(res.rebuilt).toBe(true)
			expect(res.reason).toMatch(/missing/)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})
