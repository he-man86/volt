/**
 * UI-agnostic actions over the volt CLI — what a renderer (volt-vscode views,
 * volt-app panel) calls. No UI framework: each returns data/outcomes; the caller
 * owns progress spinners and dialogs.
 *
 * Mutating actions take the per-workspace gate (so a concurrent health probe skips —
 * see `isMutationInFlight`) and release it before returning, so the caller's outcome
 * dialogs never hold the lock.
 */
import { spawnVolt, spawnVoltBuffer } from "./cli.js"
import { withGate } from "./gate.js"
import { probeHealth, isBridgeOnline, readBridgePort, type HealthState } from "./health.js"
import type { StatusJson } from "./types.js"

// ── outcome contracts (mirror the CLI's --json shape) ────────────────────────
export type PullOutcome =
  | { kind: "ok"; synced: string[] }
  | { kind: "refused"; reason: string }
  | { kind: "conflict"; paths: string[] }
  | { kind: "error"; message: string }

export type PushOutcome =
  | { kind: "ok"; items: string[] }
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

function firstLine(s: string): string | undefined {
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
  const r = await spawnVolt(workspaceRoot, ["status", "--json", "--port", String(p)])
  if (r.code !== 0) return { health, error: r.stderr || r.stdout }
  try {
    return { health, status: JSON.parse(r.stdout) as StatusJson }
  } catch {
    return { health, error: "unparseable status output" }
  }
}

/** `volt pull [--force]`. Takes the mutation gate; returns the parsed outcome. */
export function pull(workspaceRoot: string, opts: { force?: boolean } = {}): Promise<PullOutcome> {
  return withGate(workspaceRoot, async () => {
    const r = await spawnVolt(workspaceRoot, ["pull", ...(opts.force ? ["--force"] : []), "--json", "--workspace", workspaceRoot])
    return parseJson<PullOutcome>(r.stdout) ?? { kind: "error", message: firstLine(r.stderr) ?? `exit ${r.code}` }
  })
}

/** `volt push [--force]`. Takes the mutation gate; returns the parsed outcome. */
export function push(workspaceRoot: string, opts: { force?: boolean } = {}): Promise<PushOutcome> {
  return withGate(workspaceRoot, async () => {
    const r = await spawnVolt(workspaceRoot, ["push", ...(opts.force ? ["--force"] : []), "--json", "--workspace", workspaceRoot])
    return parseJson<PushOutcome>(r.stdout) ?? { kind: "error", message: firstLine(r.stderr) ?? `exit ${r.code}` }
  })
}

/** `volt build`. Returns the raw CLI result (the caller renders stdout/stderr). */
export function build(workspaceRoot: string): Promise<CliResult> {
  return spawnVolt(workspaceRoot, ["build", "--workspace", workspaceRoot])
}

/** `volt init --port <port> [--force]`. Takes the mutation gate. */
export function init(workspaceRoot: string, port: number, opts: { force?: boolean } = {}): Promise<CliResult> {
  return withGate(workspaceRoot, () =>
    spawnVolt(workspaceRoot, ["init", "--port", String(port), ...(opts.force ? ["--force"] : []), "--workspace", workspaceRoot]),
  )
}

/** `volt merge <args>` (--continue / --abort / --resolve / --use-ours|theirs). */
export function mergeCmd(workspaceRoot: string, args: string[]): Promise<CliResult> {
  return spawnVolt(workspaceRoot, ["merge", ...args, "--workspace", workspaceRoot])
}

/** `volt show <ref> <rel>` → raw bytes (for restoring a file). */
export function showFile(workspaceRoot: string, ref: string, rel: string): Promise<{ stdout: Buffer; stderr: string; code: number }> {
  return spawnVoltBuffer(workspaceRoot, ["show", ref, rel, "--workspace", workspaceRoot])
}

// ── history ──────────────────────────────────────────────────────────────────
export interface LogEntry {
  sha: string
  date: string
  summary: string
  paths: string[]
}

/** `volt log --json --limit N` → snapshot history (newest first). Never throws. */
export async function log(workspaceRoot: string, opts: { limit?: number } = {}): Promise<LogEntry[]> {
  const r = await spawnVolt(workspaceRoot, ["log", "--json", "--limit", String(opts.limit ?? 50), "--workspace", workspaceRoot])
  if (r.code !== 0) return []
  return parseJson<LogEntry[]>(r.stdout) ?? []
}

/** Cheap check: does this dir have an initialized `.git/volt` Volt workspace? (no bridge probe) */
export function detect(workspaceRoot: string): boolean {
  return readBridgePort(workspaceRoot) !== undefined
}
