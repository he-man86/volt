/**
 * Workspace scan (node I/O — app tier, above the pure analysis layers).
 *
 * `volt pull` mirrors the IDE project as text files. This module crawls that tree once and returns:
 *
 *   - **source files** (`.pou`/`.itf`/`.gvl`/`.dut`) — the
 *     units the binder cross-indexes, so a type declared in an unopened file still resolves.
 *   - **what the symbol table binds beside the sources** (`WorkspaceRefs`):
 *       - `.library` manifests — each library's NAMESPACE, DEPENDENCIES and RESOLUTION (`bindLibraryNamespaces`);
 *       - `.device` descriptors — each named after a device-tree instance the source may read bare (`ingestDevices`,
 *         rule Y24). They were a skip SET the analysis read, beside the search order; the binder binds them now, so
 *         the search order (`types/names` `resolveBareName`) is the one answer.
 *   - **task roots** — the `.task` `Calls:` PROGRAM names (comma-separated) dead-code reachability seeds from.
 *
 * Unreadable files/dirs are skipped, never thrown ⇒ an empty scan means "nothing known", which degrades safely. The
 * server's scans say which files — and folders they could not list — they could not read for a reason other than their
 * absence (`unreadable`): EBUSY or EPERM while the CLI or the IDE is still writing one, or a folder the user may not
 * list, is no fact about it, and the server keeps what it last read.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { basename, extname, join } from "node:path"
import { projectDiagnosticsFrom, type ConfigurableCode, type DiagnosticState } from "../analysis/index.js"
import { parseLibraryManifest, type LibraryManifest } from "../frontend/library/index.js"
import type { DeviceInstance } from "../frontend/symbols/index.js"
import type { CompileEnvironment, Target } from "../frontend/syntax/index.js"

/** What a workspace holds beside its sources that the symbol table binds: the referenced libraries' manifests, the
 *  device tree's instances, and the compilation target where a device descriptor names one whose width is measured. */
export interface WorkspaceRefs {
  libraryManifests: readonly LibraryManifest[]
  devices: readonly DeviceInstance[]
  target?: Target
}

/**
 * THE DEVICES WHOSE POINTER WIDTH IS MEASURED, by the `Name:` their `.device` descriptor states — the only way a pulled
 * workspace says what it compiles for. `CODESYS Control Win V3 x64` is the exec oracle's device and the CODESYS recording
 * project's (`test-corpus/CodesysTestProject`): `__XINT` is LINT there (`plat_*`, `ty_xint_twincat_width`). Every other
 * device is unmeasured — the Lenze `Controller c520` of four corpora among them — and a workspace on one has no target:
 * its platform integers resolve to nothing rather than to a guessed width (frontend-conformance 4.1.1). A TwinCAT
 * workspace has no descriptor at all.
 */
const MEASURED_DEVICE_TARGETS: ReadonlyMap<string, Target> = new Map([["CODESYS Control Win V3 x64", { pointerBits: 64 }]])

/** The target the device descriptors' names give: the one measured device's, or undefined when none is measured — or
 *  two measured devices disagree, which no single-application workspace can mean. */
function targetOfDevices(deviceNames: readonly string[]): Target | undefined {
  const targets = new Set(deviceNames.flatMap((n) => MEASURED_DEVICE_TARGETS.get(n) ?? []))
  return targets.size === 1 ? [...targets][0] : undefined
}

/** The environment the server binds a workspace's project in: its target, where known. */
export function workspaceEnvironment(refs: WorkspaceRefs): CompileEnvironment | undefined {
  return refs.target === undefined ? undefined : { target: refs.target }
}

/** A `.device` descriptor's `Name:` line. */
const deviceNameOf = (file: string): string | undefined => readFileSync(file, "utf8").match(/^Name:\s*(.+?)\s*$/m)?.[1]

/** No workspace reference files known. */
export const EMPTY_WORKSPACE_REFS: WorkspaceRefs = { libraryManifests: [], devices: [] }
import { SOURCE_EXTENSION_SET, SOURCE_EXTENSIONS } from "./source-extensions.js"

/** The extensions of the reference files: the scanned ones that are no source. */
export const REFERENCE_EXTENSIONS: ReadonlySet<string> = new Set([".library", ".device", ".projectsettings", ".task"])

/** Every extension `scanWorkspace` reads — the sources and the reference files beside them. The server watches exactly
 *  these: a file the scan reads and no watcher reports is a change the running server never sees. */
export const SCANNED_EXTENSIONS: readonly string[] = [...SOURCE_EXTENSIONS, ...REFERENCE_EXTENSIONS]

const withTarget = (target: Target | undefined): { target?: Target } => (target === undefined ? {} : { target })

/** All files under `root`, recursively — never under `.git`, the repository `volt init` makes of the workspace, which holds
 *  no item of it. A folder that cannot be listed, or an entry that cannot be stat'ed, is skipped, not thrown — and,
 *  unless it is gone (ENOENT), named in `unlisted`: what is under it is unknown, never absent. */
function walkFiles(root: string, unlisted: Unreadable[]): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch (e) {
    const code = ioFailure(e)
    if (code !== undefined) unlisted.push({ path: root, code })
    return out
  }
  for (const name of entries) {
    if (name === ".git") continue
    const p = join(root, name)
    let dir = false
    try {
      dir = statSync(p).isDirectory()
    } catch (e) {
      const code = ioFailure(e)
      if (code !== undefined) unlisted.push({ path: p, code })
      continue
    }
    if (dir) out.push(...walkFiles(p, unlisted))
    else out.push(p)
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

// ─── per-extension name extractors (read by RefCollector) ───
/** A `.device` descriptor's instance — the pull names the file after it. */
const deviceInstanceOf = (file: string): DeviceInstance => ({ kind: "device", name: basename(file, extname(file)), uri: file })
/** Every PROGRAM on a `.task` `Calls:` line. A task can run several (`Calls: A, B, C`), so split the
 *  comma list — the old single-`\S+` grab captured only `A,` (trailing comma) and dropped B, C. */
const taskRootsOf = (file: string): string[] =>
  (readFileSync(file, "utf8").match(/^Calls:\s+(.+)/m)?.[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

/** What a workspace holds beside its sources — the WHOLE reference state, which a `.task`, `.library`, `.device` or
 *  `.projectsettings` event, or a directory event, replaces in one piece (openspec lsp-server-scheduling). */
export interface WorkspaceRefScan {
  refs: WorkspaceRefs
  taskRoots: Set<string>
  /** Per-code states from the project's `.projectsettings`, or undefined when the project has none (a
   *  TwinCAT workspace, or one pulled before the bridge emitted it) ⇒ the editor's settings stand alone. */
  projectDiagnostics?: Partial<Record<ConfigurableCode, DiagnosticState>>
  /** Every reference file read, by path — what tells a deleted folder that held one (a host may send ONE event for it). */
  paths: string[]
  /** The reference files that exist and could not be read (EBUSY, EPERM…): a scan with one is NOT the whole reference
   *  state — dropping that file's library, settings or task roots would be a guess, not a fact. */
  unreadable: Unreadable[]
}

/** A file that exists and could not be read, with the I/O code that said so. */
export interface Unreadable {
  path: string
  code: string
}

interface WorkspaceScan extends WorkspaceRefScan {
  sources: { path: string; source: string }[]
  /** The source files that exist and could not be read. */
  unreadableSources: Unreadable[]
}

/** The I/O code of a read failure that is no fact about the file — anything but ENOENT (the file is gone) — or
 *  undefined: a gone file, or a throw that is no I/O failure (a manifest that does not parse), skipped as before. */
const ioFailure = (e: unknown): string | undefined => {
  const code = (e as NodeJS.ErrnoException | undefined)?.code
  return typeof code === "string" && code !== "ENOENT" ? code : undefined
}


/** Collects the reference files one walk meets. */
class RefCollector {
  private readonly libraryManifests: LibraryManifest[] = []
  private readonly devices: DeviceInstance[] = []
  private readonly deviceNames: string[] = []
  private readonly taskRoots = new Set<string>()
  private readonly paths: string[] = []
  private projectDiagnostics: Partial<Record<ConfigurableCode, DiagnosticState>> | undefined

  /** Read `file` when it is a reference file (`ext` EXACT — see `scanWorkspace`); false when it is not one. */
  read(file: string, ext: string): boolean {
    if (!REFERENCE_EXTENSIONS.has(ext)) return false
    this.paths.push(file)
    if (ext === ".library") {
      const manifest = parseLibraryManifest(file, readFileSync(file, "utf8"))
      if (manifest !== undefined) this.libraryManifests.push(manifest)
    } else if (ext === ".device") {
      this.devices.push(deviceInstanceOf(file))
      const name = deviceNameOf(file)
      if (name !== undefined) this.deviceNames.push(name)
    } else if (ext === ".projectsettings") {
      // The project's own compiler-warning configuration — see `projectDiagnosticsFrom`. One per project;
      // a second would mean two projects in one root, which the workspace model does not support anyway.
      this.projectDiagnostics = projectDiagnosticsFrom(readFileSync(file, "utf8"))
    } else {
      for (const p of taskRootsOf(file)) this.taskRoots.add(p.toLowerCase())
    }
    return true
  }

  result(): Omit<WorkspaceRefScan, "unreadable"> {
    return {
      refs: { libraryManifests: this.libraryManifests, devices: this.devices, ...withTarget(targetOfDevices(this.deviceNames)) },
      taskRoots: this.taskRoots,
      paths: this.paths,
      ...(this.projectDiagnostics === undefined ? {} : { projectDiagnostics: this.projectDiagnostics }),
    }
  }
}

/**
 * One directory walk yielding everything the live server seeds: source files (for the disk layer),
 * reference-name skip sets, and task roots. The server runs it once, at `initialized`; a watched event after that
 * re-reads one source (`readSourceText`) or the references alone (`scanWorkspaceRefs`).
 */
export function scanWorkspace(root: string): WorkspaceScan {
  if (root.length === 0)
    return { refs: EMPTY_WORKSPACE_REFS, taskRoots: new Set(), sources: [], paths: [], unreadable: [], unreadableSources: [] }
  const refs = new RefCollector()
  const sources: { path: string; source: string }[] = []
  const unreadable: Unreadable[] = []
  const unreadableSources: Unreadable[] = []
  const unlisted: Unreadable[] = []
  for (const file of walkFiles(root, unlisted)) {
    // EXACT, never case-folded — here and in every loader above. A file name IS its item's wire name, and the
    // CLI classifies an extension Ordinally: `E_Mode.Dut` is a foreign file `volt push` refuses, not the
    // `E_Mode.dut` the IDE publishes. Folded, the LSP indexed it as a source unit and resolved names from a file
    // Volt will never push.
    const ext = extname(file)
    try {
      if (!refs.read(file, ext) && SOURCE_EXTENSION_SET.has(ext)) sources.push({ path: file, source: readSourceText(file) })
    } catch (e) {
      const code = ioFailure(e)
      if (code !== undefined) (REFERENCE_EXTENSIONS.has(ext) ? unreadable : unreadableSources).push({ path: file, code })
    }
  }
  // A path the walk could not list or stat may be (or hold) either kind: named in each list its extension allows.
  for (const u of unlisted) {
    const ext = extname(u.path)
    if (!SOURCE_EXTENSION_SET.has(ext)) unreadable.push(u)
    if (!REFERENCE_EXTENSIONS.has(ext)) unreadableSources.push(u)
  }
  return { ...refs.result(), unreadable, sources, unreadableSources }
}

/** The reference files alone — one walk that reads no source: what a reference-file or directory event re-runs. */
export function scanWorkspaceRefs(root: string): WorkspaceRefScan {
  const refs = new RefCollector()
  const unreadable: Unreadable[] = []
  if (root.length === 0) return { ...refs.result(), unreadable } // no root: nothing known (`walkFiles("")` would walk the working directory)
  const unlisted: Unreadable[] = []
  for (const file of walkFiles(root, unlisted)) {
    try {
      refs.read(file, extname(file))
    } catch (e) {
      const code = ioFailure(e)
      if (code !== undefined) unreadable.push({ path: file, code })
    }
  }
  unreadable.push(...unlisted.filter((u) => !SOURCE_EXTENSION_SET.has(extname(u.path)))) // a folder may hold one
  return { ...refs.result(), unreadable }
}

/** The source files under `dir` (a folder a watched event named), by path, unread — and what under it could not be
 *  listed (`unlisted`): the sources there are unknown, not gone. */
export function sourceFilesUnder(dir: string): { files: string[]; unlisted: Unreadable[] } {
  const unlisted: Unreadable[] = []
  const files = walkFiles(dir, unlisted).filter((file) => SOURCE_EXTENSION_SET.has(extname(file)))
  return { files, unlisted: unlisted.filter((u) => !REFERENCE_EXTENSIONS.has(extname(u.path))) }
}
