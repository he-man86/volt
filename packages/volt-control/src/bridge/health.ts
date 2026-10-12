import { readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

/**
 * The bridge-health TYPES + the bound-vendor read. Live connection status now comes from the connector
 * (`bridge/connector.ts` → `:8550`), the one aggregator — the UI no longer probes the bridge pipes itself, so
 * the old `probeHealth`/`probeVendors` pipe probes are gone. These types are still the shape callers render;
 * `connector.ts` produces a `HealthState` from the connector's per-vendor view.
 */
// The UI-facing health fields, DERIVED from a `/status` row by `connector.ts:healthStateOf`. Deliberately only the
// fields a renderer reads: the connected/degraded/unavailable distinction is the `HealthState.kind` tag (below), so
// it is NOT re-encoded here. (The old `status`/`degraded`/`degradedReason`/`ideVersion` fields were removed with the
// C# `degradedReason` wire field — they were unset or unread. The IDE identity — `ideVersion` and the product/bridge
// fields beside it — lives on each `DetectedProject` row, rendered as one line by `view/identity.ts`.)
export interface BridgeHealth {
  connected: boolean
  projectName?: string | null
  projectDirty?: boolean
}

export type HealthState =
  | { kind: "unknown" }
  | { kind: "connected"; health: BridgeHealth }
  | { kind: "degraded"; health: BridgeHealth }
  | { kind: "disconnected"; health: BridgeHealth }
  | { kind: "unreachable"; reason: string }

export function isBridgeOnline(h: HealthState): boolean {
  return h.kind === "connected" || h.kind === "degraded"
}

/** The bridge's health payload, or undefined when the state carries none (unknown / unreachable). The one place
 *  that unwraps the HealthState union, so callers read fields without repeating the kind check. */
export function healthOf(h: HealthState): BridgeHealth | undefined {
  return h.kind === "connected" || h.kind === "degraded" || h.kind === "disconnected" ? h.health : undefined
}

export type Vendor = "codesys" | "twincat"

/** The two vendors, for iterating. */
export const VENDORS: readonly Vendor[] = ["codesys", "twincat"]

// No vendor→label helper here on purpose: the UI is vendor-blind — a project is identified by its NAME, never its
// vendor. `vendor` survives only as routing/identity below the wire (which pipe `volt.bridge.<vendor>`, which LSP
// `--codesys/--twincat`, which detected project matches a saved binding), never as anything a renderer shows.

/**
 * The workspace's binding file: `<git dir>/volt/config.json`, where `volt init` writes it (`git rev-parse
 * --absolute-git-dir`, the C# `Config.Paths`). The git dir is `.git`, or — in a linked worktree or a submodule, where
 * `.git` is a FILE — the dir its `gitdir:` line names. undefined ⇒ no `.git` (not a repo, so unbound). The LSP reads
 * the same fact the same way (`volt-lsp-iec/src/workspace/binding.ts`), and every frontend reader resolves it HERE
 * (`hasVoltConfig`, `VoltStatus.refresh`, `volt.openConfig`, `readStateMtime`, the reads below): readers of one fact must agree.
 */
export function bindingFile(workspaceRoot: string): string | undefined {
  const dir = voltStateDir(workspaceRoot)
  return dir === undefined ? undefined : join(dir, "config.json")
}

/** The CLI's state dir, `<git dir>/volt` (the binding, the IDE baseline `ide-refs.json`), resolved as `bindingFile` says;
 *  undefined ⇒ no `.git`. */
export function voltStateDir(workspaceRoot: string): string | undefined {
  const dotGit = join(workspaceRoot, ".git")
  let isDir: boolean
  try {
    isDir = statSync(dotGit).isDirectory()
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT" || (e as NodeJS.ErrnoException).code === "ENOTDIR") return undefined
    throw e
  }
  if (isDir) return join(dotGit, "volt")
  const named = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, "utf8"))?.[1]
  if (named === undefined) throw new Error(`${dotGit} is a file that names no git dir (no \`gitdir:\` line)`)
  return join(resolve(workspaceRoot, named), "volt")
}

interface Binding {
  bridge?: { vendor?: unknown }
  project?: { projectName?: unknown }
}

/** The binding's JSON, or undefined when there is none (unbound). A binding file that is not JSON is refused by name. */
function readBinding(workspaceRoot: string): Binding | undefined {
  const file = bindingFile(workspaceRoot)
  if (file === undefined) return undefined
  let raw: string
  try {
    raw = readFileSync(file, "utf-8")
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT" || (e as NodeJS.ErrnoException).code === "ENOTDIR") return undefined
    throw e
  }
  try {
    return (JSON.parse(raw) as Binding | null) ?? {}
  } catch {
    throw new Error(`${file} is not JSON — re-run \`volt init --vendor <codesys|twincat>\``)
  }
}

/** The vendor a workspace is bound to (`bridge.vendor`); undefined ⇒ unbound (no binding file: not an initialized Volt
 *  workspace). A binding that states no vendor is refused by name, never read as unbound — the LSP refuses it too. */
export function readBridgeVendor(workspaceRoot: string): Vendor | undefined {
  const binding = readBinding(workspaceRoot)
  if (binding === undefined) return undefined
  const vendor = binding.bridge?.vendor
  if (vendor === "codesys" || vendor === "twincat") return vendor
  throw new Error(`${bindingFile(workspaceRoot)} states no vendor (bridge.vendor is ${JSON.stringify(vendor)}) — re-run \`volt init --vendor <codesys|twincat>\``)
}

/** The identity a workspace is bound to — vendor + the name the binding matches the IDE's project on. */
export interface BoundProject {
  vendor: Vendor
  projectName: string
}

/** The project a workspace is bound to (`.git/volt/config.json`: vendor + projectName), for re-pointing the
 *  bridge at it. undefined ⇒ unbound / malformed. */
export function readBoundProject(workspaceRoot: string): BoundProject | undefined {
  const vendor = readBridgeVendor(workspaceRoot)
  if (vendor === undefined) return undefined
  const projectName = readBinding(workspaceRoot)?.project?.projectName
  if (typeof projectName === "string" && projectName.length > 0) return { vendor, projectName }
  return undefined
}
