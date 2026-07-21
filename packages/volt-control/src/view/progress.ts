import type { ProgressUpdate } from "../bridge/cli.js"

/**
 * Map a streamed CLI progress frame to a display %/message — the ONE place the frame→UI math lives, so every
 * surface (VS Code's `withProgress`, the desktop's IPC note, any future one) renders progress identically. A
 * shell's `onProgress` becomes a one-liner: format, then render in its native widget. Node-free (type-only).
 *
 * A multi-phase op (the CLI stamps `phaseIndex`/`phaseCount` — pull/init: fetch → write → finalize) folds the
 * per-phase `done/total` into one MONOTONIC overall bar: `(phaseIndex + done/total) / phaseCount`. That keeps a
 * single bar advancing across phases (VS Code's `withProgress` only ADDs increments, so a per-phase 0→100 reset
 * would freeze it at 100%). A single-phase frame (bare fetch/push op-count, indeterminate build) has no
 * `phaseCount`, so `done/total` alone is the bar. `message` prefers the phase label, else a `done/total` count.
 */
export function formatProgress(p: ProgressUpdate): { pct?: number; message?: string } {
  const frac = p.total !== undefined && p.total !== null && p.total > 0 ? p.done / p.total : undefined
  const pct =
    p.phaseCount != null && p.phaseCount > 0 && p.phaseIndex != null
      ? Math.floor(((p.phaseIndex + (frac ?? 0)) / p.phaseCount) * 100)
      : frac !== undefined
        ? Math.floor(frac * 100)
        : undefined
  const message = p.phase ?? (frac !== undefined ? `${p.done}/${p.total}` : undefined)
  return { pct, message }
}
