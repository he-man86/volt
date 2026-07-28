/**
 * The frontends' slice of the shared Volt log store — the same `%LOCALAPPDATA%\Volt\logs` folder, the same line
 * format, as the connector's C# `Log` and the bridges' `VoltLog`. One place a customer (or we) can look at the
 * WHOLE connection story in order: the connector's side (sessions, reconcile, serving transitions) and the
 * client's side (what the desktop/VS Code was looking at, and what it asked for) interleaved by timestamp.
 *
 * ALWAYS ON, deliberately. This replaced a `VOLT_BIND_DEBUG` env var that printed to a console no installed app
 * has — so the one thing worth knowing when a customer says "it connected to the wrong project" was reachable
 * only by a developer who already knew the variable existed. These events are navigations and connects, not a
 * hot path: a few lines per minute of use.
 */
import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

/** Which client is writing — becomes both the log FILE and the tag in each line (`desktop`, `vscode`). */
export type LogSource = "desktop" | "vscode"

function logDir(): string {
  const local = process.env.LOCALAPPDATA
  return join(local !== undefined && local.length > 0 ? local : tmpdir(), "Volt", "logs")
}

// `2026-07-28 14:52:03.184` — local time, matching the connector's writer so a merged read stays in order.
function stamp(d: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

/** Append one line. Never throws — a logger that can break the app is worse than no logger. Also mirrors to the
 *  console, which costs nothing and is what a `bun run`/e2e reader sees. */
export function voltLog(source: LogSource, message: string, level: "info" | "warn" = "info"): void {
  const now = new Date()
  const line = `[${stamp(now)}][${source}][${level}] ${message}`
  console.log(line)
  try {
    const dir = logDir()
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, `${source}-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}.log`), line + "\n")
  } catch {
    /* logging must never throw */
  }
}

/** The folder every Volt component logs into — the shells surface it so a customer can find/zip it. */
export const VOLT_LOG_DIR = logDir()
