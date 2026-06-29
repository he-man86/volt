/**
 * `writeOpencodeConfig` — wires the volt LSP + tool into a project's `.opencode/` (project-local, replacing
 * the old global `setup()`). The load-bearing bit is the merge: it must add the LSP without clobbering an
 * existing config.
 */
import { test, expect } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeOpencodeConfig } from "../opencode-config.js"

test("writes the project LSP (.opencode/opencode.json) + tool, never the global config", () => {
	const root = mkdtempSync(join(tmpdir(), "volt-cfg-"))
	const r = writeOpencodeConfig(root)

	expect(r.configFile).toBe(join(root, ".opencode", "opencode.json"))
	const cfg = JSON.parse(readFileSync(r.configFile, "utf8"))
	expect((cfg.lsp["volt-lsp-codesys"] as { extensions: string[] }).extensions).toContain(".st")
	expect(existsSync(join(root, ".opencode", "tool", "volt.ts"))).toBe(true)
})

test("merges into an existing config — never clobbers the user's keys", () => {
	const root = mkdtempSync(join(tmpdir(), "volt-cfg-"))
	mkdirSync(join(root, ".opencode"), { recursive: true })
	writeFileSync(
		join(root, ".opencode", "opencode.json"),
		JSON.stringify({ theme: "mine", lsp: { other: { command: ["x"], extensions: [".foo"] } } }),
	)

	writeOpencodeConfig(root)

	const cfg = JSON.parse(readFileSync(join(root, ".opencode", "opencode.json"), "utf8"))
	expect(cfg.theme).toBe("mine") // preserved
	expect(cfg.lsp.other).toBeDefined() // preserved
	expect(cfg.lsp["volt-lsp-codesys"]).toBeDefined() // added
})
