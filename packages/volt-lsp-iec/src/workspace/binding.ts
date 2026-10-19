/**
 * THE VENDOR A WORKSPACE FOLDER IS BOUND TO — `<git dir>/volt/config.json` `bridge.vendor`, written by `volt init --vendor`
 * (the C# `WorkspaceConfig.Bridge.Vendor`, `packages/volt-cli/src/Volt.Cli/Sync/Config.cs`). The binding is the one
 * place a pulled workspace states its vendor: no source file does, and TwinCAT has no `.device`.
 *
 * No binding file ⇒ unbound (`undefined`). A binding file that does not state `codesys` or `twincat` is refused by
 * name, never read as unbound: a malformed binding is a broken workspace, and guessing past it would pick a dialect.
 */
import { readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import type { Vendor } from "../analysis/index.js"

/**
 * The folder's git dir, where the CLI keeps the binding (`git rev-parse --absolute-git-dir`, `Config.Paths`): `.git`
 * itself, or — in a linked worktree or a submodule, where `.git` is a FILE — the dir its `gitdir:` line names (relative
 * to the folder when it is relative). No `.git` ⇒ undefined (not a repo, so unbound).
 */
function gitDir(folder: string): string | undefined {
  const dotGit = join(folder, ".git")
  let isDir: boolean
  try {
    isDir = statSync(dotGit).isDirectory()
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT" || (e as NodeJS.ErrnoException).code === "ENOTDIR") return undefined
    throw e
  }
  if (isDir) return dotGit
  const named = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, "utf8"))?.[1]
  if (named === undefined) throw new Error(`${dotGit} is a file that names no git dir (no \`gitdir:\` line)`)
  return resolve(folder, named)
}

export function boundVendor(folder: string): Vendor | undefined {
  const dir = gitDir(folder)
  if (dir === undefined) return undefined
  const file = join(dir, "volt", "config.json")
  let raw: string
  try {
    raw = readFileSync(file, "utf8")
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT" || (e as NodeJS.ErrnoException).code === "ENOTDIR") return undefined
    throw e
  }
  let vendor: unknown
  try {
    vendor = (JSON.parse(raw) as { bridge?: { vendor?: unknown } } | null)?.bridge?.vendor
  } catch {
    throw new Error(`${file} is not JSON — re-run \`volt init --vendor <codesys|twincat>\``)
  }
  if (vendor === "codesys" || vendor === "twincat") return vendor
  throw new Error(`${file} states no vendor (bridge.vendor is ${JSON.stringify(vendor)}) — re-run \`volt init --vendor <codesys|twincat>\``)
}

/**
 * THE APPLICATIONS THE IDE STATED for the workspace at `folder` (openspec multi-application-tree, design §3): the roots
 * `volt pull` recorded in `<git dir>/volt/ide-refs.json` (the C# `Sidecar.IdeRefs.Applications`), each an item path under
 * the workspace's `src/` (the CLI's `Files.SrcDir`), as an absolute folder. A workspace with no baseline yet states none
 * (`[]`); a baseline that does not state them is refused by name — it predates item paths, and guessing the applications
 * from vendor segments would be a parse of the IDE's tree no client makes.
 */
export function boundApplications(folder: string): string[] {
  const dir = gitDir(folder)
  if (dir === undefined) return []
  const file = join(dir, "volt", "ide-refs.json")
  let raw: string
  try {
    raw = readFileSync(file, "utf8")
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT" || (e as NodeJS.ErrnoException).code === "ENOTDIR") return []
    throw e
  }
  let applications: unknown
  try {
    applications = (JSON.parse(raw) as { applications?: unknown } | null)?.applications
  } catch {
    throw new Error(`${file} is not JSON — run \`volt pull\` to rebuild the baseline`)
  }
  if (!Array.isArray(applications) || !applications.every((a) => typeof a === "string"))
    throw new Error(`${file} states no applications — it predates item paths: run \`volt pull\` to rebuild the baseline`)
  return applications.map((a: string) => join(folder, "src", ...a.split("/")))
}
