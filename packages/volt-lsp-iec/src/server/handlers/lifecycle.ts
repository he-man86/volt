/**
 * THE LIFECYCLE HANDLERS — initialize (the vendor and root decided, once: `vendor.ts` `servedWorkspace`), initialized
 * (the crawl and the file watcher), shutdown and exit, the parent watchdog, and the live configuration.
 *
 * Lifecycle conformance (openspec lsp-server-scheduling 2.3): every other request is refused with ServerNotInitialized
 * before `initialize` and with InvalidRequest after `shutdown` (`ServerState.onRequest`); `exit` ends with 0 after
 * `shutdown` and 1 otherwise, and so does a closed connection; a `processId` the client names is probed every 3 s and
 * its death ends the server (an orphaned server outliving its editor was the LSP-zombie history). Every end goes through
 * `runServer`'s exit seam (`ServerState.end`), never `process.exit` here.
 */
import {
  ConfigurationRequest,
  DidChangeConfigurationNotification,
  DidChangeWatchedFilesNotification,
  ExitNotification,
  InitializedNotification,
  InitializeRequest,
  LSPErrorCodes,
  MessageType,
  RegistrationRequest,
  ResponseError,
  ShutdownRequest,
  WatchKind,
  type InitializeError,
  type InitializeResult,
} from "vscode-languageserver-protocol/node"
import { resolveConfig, type Vendor } from "../../analysis/index.js"
import { SCANNED_EXTENSIONS } from "../../workspace/workspace-refs.js"
import { WorkspaceStore } from "../../workspace/workspace-store.js"
import { NETWORK_TEXT_ENABLED } from "../config.js"
import { watchWorkspace } from "../file-watch.js"
import type { EditorOptions, ServerState } from "../state.js"
import { servedWorkspace } from "../vendor.js"

/** How often the parent `processId` is probed. */
const WATCHDOG_MS = 3000

/** `flag`: the vendor the client stated (`--codesys|--twincat`), or undefined — `initialize` then reads the binding. */
export function registerLifecycleHandlers(
  s: ServerState,
  flag: Vendor | undefined,
  version: string,
  capabilities: InitializeResult["capabilities"],
): void {
  const conn = s.conn
  conn.onRequest(InitializeRequest.type, (params): InitializeResult | ResponseError<InitializeError> => {
    try {
      ;({ vendor: s.vendor, root: s.root } = servedWorkspace(flag, params))
    } catch (e) {
      return new ResponseError(LSPErrorCodes.RequestFailed, (e as Error).message, { retry: false })
    }
    s.store = new WorkspaceStore(resolveConfig({ vendor: s.vendor }), { networkText: NETWORK_TEXT_ENABLED }, s.reportFailure)
    const opts = params.initializationOptions as EditorOptions | undefined
    if (opts !== undefined && (opts.diagnoseDeadCode !== undefined || opts.diagnostics !== undefined)) {
      s.editorOptions = { diagnoseDeadCode: opts.diagnoseDeadCode, diagnostics: opts.diagnostics }
      s.applyResolvedConfig()
    }
    // No workspace root ⇒ no crawl to wait for (single-file / bare client): the open buffer IS the project, so let
    // diagnostics flow at once. WITH a root, stay gated until the `initialized` crawl seeds the disk layer.
    s.indexed = s.root === undefined
    const ws = params.capabilities.workspace
    s.clientWatchDynReg = ws?.didChangeWatchedFiles?.dynamicRegistration === true
    s.clientRefresh.semanticTokens = ws?.semanticTokens?.refreshSupport === true
    s.clientRefresh.inlayHint = ws?.inlayHint?.refreshSupport === true
    s.clientRefresh.codeLens = ws?.codeLens?.refreshSupport === true
    s.clientRefresh.diagnostics = ws?.diagnostics?.refreshSupport === true
    s.clientConfigPull = ws?.configuration === true
    s.clientProgress = params.capabilities.window?.workDoneProgress === true
    s.clientSupportsPull = params.capabilities.textDocument?.diagnostic !== undefined
    if (typeof params.processId === "number") watchParent(s, params.processId)
    s.started = true
    return { capabilities, serverInfo: { name: "volt-lsp-iec", version } }
  })

  // `initialized` follows the handshake — the crawl runs here so the InitializeResult stays instant, and the watchers
  // are registered so `volt pull` changes reach the store without a restart.
  s.onNotification(InitializedNotification.type, () => {
    void s.crawlWithProgress().catch((e: unknown) => s.log(MessageType.Error, `volt-lsp-iec: the workspace crawl failed: ${String(e)}`))
    if (s.root === undefined) return
    if (!s.clientWatchDynReg) return watchWorkspace(s)
    conn
      .sendRequest(RegistrationRequest.type, {
        registrations: [
          {
            id: "volt-watch",
            method: DidChangeWatchedFilesNotification.method,
            registerOptions: { watchers: SCANNED_EXTENSIONS.map((ext) => ({ globPattern: `**/*${ext}` })) },
          },
          // A host may report a folder's create or delete as ONE event for the folder, which no extension glob matches.
          {
            id: "volt-watch-folders",
            method: DidChangeWatchedFilesNotification.method,
            registerOptions: { watchers: [{ globPattern: "**/*", kind: WatchKind.Create | WatchKind.Delete }] },
          },
        ],
      })
      .catch(() => watchWorkspace(s)) // advertised dynamic registration, then refused it: watch the disk ourselves
  })
  conn.onRequest(ShutdownRequest.type, () => {
    const refused = s.refusal()
    if (refused !== undefined) return refused
    s.shutdown = true
  })
  conn.onNotification(ExitNotification.type, () => s.end())
  conn.onClose(() => s.end())

  // ─── live configuration ────────────────────────────────────────────────────
  s.onNotification(DidChangeConfigurationNotification.type, (p) => {
    if (s.applyConfig(p.settings)) return // config pushed with the notification
    if (s.clientConfigPull)
      void conn
        .sendRequest(ConfigurationRequest.type, { items: [{ section: "volt" }] })
        .then((res) => s.applyConfig(Array.isArray(res) ? res[0] : undefined))
        .catch(() => {})
  })
}

/** End the server when the client's process dies: `kill(pid, 0)` probes it (ESRCH: gone; EPERM: alive, not ours). */
function watchParent(s: ServerState, pid: number): void {
  const timer = setInterval(() => {
    try {
      process.kill(pid, 0)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ESRCH") s.end()
    }
  }, WATCHDOG_MS)
  timer.unref()
  s.stops.push(() => clearInterval(timer))
}
