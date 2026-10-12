import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { boundVendor } from "./binding.js"

/** A folder whose `.git/volt/config.json` holds `body` (no file when `body` is undefined). */
function folder(body?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "volt-binding-"))
  if (body !== undefined) {
    mkdirSync(join(dir, ".git", "volt"), { recursive: true })
    writeFileSync(join(dir, ".git", "volt", "config.json"), body)
  }
  return dir
}

function read(body?: string): ReturnType<typeof boundVendor> {
  const dir = folder(body)
  try {
    return boundVendor(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// THE SHAPE `volt init` WRITES (the C# `WorkspaceConfig`, camelCase): `{ bridge: { vendor }, project: { platform,
// projectName } }`. The vscode reader once had a test that hand-rolled `{ vendor }` and every case failed — a fixture
// in a shape the writer never produces tests only the reader.
test("the binding's vendor is `bridge.vendor`", () => {
  expect(read(JSON.stringify({ bridge: { vendor: "twincat" }, project: { platform: "twincat", projectName: "P" } }))).toBe("twincat")
  expect(read(JSON.stringify({ bridge: { vendor: "codesys" } }))).toBe("codesys")
})

test("no binding file is unbound, not an error", () => {
  expect(read()).toBeUndefined()
  expect(boundVendor(join(tmpdir(), "volt-no-such-folder-xyz"))).toBeUndefined()
})

test("a binding that states no vendor is refused by name, never read as unbound", () => {
  expect(() => read(JSON.stringify({ vendor: "twincat" }))).toThrow(/config\.json states no vendor/)
  expect(() => read(JSON.stringify({ bridge: { vendor: "beckhoff" } }))).toThrow(/"beckhoff"/)
  expect(() => read("{ not json")).toThrow(/config\.json is not JSON/)
})

// THE BINDING LIVES IN THE GIT DIR, which is not always `<folder>/.git`. The CLI writes it under
// `git rev-parse --absolute-git-dir` (`Config.Paths`): in a linked worktree or a submodule `.git` is a FILE naming that
// dir (`gitdir: …`), and a literal `<folder>/.git/volt/config.json` read the worktree as unbound — the server refused a
// workspace `volt status` treats as bound.
test("a linked worktree's or submodule's binding is read from the git dir its `.git` file names", () => {
  const main = mkdtempSync(join(tmpdir(), "volt-binding-main-"))
  try {
    const gitDir = join(main, ".git", "worktrees", "wt")
    mkdirSync(join(gitDir, "volt"), { recursive: true })
    writeFileSync(join(gitDir, "volt", "config.json"), JSON.stringify({ bridge: { vendor: "twincat" } }))
    const absolute = join(main, "wt")
    mkdirSync(absolute)
    writeFileSync(join(absolute, ".git"), `gitdir: ${gitDir}\n`)
    expect(boundVendor(absolute)).toBe("twincat")
    const relative = join(main, "sub")
    mkdirSync(relative)
    writeFileSync(join(relative, ".git"), "gitdir: ../.git/worktrees/wt\n") // a submodule's `.git` names it relatively
    expect(boundVendor(relative)).toBe("twincat")
    const broken = join(main, "broken")
    mkdirSync(broken)
    writeFileSync(join(broken, ".git"), "not a gitdir line\n")
    expect(() => boundVendor(broken)).toThrow(/\.git is a file that names no git dir/)
  } finally {
    rmSync(main, { recursive: true, force: true })
  }
})
