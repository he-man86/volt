/**
 * Workspace scan (node I/O — app tier, above the pure analysis layers).
 *
 * `volt pull` mirrors the IDE project as text files. This module crawls that tree once and returns:
 *
 *   - **source files** (`.fb`/`.prg`/`.fun`/`.itf`/`.gvl`/`.dut`) — the
 *     units the binder cross-indexes, so a type declared in an unopened file still resolves.
 *   - **what the symbol table binds beside the sources** (`WorkspaceRefs`):
 *       - `.library` manifests — each library's NAMESPACE, DEPENDENCIES and RESOLUTION (`bindLibraryNamespaces`);
 *       - `.device` descriptors — each named after a device-tree instance the source may read bare (`ingestDevices`,
 *         rule Y24). They were a skip SET the analysis read, beside the search order; the binder binds them now, so
 *         the search order (`types/names` `resolveBareName`) is the one answer.
 *   - **task roots** — the `.task` `Calls:` PROGRAM names (comma-separated) dead-code reachability seeds from.
 *
 * Unreadable files/dirs are skipped, never thrown ⇒ an empty scan means "nothing known", which degrades safely.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { basename, extname, join } from "node:path"
import { projectDiagnosticsFrom, type ConfigurableCode, type DiagnosticState } from "./analysis/index.js"
import { parseLibraryManifest, type LibraryManifest } from "./frontend/library/index.js"
import type { DeviceInstance } from "./frontend/symbols/index.js"

/** What a workspace holds beside its sources that the symbol table binds: the referenced libraries' manifests and the
 *  device tree's instances. */
export interface WorkspaceRefs {
  libraryManifests: readonly LibraryManifest[]
  devices: readonly DeviceInstance[]
}

/** No workspace reference files known. */
export const EMPTY_WORKSPACE_REFS: WorkspaceRefs = { libraryManifests: [], devices: [] }
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

/** Every referenced library's manifest under `root` — what binds its units under the NAMESPACE the source writes
 *  (`bindLibraryNamespaces`). Separate from the source walk: a `.library` file is not ST and never parses as one. */
export function scanLibraryManifests(root: string): LibraryManifest[] {
  const out: LibraryManifest[] = []
  for (const file of walkFiles(root)) {
    if (extname(file) !== ".library") continue
    try {
      const manifest = parseLibraryManifest(file, readFileSync(file, "utf8"))
      if (manifest !== undefined) out.push(manifest)
    } catch {
      continue
    }
  }
  return out
}

/**
 * A workspace source file's TEXT, as the push sends it: its bytes decoded as UTF-8 with a leading BOM removed. A BOM
 * is a file-encoding mark, never content — Visual Studio and TcXaeShell save UTF-8 with one by default — and the CLI
 * strips it at the one place a workspace file's bytes become text for the IDE (`Commands.cs` HeadSrc). `readFileSync`
 * keeps it, and in front of a DUT's `TYPE` or a GVL's `VAR_GLOBAL` it made the file declare nothing.
 */
export function readSourceText(file: string): string {
  const text = readFileSync(file, "utf8")
  return text.replace(/^﻿+/, "") // EVERY leading BOM, as the push's HeadSrc `TrimStart('﻿')` does
}

// ─── per-extension name extractors (shared by the single-file loaders + scanWorkspace) ───
/** A `.device` descriptor's instance — the pull names the file after it. */
const deviceInstanceOf = (file: string): DeviceInstance => ({ kind: "device", name: basename(file, extname(file)), uri: file })
/** Every PROGRAM on a `.task` `Calls:` line. A task can run several (`Calls: A, B, C`), so split the
 *  comma list — the old single-`\S+` grab captured only `A,` (trailing comma) and dropped B, C. */
const taskRootsOf = (file: string): string[] =>
  (readFileSync(file, "utf8").match(/^Calls:\s+(.+)/m)?.[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

/** The device tree's instances, one per `.device` descriptor (the instance name is the file's stem). */
export function loadDeviceInstances(root: string): DeviceInstance[] {
  return walkFiles(root).filter((file) => extname(file) === ".device").map(deviceInstanceOf)
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
    if (extname(file) !== ".task") continue
    try {
      for (const p of taskRootsOf(file)) out.add(p.toLowerCase())
    } catch {
      continue // unreadable .task file — skip
    }
  }
  return out
}

/** Both reference-file catalogs for a workspace root — the input the unresolved-identifier check skips. */
export function loadWorkspaceRefs(root: string): WorkspaceRefs {
  // The refs half of the server's own one-walk scan. It was four walks (one per catalog) and a second read of every
  // source: 10.2 s over the six corpora against 5.2 s for the scan (measured 2026-10-01), for the identical catalogs.
  return scanWorkspace(root).refs
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
  const libraryManifests: LibraryManifest[] = []
  const devices: DeviceInstance[] = []
  const taskRoots = new Set<string>()
  const sources: { path: string; source: string }[] = []
  for (const file of walkFiles(root)) {
    // EXACT, never case-folded — here and in every loader above. A file name IS its item's wire name, and the
    // CLI classifies an extension Ordinally: `E_Mode.Dut` is a foreign file `volt push` refuses, not the
    // `E_Mode.dut` the IDE publishes. Folded, the LSP indexed it as a source unit and resolved names from a file
    // Volt will never push.
    const ext = extname(file)
    try {
      if (ext === ".library") {
        const manifest = parseLibraryManifest(file, readFileSync(file, "utf8"))
        if (manifest !== undefined) libraryManifests.push(manifest)
      } else if (ext === ".device") {
        devices.push(deviceInstanceOf(file))
      } else if (ext === ".projectsettings") {
        // The project's own compiler-warning configuration — see `projectDiagnosticsFrom`. One per project;
        // a second would mean two projects in one root, which the workspace model does not support anyway.
        projectDiagnostics = projectDiagnosticsFrom(readFileSync(file, "utf8"))
      } else if (ext === ".task") {
        for (const p of taskRootsOf(file)) taskRoots.add(p.toLowerCase())
      } else if (SOURCE_EXTENSION_SET.has(ext)) {
        const source = readSourceText(file)
        sources.push({ path: file, source })
      }
    } catch {
      continue // unreadable file — skip
    }
  }
  return {
    refs: { libraryManifests, devices },
    taskRoots,
    sources,
    ...(projectDiagnostics === undefined ? {} : { projectDiagnostics }),
  }
}
