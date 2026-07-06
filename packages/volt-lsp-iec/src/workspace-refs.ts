/**
 * Workspace reference-file scan (node I/O — app tier, above the pure analysis layers).
 *
 * `volt pull` mirrors the IDE project, including read-only reference files whose names are valid
 * identifiers that resolve OUTSIDE the project symbol table — so the unresolved-identifier check must
 * SKIP them, not flag them:
 *
 *   - `.library` files (under a Library Manager) carry a `NAMESPACE <name>` line — the root of a
 *     qualified library reference (`PACK_ML.State`, `L_MC4P.Foo`).
 *   - `.device` files (mirroring the device tree) are named after a device-tree instance — an implicit
 *     global the source reads bare (`MagazineAxes`, `EtherCAT_Master`, the drives + axes).
 *
 * Kept as two loaders on purpose: same shape today, but different sources, and if devices ever gain real
 * types they become project symbols while library namespaces stay skips. Names are lowercased (PLC
 * identifiers are case-insensitive). Empty when there are none / the tree is unreadable ⇒ nothing known.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { basename, extname, join } from "node:path"
import { EMPTY_WORKSPACE_REFS, type WorkspaceRefs } from "./analysis/index.js"

/** All files under `root`, recursively. Unreadable directories are skipped, not thrown. */
function walkFiles(root: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return out
  }
  for (const name of entries) {
    const p = join(root, name)
    let dir = false
    try {
      dir = statSync(p).isDirectory()
    } catch {
      continue
    }
    if (dir) out.push(...walkFiles(p))
    else out.push(p)
  }
  return out
}

/** Scan `<root>` for files with `ext`, map each to a name (undefined ⇒ skip), collect them lowercased. */
function collect(root: string, ext: string, nameOf: (path: string) => string | undefined): Set<string> {
  const out = new Set<string>()
  for (const file of walkFiles(root)) {
    if (extname(file).toLowerCase() !== ext) continue
    let name: string | undefined
    try {
      name = nameOf(file)
    } catch {
      continue // unreadable ref file — skip
    }
    if (name !== undefined && name.length > 0) out.add(name.toLowerCase())
  }
  return out
}

/** Referenced-library namespaces, from each `.library` file's `NAMESPACE` line. */
export function loadLibraryNamespaces(root: string): Set<string> {
  return collect(root, ".library", (file) => readFileSync(file, "utf8").match(/^NAMESPACE (.+)$/m)?.[1]?.trim())
}

/** Device-tree instance names, from each `.device` file's stem (the instance name is the filename). */
export function loadDeviceInstances(root: string): Set<string> {
  return collect(root, ".device", (file) => basename(file, extname(file)))
}

/**
 * Task-entry PROGRAM names (lowercased), from each `.task` file's `Calls:` line — the PROGRAMs CODESYS
 * actually runs. Dead-code reachability seeds its roots from THESE (not every PROGRAM), so a PROGRAM that
 * is not assigned to a task (its only call commented out, "moved elsewhere") is correctly dead. Empty when
 * there is no task configuration ⇒ the reachability falls back to treating all PROGRAMs as roots (safe).
 */
export function loadTaskRoots(root: string): Set<string> {
  return collect(root, ".task", (file) => readFileSync(file, "utf8").match(/^Calls:\s+(\S+)/m)?.[1])
}

/** Both reference-file catalogs for a workspace root — the input the unresolved-identifier check skips. */
export function loadWorkspaceRefs(root: string): WorkspaceRefs {
  if (root.length === 0) return EMPTY_WORKSPACE_REFS
  return { libraryNamespaces: loadLibraryNamespaces(root), deviceInstances: loadDeviceInstances(root) }
}
