/**
 * UI-agnostic actions over the volt CLI — what a renderer (volt-vscode views,
 * volt-desktop panel) calls. No UI framework: each returns data/outcomes; the caller
 * owns progress spinners and dialogs.
 *
 * Mutating actions take the per-workspace gate (so a concurrent health probe skips —
 * see `isMutationInFlight`) and release it before returning, so the caller's outcome
 * dialogs never hold the lock.
 */
import { runVolt, type ProgressUpdate } from "./cli.js"
import { withGate } from "./gate.js"
import { isBridgeOnline, readBridgeVendor, readBoundProject, vendorLabel, type HealthState, type Vendor } from "./health.js"
import { boundStatus, connectProject, detectedProjects, type DetectedProject } from "./connector.js"
import type { StatusJson } from "../view/types.js"

// ── outcome contracts (mirror the CLI's --json shape) ────────────────────────
// `status` (on ok) is the resulting drift state the CLI already computed — the caller adopts it into the
// tracker, so a pull/push is ONE bridge call (the action) with no follow-up `volt status` (/refs).
export type PullOutcome =
  | { kind: "ok"; synced: string[]; status?: StatusJson }
  | { kind: "refused"; reason: string }
  | { kind: "conflict"; paths: string[]; status?: StatusJson }
  | { kind: "error"; message: string }

export type PushOutcome =
  | { kind: "ok"; items: string[]; status?: StatusJson; message?: string }
  | { kind: "rejected"; reason: string }
  | { kind: "error"; message: string }

// `volt merge` has no --json (it's exit-code + a line); map the codes: 0 = done, 2 = markers still present.
export type MergeOutcome =
  | { kind: "done"; message: string }
  | { kind: "unresolved"; message: string }
  | { kind: "error"; message: string }

export interface StatusResult {
  status?: StatusJson
  health: HealthState
  error?: string
}

export interface CliResult {
  stdout: string
  stderr: string
  code: number
}

/** First non-blank line of CLI stderr — the human-readable reason both shells surface on a failed action. */
export function firstLine(s: string): string | undefined {
  return s
    .split(/\r?\n/)
    .find((l) => l.trim().length > 0)
    ?.trim()
}

function parseJson<T>(stdout: string): T | null {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) return null
  try {
    return JSON.parse(trimmed) as T
  } catch {
    return null
  }
}

/** Connection status (from the connector) + `volt status --json` drift (from the CLI). UI-agnostic; never throws.
 *  The split: connection status is the connector's domain; git drift needs the local repo, so it stays the CLI's. */
/** @param local Skip the IDE walk. `volt status` issues a `/refs` that enumerates the WHOLE project on the IDE's
 *  single STA thread — seconds of frozen CODESYS on a large project. Only INCOMING needs it; outgoing and merge
 *  state are pure git. So a refresh caused by a LOCAL edit passes `local: true` and leaves the IDE alone. */
export async function fetchStatus(workspaceRoot: string, local = false): Promise<StatusResult> {
  if (readBridgeVendor(workspaceRoot) === undefined) return { health: { kind: "unknown" }, error: "workspace not bound to a bridge" }
  const health = await boundStatus(workspaceRoot)
  if (!isBridgeOnline(health)) return { health, error: "bridge offline" }
  const r = await runVolt(workspaceRoot, ["status", "--json", ...(local ? ["--local"] : [])])
  if (r.code !== 0) return { health, error: r.stderr || r.stdout }
  try {
    return { health, status: JSON.parse(r.stdout) as StatusJson }
  } catch {
    return { health, error: "unparseable status output" }
  }
}

/** onProgress opts into streamed progress from the CLI (drives a real progress bar in the GUI). */
type ProgressOpt = { onProgress?: (p: ProgressUpdate) => void }

const runCli = (workspaceRoot: string, args: string[], onProgress?: (p: ProgressUpdate) => void, env?: Record<string, string>) =>
  runVolt(workspaceRoot, args, { onProgress, env })

/** `volt pull [--force]`. Takes the mutation gate; returns the parsed outcome. */
export function pull(workspaceRoot: string, opts: { force?: boolean } & ProgressOpt = {}): Promise<PullOutcome> {
  return withGate(workspaceRoot, async () => {
    const r = await runCli(
      workspaceRoot,
      ["pull", ...(opts.force ? ["--force"] : []), "--json", "--workspace", workspaceRoot],
      opts.onProgress,
    )
    return parseJson<PullOutcome>(r.stdout) ?? { kind: "error", message: firstLine(r.stderr) ?? `exit ${r.code}` }
  })
}

/** `volt push [--force]`. Takes the mutation gate; returns the parsed outcome. */
export function push(workspaceRoot: string, opts: { force?: boolean } & ProgressOpt = {}): Promise<PushOutcome> {
  return withGate(workspaceRoot, async () => {
    const r = await runCli(
      workspaceRoot,
      ["push", ...(opts.force ? ["--force"] : []), "--json", "--workspace", workspaceRoot],
      opts.onProgress,
    )
    return parseJson<PushOutcome>(r.stdout) ?? { kind: "error", message: firstLine(r.stderr) ?? `exit ${r.code}` }
  })
}

/** `volt build`. Returns the raw CLI result (the caller renders stdout/stderr). */
export function build(workspaceRoot: string, opts: ProgressOpt = {}): Promise<CliResult> {
  return runCli(workspaceRoot, ["build", "--workspace", workspaceRoot], opts.onProgress)
}

/** `volt merge --continue` — finish a resolved conflict AND advance the IDE baseline (no "pull again"). Exit 2
 *  means conflict markers still remain in some file(s). */
export function mergeContinue(workspaceRoot: string): Promise<MergeOutcome> {
  return withGate(workspaceRoot, async () => {
    const r = await runCli(workspaceRoot, ["merge", "--continue", "--workspace", workspaceRoot])
    if (r.code === 0) return { kind: "done", message: firstLine(r.stdout) ?? "merge completed" }
    if (r.code === 2) return { kind: "unresolved", message: firstLine(r.stderr) ?? "conflict markers remain" }
    return { kind: "error", message: firstLine(r.stderr) ?? `exit ${r.code}` }
  })
}

/** `volt merge --abort` — discard the in-progress merge, restore the pre-pull workspace. */
export function mergeAbort(workspaceRoot: string): Promise<MergeOutcome> {
  return withGate(workspaceRoot, async () => {
    const r = await runCli(workspaceRoot, ["merge", "--abort", "--workspace", workspaceRoot])
    return r.code === 0
      ? { kind: "done", message: firstLine(r.stdout) ?? "merge aborted" }
      : { kind: "error", message: firstLine(r.stderr) ?? `exit ${r.code}` }
  })
}

/** `volt merge --resolve <path> --use-ours|--use-theirs` — take one whole side of a single conflicted file
 *  ("mine" = ours = your workspace, "ide" = theirs = the IDE). Stages it; finish with {@link mergeContinue}. */
export function mergeResolve(workspaceRoot: string, path: string, side: "mine" | "ide"): Promise<MergeOutcome> {
  return withGate(workspaceRoot, async () => {
    const flag = side === "mine" ? "--use-ours" : "--use-theirs"
    const r = await runCli(workspaceRoot, ["merge", "--resolve", path, flag, "--workspace", workspaceRoot])
    return r.code === 0
      ? { kind: "done", message: firstLine(r.stdout) ?? `resolved ${path}` }
      : { kind: "error", message: firstLine(r.stderr) ?? `exit ${r.code}` }
  })
}

/** A CLI init result plus the workspace folder the CLI created — `volt init` makes <parent>/<project name>/ (git
 *  clone semantics), so the shells must bind/open the RETURNED path, not the parent they passed in. */
export interface InitResult extends CliResult {
  workspace?: string
}

/** `volt init --vendor <codesys|twincat> [--force]`. `parent` is WHERE to create the workspace: init makes
 *  <parent>/<project name>/ and returns it (git clone semantics); --force re-inits `parent` itself in place
 *  (rebind). Takes the mutation gate; streams progress (the first pull inside init is the slow part). */
export function init(parent: string, vendor: Vendor, opts: { force?: boolean; pipe?: string | null } & ProgressOpt = {}): Promise<InitResult> {
  // init has no binding yet, so with several CODESYS live the CLI can't resolve by project name — name the picked
  // instance's pipe via VOLT_PIPE (the connector gave us the project's pipe).
  const env = opts.pipe ? { VOLT_PIPE: opts.pipe } : undefined
  return withGate(parent, async () => {
    const r = await runCli(
      parent,
      ["init", "--vendor", vendor, ...(opts.force ? ["--force"] : []), "--json", "--workspace", parent],
      opts.onProgress,
      env,
    )
    // With --json the CLI reports {workspace} on success and {reason} on failure (stderr stays empty), so lift the
    // reason into stderr where both shells already read it via firstLine().
    const j = parseJson<{ workspace?: string; reason?: string }>(r.stdout)
    return { ...r, workspace: j?.workspace, stderr: r.stderr || j?.reason || "" }
  })
}

/** Project-centric init: the user picked a DETECTED PROJECT (not a vendor). Bind the bridge to it (best-effort —
 *  init proceeds even if the connector `/connect` is unavailable), then `volt init` with the vendor DERIVED from
 *  that project. The one init entry point the shells call — no vendor is ever passed by the UI. */
export async function initFromProject(
  project: DetectedProject,
  parent: string,
  opts: { force?: boolean } & ProgressOpt = {},
): Promise<InitResult> {
  // The connect (a bridge `select`) is CONFIRMED before we fetch — its result is not ignored. A select that
  // couldn't attach the project (e.g. picking a project that lives in a DIFFERENT IDE window than the bridge is on)
  // used to slip through: init then fetched an unselected bridge, got zero items, and the CLI reported a
  // misleading "is the project open?". Fail here, clearly, instead of racing the fetch against a half-done select.
  const connected = await connectProject(project.id)
  if (!connected) {
    const ide = vendorLabel(project.vendor)
    return {
      stdout: "",
      code: 1,
      stderr: `Couldn't attach “${project.displayName}” on the ${ide} bridge. It may have been closed, or — if you have more than one ${ide} window open — the bridge could not switch to the one holding this project. Make sure it's open, then try again.`,
    }
  }
  return init(parent, project.vendor, { ...opts, pipe: project.pipe })
}

/** Re-point the bridge at this workspace's ALREADY-bound project (the "Reconnect" action). Reopening a bound
 *  workspace doesn't re-fire `select`, so after a connector restart / IDE re-open / project switch the bridge can
 *  be serving the wrong project; this fires the same connect the desktop/VS Code do at init time, but resolved
 *  from the binding instead of a picked project. Returns a message on failure for the caller to surface. */
export async function reconnectBound(workspaceRoot: string): Promise<{ ok: boolean; message?: string }> {
  const bound = readBoundProject(workspaceRoot)
  if (bound === undefined) return { ok: false, message: "This folder isn't a Volt workspace — initialize it first." }
  const ideName = vendorLabel(bound.vendor)
  const ofVendor = (await detectedProjects()).filter((p) => p.vendor === bound.vendor)
  // Match on the binding name (projectName === health.ProjectName), NOT displayName — for TwinCAT displayName is
  // the PLC sub-project. Fall back to displayName (older connector / CODESYS) then to the sole project of the vendor.
  const match =
    ofVendor.find((p) => (p.projectName ?? p.displayName) === bound.projectName) ??
    (ofVendor.length === 1 ? ofVendor[0] : undefined)
  if (match === undefined)
    return { ok: false, message: `“${bound.projectName}” isn't detected — open it in ${ideName} and start its bridge, then Reconnect.` }
  return (await connectProject(match.id))
    ? { ok: true }
    : { ok: false, message: "The Volt Connector refused the connection — is it running?" }
}

