import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bindingFile, readBoundProject, readBridgeVendor } from "./health.js"

// ONE FACT, TWO READERS THAT AGREE (with `volt-lsp-iec/src/workspace/binding.ts`). The binding lives in the git dir the
// CLI resolves (`git rev-parse --absolute-git-dir`): in a linked worktree or a submodule `.git` is a FILE naming it. And
// a malformed binding is refused by name, as the LSP refuses it — never read as unbound, which made the desktop quietly
// skip diagnostics for a workspace the server would refuse.
test("the binding is read from the git dir a `.git` file names", () => {
  const main = mkdtempSync(join(tmpdir(), "volt-control-binding-"))
  try {
    const gitDir = join(main, ".git", "worktrees", "wt")
    mkdirSync(join(gitDir, "volt"), { recursive: true })
    writeFileSync(join(gitDir, "volt", "config.json"), JSON.stringify({ bridge: { vendor: "twincat" }, project: { projectName: "P" } }))
    const wt = join(main, "wt")
    mkdirSync(wt)
    writeFileSync(join(wt, ".git"), "gitdir: ../.git/worktrees/wt\n")
    expect(readBridgeVendor(wt)).toBe("twincat")
    expect(readBoundProject(wt)).toEqual({ vendor: "twincat", projectName: "P" })
  } finally {
    rmSync(main, { recursive: true, force: true })
  }
})

test("no binding is unbound; a malformed one is refused by name", () => {
  const dir = mkdtempSync(join(tmpdir(), "volt-control-binding-"))
  try {
    expect(readBridgeVendor(dir)).toBeUndefined()
    mkdirSync(join(dir, ".git", "volt"), { recursive: true })
    expect(readBridgeVendor(dir)).toBeUndefined()
    writeFileSync(join(dir, ".git", "volt", "config.json"), "{bad")
    expect(() => readBridgeVendor(dir)).toThrow(/config\.json is not JSON/)
    writeFileSync(join(dir, ".git", "volt", "config.json"), JSON.stringify({ bridge: { vendor: "beckhoff" } }))
    expect(() => readBridgeVendor(dir)).toThrow(/config\.json states no vendor[\s\S]*"beckhoff"/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("the binding file is named once: every frontend reader resolves it through `bindingFile` / `voltStateDir`", () => {
  // Readers of one fact (the LSP's own aside): `hasVoltConfig`, `VoltStatus.refresh`, `volt.openConfig` and `readStateMtime`
  // hard-coded `<root>/.git/volt/…`, so in a worktree the extension skipped the folder and the desktop showed it unbound
  // while the panel and the LSP read it bound.
  const main = mkdtempSync(join(tmpdir(), "volt-control-binding-"))
  try {
    mkdirSync(join(main, ".git"))
    expect(bindingFile(main)).toBe(join(main, ".git", "volt", "config.json"))
    const wt = join(main, "wt")
    mkdirSync(wt)
    writeFileSync(join(wt, ".git"), "gitdir: ../.git/worktrees/wt\n")
    expect(bindingFile(wt)).toBe(join(main, ".git", "worktrees", "wt", "volt", "config.json"))
    expect(bindingFile(join(main, "none"))).toBeUndefined()
  } finally {
    rmSync(main, { recursive: true, force: true })
  }
  const packages = join(import.meta.dir, "..", "..", "..")
  const hardCoded = Array.from(new Bun.Glob("volt-{control,vscode,desktop}/src/**/*.ts").scanSync(packages))
    .filter((f) => !f.endsWith(".test.ts") && !f.endsWith("health.ts") && !f.endsWith("test-support.ts")) // a fixture writer
    .filter((f) => /["']\.git["']\s*,\s*["']volt["']/.test(readFileSync(join(packages, f), "utf8")))
  expect(hardCoded).toEqual([])
})
