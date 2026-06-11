import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensureGitignore } from "../../snapshot/workspace.js"

function fresh(): string {
	return mkdtempSync(join(tmpdir(), "volt-gitignore-"))
}

describe("ensureGitignore", () => {
	test("creates .gitignore when absent", () => {
		const root = fresh()
		try {
			ensureGitignore(root)
			const text = readFileSync(join(root, ".gitignore"), "utf-8")
			expect(text).toContain("# volt local state")
			expect(text).toContain("/.volt/")
			expect(text).toContain("# bun / node tooling")
			expect(text).toContain("/node_modules/")
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("idempotent: second call appends nothing", () => {
		const root = fresh()
		try {
			ensureGitignore(root)
			const first = readFileSync(join(root, ".gitignore"), "utf-8")
			ensureGitignore(root)
			const second = readFileSync(join(root, ".gitignore"), "utf-8")
			expect(second).toBe(first)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("appends only the missing entry when one is already present", () => {
		const root = fresh()
		try {
			writeFileSync(
				join(root, ".gitignore"),
				"# user content\n*.log\n/.volt/\n",
				"utf-8",
			)
			ensureGitignore(root)
			const text = readFileSync(join(root, ".gitignore"), "utf-8")
			expect(text).toContain("*.log")
			expect(text.match(/\/\.volt\//g)?.length).toBe(1)
			expect(text).toContain("/node_modules/")
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("preserves trailing-newline policy of existing file", () => {
		const root = fresh()
		try {
			writeFileSync(join(root, ".gitignore"), "*.log\n", "utf-8")
			ensureGitignore(root)
			const text = readFileSync(join(root, ".gitignore"), "utf-8")
			expect(text.startsWith("*.log\n")).toBe(true)
			expect(text).toContain("/.volt/")
			expect(text).toContain("/node_modules/")
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("missing trailing newline — adds one before appending", () => {
		const root = fresh()
		try {
			writeFileSync(join(root, ".gitignore"), "*.log", "utf-8")
			ensureGitignore(root)
			const text = readFileSync(join(root, ".gitignore"), "utf-8")
			expect(text).not.toContain("*.log#")
			expect(text).toContain("*.log")
			expect(text).toContain("# volt local state")
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("recognizes .volt and /.volt and .volt/ as the same entry", () => {
		const root = fresh()
		try {
			writeFileSync(join(root, ".gitignore"), ".volt\n", "utf-8")
			ensureGitignore(root)
			const text = readFileSync(join(root, ".gitignore"), "utf-8")
			expect(text.match(/^# volt local state/gm)?.length ?? 0).toBe(0)
			expect(text).toContain("/node_modules/")
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("does not touch the file when every entry is already present", () => {
		const root = fresh()
		try {
			const initial = "*.log\n/.volt/\n/node_modules/\n"
			const path = join(root, ".gitignore")
			writeFileSync(path, initial, "utf-8")
			ensureGitignore(root)
			expect(readFileSync(path, "utf-8")).toBe(initial)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("creates .gitattributes with source extensions", () => {
		const root = fresh()
		try {
			ensureGitignore(root)
			const ga = readFileSync(join(root, ".gitattributes"), "utf-8")
			expect(ga).toContain("*.st text eol=lf")
			expect(ga).toContain("*.gvl text eol=lf")
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})
