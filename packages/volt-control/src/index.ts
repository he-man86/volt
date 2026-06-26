/**
 * @opencode-ai/volt-control — UI-agnostic core that drives the `volt` CLI / bridge.
 *
 * STUB. The logic is *extracted* from `packages/volt-vscode` in Phase 1 (see README) so it
 * can be rendered by BOTH `volt-vscode` (VS Code views) and `volt-app` (Solid panel in the
 * opencode desktop app). Nothing here talks to a UI framework.
 *
 * Extraction map (`packages/volt-vscode/src` → here):
 *   cli.ts · workspace.ts · state/health.ts · gate.ts · types.ts   → move verbatim (already pure)
 *   state/status.ts · commands.ts                                  → split: pure logic moves here,
 *                                                                     the `vscode` presentation stays put
 */

export type HealthState = "online" | "offline" | "unknown"

// TODO Phase 1: replace with the real shape from volt-vscode/src/types.ts
export interface StatusJson {
  [key: string]: unknown
}

export interface VoltContext {
  /** Workspace root (the `.volt/` project dir). */
  cwd: string
  /** Path to the `volt` bin; defaults to resolving `volt` on PATH. */
  voltBin?: string
}

export interface RunResult {
  ok: boolean
  output: string
}

const NOT_IMPL = "volt-control: not implemented yet — Phase 1 (see packages/volt-control/README.md)"

/** Detect a Volt workspace at/above `cwd`. (← volt-vscode/src/workspace.ts) */
export function detectWorkspace(_cwd: string): { root: string } | null {
  throw new Error(NOT_IMPL)
}

/** Bridge health probe. (← volt-vscode/src/state/health.ts) */
export async function getHealth(_ctx: VoltContext): Promise<HealthState> {
  throw new Error(NOT_IMPL)
}

/** `volt status --json`, parsed. (← refactored from volt-vscode/src/state/status.ts) */
export async function getStatus(_ctx: VoltContext): Promise<StatusJson> {
  throw new Error(NOT_IMPL)
}

/** `volt pull`. (← refactored from volt-vscode/src/commands.ts) */
export async function pull(_ctx: VoltContext, _flags?: string[]): Promise<RunResult> {
  throw new Error(NOT_IMPL)
}

/** `volt push`. (← refactored from volt-vscode/src/commands.ts) */
export async function push(_ctx: VoltContext, _flags?: string[]): Promise<RunResult> {
  throw new Error(NOT_IMPL)
}

/** `volt build` → diagnostics JSON. (← refactored from volt-vscode/src/commands.ts) */
export async function build(_ctx: VoltContext): Promise<{ ok: boolean; diagnostics: unknown[] }> {
  throw new Error(NOT_IMPL)
}
