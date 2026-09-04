/**
 * Workspace scan (node I/O — app tier, above the pure analysis layers).
 *
 * `volt pull` mirrors the IDE project as text files. This module crawls that tree once and returns:
 *
 *   - **source files** (`.fb`/`.prg`/`.fun`/`.itf`/`.dut`/`.gvl`) — the
 *     units the binder cross-indexes, so a type declared in an unopened file still resolves.
 *   - **reference names** the unresolved-identifier check must SKIP (they resolve OUTSIDE the project):
 *       - `.library` files carry a `NAMESPACE <name>` line — the root of a qualified library reference.
 *       - `.device` files are named after a device-tree instance the source reads bare.
 *   - **task roots** — the `.task` `Calls:` PROGRAM names (comma-separated) dead-code reachability seeds from.
 *
 * Library namespaces stay skips while devices may one day gain real types, so the two ref sets stay
 * separate. Names are lowercased (PLC identifiers are case-insensitive). Unreadable files/dirs are
 * skipped, never thrown ⇒ an empty scan means "nothing known", which degrades safely.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { basename, extname, join } from "node:path"
import {
  EMPTY_WORKSPACE_REFS,
  projectDiagnosticsFrom,
  type ConfigurableCode,
  type DiagnosticState,
  type WorkspaceRefs,
} from "./analysis/index.js"
import { SOURCE_EXTENSION_SET } from "./source-extensions.js"

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

// ─── per-extension name extractors (shared by the single-file loaders + scanWorkspace) ───
const libraryNamespaceOf = (file: string): string | undefined =>
  readFileSync(file, "utf8").match(/^NAMESPACE (.+)$/m)?.[1]?.trim()
const deviceInstanceOf = (file: string): string => basename(file, extname(file))
/** POUs marked `{attribute 'obsolete' := 'msg'}` in a source file → [lowerName, {name, message}]. The attribute
 *  is parser trivia, so it's read from raw text: the pragma, then any further leading attributes, then the POU
 *  header. One entry per matched POU (the one-item-per-file layout means usually one). */
const OBSOLETE_RE =
  /\{attribute\s+'obsolete'\s*:=\s*'([^']*)'\}\s*(?:\{[^}]*\}\s*)*(?:FUNCTION_BLOCK|FUNCTION|PROGRAM|INTERFACE)\s+([A-Za-z_]\w*)/gi
/** Obsolete POUs in one source text → [lowerName, {declaredName, message}]. Pure (no I/O), so the diagnostic
 *  harnesses can reproduce the workspace scan from an in-memory repro. */
export function obsoletePousInText(text: string): [string, { name: string; message: string }][] {
  const out: [string, { name: string; message: string }][] = []
  for (const m of text.matchAll(OBSOLETE_RE)) out.push([m[2]!.toLowerCase(), { name: m[2]!, message: m[1]! }])
  return out
}
const obsoletePousOf = (file: string): [string, { name: string; message: string }][] => obsoletePousInText(readFileSync(file, "utf8"))
/** Every PROGRAM on a `.task` `Calls:` line. A task can run several (`Calls: A, B, C`), so split the
 *  comma list — the old single-`\S+` grab captured only `A,` (trailing comma) and dropped B, C. */
const taskRootsOf = (file: string): string[] =>
  (readFileSync(file, "utf8").match(/^Calls:\s+(.+)/m)?.[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

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
  return collect(root, ".library", libraryNamespaceOf)
}

/** Device-tree instance names, from each `.device` file's stem (the instance name is the filename). */
export function loadDeviceInstances(root: string): Set<string> {
  return collect(root, ".device", deviceInstanceOf)
}

/**
 * Task-entry PROGRAM names (lowercased), from each `.task` file's `Calls:` line (comma-separated when a
 * task runs several) — the PROGRAMs CODESYS
 * actually runs. Dead-code reachability seeds its roots from THESE (not every PROGRAM), so a PROGRAM that
 * is not assigned to a task (its only call commented out, "moved elsewhere") is correctly dead. Empty when
 * there is no task configuration ⇒ the reachability falls back to treating all PROGRAMs as roots (safe).
 */
export function loadTaskRoots(root: string): Set<string> {
  const out = new Set<string>()
  for (const file of walkFiles(root)) {
    if (extname(file).toLowerCase() !== ".task") continue
    try {
      for (const p of taskRootsOf(file)) out.add(p.toLowerCase())
    } catch {
      continue // unreadable .task file — skip
    }
  }
  return out
}

/** Obsolete-POU catalog for a workspace root — scans every source file's text for `{attribute 'obsolete'}`. */
function loadObsoletePous(root: string): Map<string, { name: string; message: string }> {
  const out = new Map<string, { name: string; message: string }>()
  for (const file of walkFiles(root)) {
    if (!SOURCE_EXTENSION_SET.has(extname(file).toLowerCase())) continue
    try {
      for (const [k, v] of obsoletePousOf(file)) out.set(k, v)
    } catch {
      continue // unreadable source — skip
    }
  }
  return out
}

/** Both reference-file catalogs for a workspace root — the input the unresolved-identifier check skips. */
export function loadWorkspaceRefs(root: string): WorkspaceRefs {
  if (root.length === 0) return EMPTY_WORKSPACE_REFS
  return {
    libraryNamespaces: loadLibraryNamespaces(root),
    deviceInstances: loadDeviceInstances(root),
    obsoletePous: loadObsoletePous(root),
  }
}

export interface WorkspaceScan {
  refs: WorkspaceRefs
  taskRoots: Set<string>
  sources: { path: string; source: string }[]
  /** Per-code states from the project's `.projectsettings`, or undefined when the project has none (a
   *  TwinCAT workspace, or one pulled before the bridge emitted it) ⇒ the editor's settings stand alone. */
  projectDiagnostics?: Partial<Record<ConfigurableCode, DiagnosticState>>
}

/**
 * One directory walk yielding everything the live server seeds: source files (for the disk layer),
 * reference-name skip sets, and task roots. Re-runnable — the server calls this at `initialized` and on
 * every watched-file event so `volt pull` changes are picked up without a restart.
 */
export function scanWorkspace(root: string): WorkspaceScan {
  const empty: WorkspaceScan = { refs: EMPTY_WORKSPACE_REFS, taskRoots: new Set(), sources: [] }
  let projectDiagnostics: Partial<Record<ConfigurableCode, DiagnosticState>> | undefined
  if (root.length === 0) return empty
  const libraryNamespaces = new Set<string>()
  const deviceInstances = new Set<string>()
  const taskRoots = new Set<string>()
  const obsoletePous = new Map<string, { name: string; message: string }>()
  const sources: { path: string; source: string }[] = []
  for (const file of walkFiles(root)) {
    const ext = extname(file).toLowerCase()
    try {
      if (ext === ".library") {
        const ns = libraryNamespaceOf(file)
        if (ns) libraryNamespaces.add(ns.toLowerCase())
      } else if (ext === ".device") {
        deviceInstances.add(deviceInstanceOf(file).toLowerCase())
      } else if (ext === ".projectsettings") {
        // The project's own compiler-warning configuration — see `projectDiagnosticsFrom`. One per project;
        // a second would mean two projects in one root, which the workspace model does not support anyway.
        projectDiagnostics = projectDiagnosticsFrom(readFileSync(file, "utf8"))
      } else if (ext === ".task") {
        for (const p of taskRootsOf(file)) taskRoots.add(p.toLowerCase())
      } else if (SOURCE_EXTENSION_SET.has(ext)) {
        const source = readFileSync(file, "utf8")
        sources.push({ path: file, source })
        for (const m of source.matchAll(OBSOLETE_RE)) obsoletePous.set(m[2]!.toLowerCase(), { name: m[2]!, message: m[1]! })
      }
    } catch {
      continue // unreadable file — skip
    }
  }
  return {
    refs: { libraryNamespaces, deviceInstances, obsoletePous },
    taskRoots,
    sources,
    ...(projectDiagnostics === undefined ? {} : { projectDiagnostics }),
  }
}
