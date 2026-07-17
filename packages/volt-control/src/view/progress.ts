import type { ProgressUpdate } from "../bridge/cli.js"

/**
 * Map a streamed CLI progress frame to a display %/message — the ONE place the frame→UI math lives, so every
 * surface (VS Code's `withProgress`, the desktop's IPC note, any future one) renders progress identically. A
 * shell's `onProgress` becomes a one-liner: format, then render in its native widget. Node-free (type-only).
 *
 * `pct` is 0–100 when a total is known (an indeterminate phase has none). `message` prefers the phase label,
 * else a `done/total` count.
 */
export function formatProgress(p: ProgressUpdate): { pct?: number; message?: string } {
  const pct = p.total !== undefined && p.total !== null && p.total > 0 ? Math.floor((p.done / p.total) * 100) : undefined
  const message = p.phase ?? (pct !== undefined ? `${p.done}/${p.total}` : undefined)
  return { pct, message }
}
