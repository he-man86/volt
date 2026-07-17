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
import { probeHealth, isBridgeOnline, readBridgePort, type HealthState } from "./health.js"
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
  | { kind: "ok"; items: string[]; status?: StatusJson }
  | { kind: "rejected"; reason: string }
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

/** Probe the bridge, then `volt status --json`. UI-agnostic; never throws. */
export async function fetchStatus(workspaceRoot: string, port?: number): Promise<StatusResult> {
  const p = port ?? readBridgePort(workspaceRoot)
  if (p === undefined) return { health: { kind: "unknown" }, error: "no bridge port in config" }
  const health = await probeHealth(p, 2000)
  if (!isBridgeOnline(health)) return { health, error: "bridge offline" }
  const r = await runVolt(workspaceRoot, ["status", "--json", "--port", String(p)])
  if (r.code !== 0) return { health, error: r.stderr || r.stdout }
  try {
    return { health, status: JSON.parse(r.stdout) as StatusJson }
  } catch {
    return { health, error: "unparseable status output" }
  }
}

/** onProgress opts into streamed progress from the CLI (drives a real progress bar in the GUI). */
type ProgressOpt = { onProgress?: (p: ProgressUpdate) => void }

const runCli = (workspaceRoot: string, args: string[], onProgress?: (p: ProgressUpdate) => void) =>
  runVolt(workspaceRoot, args, { onProgress })

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

/** `volt init --port <port> [--force]`. Takes the mutation gate; streams progress when `onProgress` is set
 *  (parity with pull/push/build — the first pull inside init is the slow part on a large project). */
export function init(workspaceRoot: string, port: number, opts: { force?: boolean } & ProgressOpt = {}): Promise<CliResult> {
  return withGate(workspaceRoot, () =>
    runCli(
      workspaceRoot,
      ["init", "--port", String(port), ...(opts.force ? ["--force"] : []), "--workspace", workspaceRoot],
      opts.onProgress,
    ),
  )
}

