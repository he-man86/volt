/**
 * Headless LSP-diagnostics collector — the vscode-free core behind the "Diagnostics" section.
 *
 * The VS Code extension reads diagnostics from the editor's own LSP client; a desktop shell has no
 * editor, so it drives `volt-lsp-iec` directly. The server supports pull diagnostics
 * (`workspaceDiagnostics: true`), so one `workspace/diagnostic` request returns every source file's
 * diagnostics after the server's own workspace crawl — no per-file `didOpen`, no settle heuristics.
 *
 * Pure over Node + the LSP protocol libs (no `vscode`), so the desktop and — later — the extension
 * can share one collector.
 */
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
// The node build (stdio stream readers + connection). nodenext needs the explicit `.js` on the subpath.
import { StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node.js"
import {
  createProtocolConnection,
  InitializeRequest,
  InitializedNotification,
  WorkspaceDiagnosticRequest,
  ExitNotification,
  DiagnosticSeverity,
  DocumentDiagnosticReportKind,
  type Diagnostic,
} from "vscode-languageserver-protocol/node.js"

const SOURCE = "volt-lsp-iec" // the server tags its diagnostics with this — the precise Volt filter

export interface FileDiag { path: string; errors: number; warnings: number }
export interface DiagnosticsResult { errors: number; warnings: number; files: FileDiag[] }

// ── pure helper (unit-tested; the LSP round-trip is exercised live) ──────────
/** Count Volt errors/warnings in one file's diagnostics, ignoring other sources. */
export function countDiagnostics(diagnostics: Diagnostic[]): { errors: number; warnings: number } {
  let errors = 0
  let warnings = 0
  for (const d of diagnostics) {
    if (d.source !== undefined && d.source !== SOURCE) continue
    if (d.severity === DiagnosticSeverity.Error) errors++
    else if (d.severity === DiagnosticSeverity.Warning) warnings++
  }
  return { errors, warnings }
}

// ── server resolution ────────────────────────────────────────────────────────
let serverModule: string | undefined
/** Point the collector at volt-lsp-iec's stdio entry (dist/src/bin.js). Set once by the host. */
export function setLspServer(path: string): void {
  if (existsSync(path)) serverModule = path
}
function resolveServer(workspaceRoot: string): string | undefined {
  const candidates = [
    serverModule,
    join(workspaceRoot, "node_modules", "@volt", "lsp-iec", "dist", "src", "bin.js"),
  ].filter((p): p is string => p !== undefined)
  return candidates.find((p) => existsSync(p))
}

/**
 * Spawn volt-lsp-iec, pull workspace diagnostics, and aggregate per-file error/warning counts.
 * Throws only if the server module can't be found or the request times out (the caller shows that).
 */
export async function collectDiagnostics(
  workspaceRoot: string,
  vendor: "codesys" | "twincat" = "codesys",
  opts: { timeoutMs?: number } = {},
): Promise<DiagnosticsResult> {
  const server = resolveServer(workspaceRoot)
  if (server === undefined) throw new Error("volt-lsp-iec server not found — build it or call setLspServer()")

  // A `.js` server runs via the host runtime (ELECTRON_RUN_AS_NODE); a compiled `.exe` (the desktop install
  // ships volt-lsp-iec.exe) spawns directly. Same .js/.exe split as the CLI spawn.
  const lspArgs = ["--stdio", vendor === "twincat" ? "--twincat" : "--codesys"]
  const asNode = server.toLowerCase().endsWith(".js")
  const child = spawn(asNode ? process.execPath : server, asNode ? [server, ...lspArgs] : lspArgs, {
    // Capture stderr, don't discard it: a server that can't launch or crashes on startup must SURFACE its reason,
    // not read as a silent 30s timeout indistinguishable from a slow crawl (the desktop's mystery "timed out").
    env: asNode ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" } : { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  })
  let stderr = ""
  child.stderr?.on("data", (d) => (stderr = (stderr + d).slice(-4000))) // keep the tail so an error names its cause

  const conn = createProtocolConnection(new StreamMessageReader(child.stdout!), new StreamMessageWriter(child.stdin!))
  // A real LSP client answers these server→client requests; a raw one that ignores them can deadlock the
  // server (it waits for config before analyzing). Return defaults so analysis proceeds.
  conn.onRequest("workspace/configuration", (p: { items?: unknown[] }) => (p.items ?? [{}]).map(() => ({})))
  conn.onRequest("client/registerCapability", () => null)
  conn.onRequest("window/workDoneProgress/create", () => null)
  conn.listen()

  const timeoutMs = opts.timeoutMs ?? 30_000
  const tail = (): string => (stderr.trim() ? ` — ${stderr.trim().slice(-500)}` : "")
  const byUri = new Map<string, { errors: number; warnings: number }>()
  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  // Fail FAST + LOUD: a spawn error (ENOENT / a bad exe) or an early exit rejects with the reason instead of
  // hanging until the timeout; the timeout itself now names the server path + stderr tail.
  const died = new Promise<never>((_, reject) => {
    child.once("error", (err) => { if (!settled) reject(new Error(`couldn't launch the language server (${server}): ${err.message}`)) })
    child.once("exit", (code, signal) => {
      if (!settled) reject(new Error(`the language server exited before answering (${server}; code ${code ?? "null"}${signal ? `, ${signal}` : ""})${tail()}`))
    })
  })
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`diagnostics timed out after ${timeoutMs}ms (server: ${server})${tail()}`)), timeoutMs)
  })
  try {
    const work = (async () => {
      await conn.sendRequest(InitializeRequest.type, {
        processId: process.pid,
        rootUri: pathToFileURL(workspaceRoot).toString(),
        capabilities: { workspace: { diagnostics: { refreshSupport: false } } },
        initializationOptions: { vendor },
      })
      conn.sendNotification(InitializedNotification.type, {}) // triggers the server's workspace crawl (sync)
      const report = await conn.sendRequest(WorkspaceDiagnosticRequest.type, { previousResultIds: [] })
      for (const item of report.items) {
        if (item.kind === DocumentDiagnosticReportKind.Full) byUri.set(item.uri, countDiagnostics(item.items))
      }
    })()
    await Promise.race([work, died, timedOut])
  } finally {
    settled = true // stop died/timedOut from rejecting during teardown (the kill below fires 'exit')
    if (timer) clearTimeout(timer)
    // Teardown is fire-and-forget — never await a server that may already be wedged.
    try { conn.sendNotification(ExitNotification.type) } catch { /* gone */ }
    try { conn.dispose() } catch { /* already disposed */ }
    try { child.kill() } catch { /* already dead */ }
  }

  let errors = 0
  let warnings = 0
  const files: FileDiag[] = []
  for (const [uri, c] of byUri) {
    if (c.errors + c.warnings === 0) continue
    errors += c.errors
    warnings += c.warnings
    files.push({ path: fileURLToPath(uri), errors: c.errors, warnings: c.warnings })
  }
  files.sort((a, b) => b.errors - a.errors || b.warnings - a.warnings || a.path.localeCompare(b.path))
  return { errors, warnings, files }
}
