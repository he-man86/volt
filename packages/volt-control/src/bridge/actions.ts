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
import { isBridgeOnline, readBridgeVendor, type HealthState, type Vendor } from "./health.js"
import { boundStatus, connectProject, type DetectedProject, type DisconnectResult } from "./connector.js"
import { declareInterest, dropInterest } from "./session.js"
import type { StatusJson } from "../view/types.js"

// The one session-lifecycle call the shells need beyond enter/leave: drop the whole session on quit/deactivate.
// (declareInterest/dropInterest stay internal — the shells go through enterWorkspace/leaveWorkspace.)
export { shutdownSession } from "./session.js"

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

/** `volt init --vendor <codesys|twincat>`. `parent` is WHERE to create the workspace: init makes
 *  <parent>/<project name>/ and returns it (git clone semantics). Takes the mutation gate; streams progress (the
 *  first pull inside init is the slow part). To re-point an existing workspace to another project, see {@link rebind}. */
export function init(parent: string, vendor: Vendor, opts: { pipe?: string | null } & ProgressOpt = {}): Promise<InitResult> {
  // init has no binding yet, so with several CODESYS live the CLI can't resolve by project name — name the picked
  // instance's pipe via VOLT_PIPE (the connector gave us the project's pipe).
  const env = opts.pipe ? { VOLT_PIPE: opts.pipe } : undefined
  return withGate(parent, async () => {
    const r = await runCli(
      parent,
      ["init", "--vendor", vendor, "--json", "--workspace", parent],
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
  opts: ProgressOpt = {},
): Promise<InitResult> {
  // The connect (a bridge `select`) is CONFIRMED before we fetch — its result is not ignored. A select that
  // couldn't attach the project (e.g. picking a project that lives in a DIFFERENT IDE window than the bridge is on)
  // used to slip through: init then fetched an unselected bridge, got zero items, and the CLI reported a
  // misleading "is the project open?". Fail here, clearly, instead of racing the fetch against a half-done select.
  const connected = await connectProject(project.id)
  if (!connected) {
    return {
      stdout: "",
      code: 1,
      stderr: `Couldn't attach “${project.displayName}”. It may have been closed, or — if more than one IDE window is open — the bridge could not switch to the one holding this project. Make sure it's open, then try again.`,
    }
  }
  return init(parent, project.vendor, { ...opts, pipe: project.pipe })
}

/** Re-point the workspace's binding to a DIFFERENT/renamed project — the reconnect list's "rebind". Reconnects the
 *  bridge to the picked project, then rewrites ONLY the config (vendor + project name). No content change, no folder
 *  rename, no re-seed — the folder, src/ and git history are untouched; the user pulls afterward to bring in the
 *  newly-bound project through the normal safe merge. */
export async function rebind(workspaceRoot: string, project: DetectedProject): Promise<{ ok: boolean; message?: string }> {
  return withGate(workspaceRoot, async () => {
    const connected = await connectProject(project.id)
    if (!connected) {
      return { ok: false, message: `Couldn't attach “${project.displayName}” — make sure it's open in your IDE, then try again.` }
    }
    const name = project.projectName ?? project.displayName
    const r = await runCli(workspaceRoot, ["rebind", "--vendor", project.vendor, "--project-name", name, "--workspace", workspaceRoot])
    return r.code === 0 ? { ok: true } : { ok: false, message: firstLine(r.stderr) ?? `exit ${r.code}` }
  })
}

/** Re-point the bridge at this workspace's ALREADY-bound project (the manual "Reconnect" action). In the session
 *  model this is just a fresh {@link enterWorkspace} — re-add the interest and force an immediate sync — so a bridge
 *  that had drifted (connector restart / IDE re-open / project switch) reconnects. Returns a message on failure. */
export async function reconnectBound(workspaceRoot: string): Promise<{ ok: boolean; message?: string }> {
  return declareInterest(workspaceRoot)
}

/** The bridge connection FOLLOWS the active project view (openspec connection-follows-active-project + the session
 *  model): a frontend calls `enterWorkspace` when a project becomes the one it's showing, `leaveWorkspace` when it
 *  stops. Both shells share this one lifecycle — only the "became active / inactive" trigger differs (desktop
 *  bind/unbind, VS Code activate/deactivate). These MUTATE the app's declared interest set; the session sync poll
 *  ships it (and against an old connector they fall back to a plain connect/disconnect). */
export async function enterWorkspace(root: string): Promise<{ ok: boolean; message?: string }> {
  return declareInterest(root)
}

/** Drop THIS workspace's project from the declared interests — the connector gates its bridge only if no other live
 *  session still wants it. Never throws (a down connector resolves to `{ok:false}`). */
export async function leaveWorkspace(root: string): Promise<DisconnectResult> {
  return dropInterest(root)
}

