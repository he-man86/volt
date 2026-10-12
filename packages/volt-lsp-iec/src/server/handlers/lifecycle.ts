/**
 * THE LIFECYCLE HANDLERS — initialize (the vendor and root decided, once: `vendor.ts` `servedWorkspace`), initialized
 * (the crawl and the file watcher), shutdown and exit, and the live configuration.
 */
import {
  ConfigurationRequest,
  DidChangeConfigurationNotification,
  DidChangeWatchedFilesNotification,
  ExitNotification,
  InitializedNotification,
  InitializeRequest,
  LSPErrorCodes,
  RegistrationRequest,
  ResponseError,
  ShutdownRequest,
  type InitializeError,
  type InitializeResult,
} from "vscode-languageserver-protocol/node"
import { resolveConfig, type Vendor } from "../../analysis/index.js"
import { SCANNED_EXTENSIONS } from "../../workspace/workspace-refs.js"
import { WorkspaceStore } from "../../workspace/workspace-store.js"
import { NETWORK_TEXT_ENABLED } from "../config.js"
import type { EditorOptions, ServerState } from "../state.js"
import { servedWorkspace } from "../vendor.js"

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
    s.store = new WorkspaceStore(resolveConfig({ vendor: s.vendor }), { networkText: NETWORK_TEXT_ENABLED })
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
    return {
      capabilities,
      serverInfo: { name: "volt-lsp-iec", version },
    }
  })

  // `initialized` follows the handshake — do the heavy eager crawl here (synchronously, so nothing is diagnosed
  // against a half-seeded project) so the InitializeResult stays instant, then register the file watcher so
  // `volt pull` changes re-index without a restart.
  conn.onNotification(InitializedNotification.type, () => {
    s.crawlWithProgress()
    if (s.root !== undefined && s.clientWatchDynReg) {
      conn
        .sendRequest(RegistrationRequest.type, {
          registrations: [
            {
              id: "volt-watch",
              method: DidChangeWatchedFilesNotification.method,
              registerOptions: { watchers: SCANNED_EXTENSIONS.map((ext) => ({ globPattern: `**/*${ext}` })) },
            },
          ],
        })
        .catch(() => {}) // a client that advertised dynamicRegistration but can't register — degrade to fresh-at-init
    }
  })
  conn.onRequest(ShutdownRequest.type, () => {})
  conn.onNotification(ExitNotification.type, () => process.exit(0))

  // ─── live configuration ────────────────────────────────────────────────────
  conn.onNotification(DidChangeConfigurationNotification.type, (p) => {
    if (s.applyConfig(p.settings)) return // config pushed with the notification
    if (s.clientConfigPull)
      void conn
        .sendRequest(ConfigurationRequest.type, { items: [{ section: "volt" }] })
        .then((res) => s.applyConfig(Array.isArray(res) ? res[0] : undefined))
        .catch(() => {})
  })
}
