import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeWorkspaceScaffold } from "../../scaffold/index.js"

function fresh(): string {
	return mkdtempSync(join(tmpdir(), "volt-scaffold-"))
}

const DEFAULT_OPTS = {
	plcProjectName: "Untitled2",
	agentVersion: "1.16.0",
}

describe("writeWorkspaceScaffold", () => {
	test("writes every scaffold file on a fresh workspace", () => {
		const root = fresh()
		try {
			const report = writeWorkspaceScaffold({ root, ...DEFAULT_OPTS })
			expect([...report.created].sort()).toEqual([
				".vscode/settings.json",
				"README.md",
				"bunfig.toml",
				"package.json",
				"tests/example.test.ts",
				"tsconfig.json",
			])
			expect(report.skipped).toEqual([])
			for (const f of report.created) {
				expect(existsSync(join(root, f))).toBe(true)
			}
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("package.json carries sanitized name + agent version pin", () => {
		const root = fresh()
		try {
			writeWorkspaceScaffold({
				root,
				plcProjectName: "Untitled 2!!",
				agentVersion: "1.16.0",
			})
			const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as {
				name: string
				devDependencies: Record<string, string>
			}
			expect(pkg.name).toBe("untitled-2")
			expect(pkg.devDependencies["@opencode-ai/volt-cli"]).toBe("^1.16.0")
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("idempotent: re-run leaves existing files alone", () => {
		const root = fresh()
		try {
			writeWorkspaceScaffold({ root, ...DEFAULT_OPTS })
			const tsconfigPath = join(root, "tsconfig.json")
			writeFileSync(tsconfigPath, '{"custom": true}\n', "utf-8")
			const report = writeWorkspaceScaffold({ root, ...DEFAULT_OPTS })
			expect(report.created).toEqual([])
			expect([...report.skipped].sort()).toEqual([
				".vscode/settings.json",
				"README.md",
				"bunfig.toml",
				"package.json",
				"tests/example.test.ts",
				"tsconfig.json",
			])
			expect(readFileSync(tsconfigPath, "utf-8")).toBe('{"custom": true}\n')
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("force: true rewrites everything regardless of existence", () => {
		const root = fresh()
		try {
			writeWorkspaceScaffold({ root, ...DEFAULT_OPTS })
			const tsconfigPath = join(root, "tsconfig.json")
			writeFileSync(tsconfigPath, '{"custom": true}\n', "utf-8")
			const report = writeWorkspaceScaffold({ root, ...DEFAULT_OPTS, force: true })
			expect(report.skipped).toEqual([])
			expect(report.created.length).toBeGreaterThan(0)
			expect(readFileSync(tsconfigPath, "utf-8")).not.toBe('{"custom": true}\n')
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("partial scaffold: skip existing files, write the rest", () => {
		const root = fresh()
		try {
			writeFileSync(join(root, "README.md"), "MY README\n", "utf-8")
			const report = writeWorkspaceScaffold({ root, ...DEFAULT_OPTS })
			expect(report.skipped).toEqual(["README.md"])
			expect(report.created).toContain("package.json")
			expect(readFileSync(join(root, "README.md"), "utf-8")).toBe("MY README\n")
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("creates intermediate directories (.vscode, tests)", () => {
		const root = fresh()
		try {
			writeWorkspaceScaffold({ root, ...DEFAULT_OPTS })
			expect(existsSync(join(root, ".vscode"))).toBe(true)
			expect(existsSync(join(root, "tests"))).toBe(true)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("generated tsconfig excludes src/, node_modules/, .volt/, .claude/", () => {
		const root = fresh()
		try {
			writeWorkspaceScaffold({ root, ...DEFAULT_OPTS })
			const ts = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf-8")) as {
				exclude: string[]
			}
			expect(ts.exclude).toEqual(["node_modules", "src", ".volt", ".claude"])
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("README references the actual PLC project name", () => {
		const root = fresh()
		try {
			writeWorkspaceScaffold({
				root,
				plcProjectName: "MachineController_v3",
				agentVersion: "1.0.0",
			})
			const readme = readFileSync(join(root, "README.md"), "utf-8")
			expect(readme).toContain("MachineController_v3")
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test(".vscode/settings.json excludes node_modules from watcher + search", () => {
		const root = fresh()
		try {
			writeWorkspaceScaffold({ root, ...DEFAULT_OPTS })
			const cfg = JSON.parse(readFileSync(join(root, ".vscode/settings.json"), "utf-8")) as {
				"files.watcherExclude": Record<string, boolean>
				"search.exclude": Record<string, boolean>
			}
			expect(cfg["files.watcherExclude"]["**/node_modules/**"]).toBe(true)
			expect(cfg["files.watcherExclude"]["**/.volt/snapshot/**"]).toBe(true)
			expect(cfg["search.exclude"]["**/.volt"]).toBe(true)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})
