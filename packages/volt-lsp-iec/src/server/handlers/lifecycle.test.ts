/**
 * The LIFECYCLE handlers (`handlers/lifecycle.ts`) over the harness: the live configuration, and the file watcher
 * `initialized` registers. The vendor `initialize` decides is `vendor.test.ts`'s.
 */
import { describe, expect, test } from "bun:test"
import { rmSync, mkdtempSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  DidChangeConfigurationNotification,
  DidOpenTextDocumentNotification,
  InitializedNotification,
  InitializeRequest,
  RegistrationRequest,
  type RegistrationParams,
} from "vscode-languageserver-protocol/node"
import { connect, onceDiag } from "../../../test/lsp/sources.js"
import { tmpdir } from "node:os"
import { connectToServer } from "../../../test/lsp/harness.js"
import { SCANNED_EXTENSIONS } from "../../workspace/workspace-refs.js"

test("server: didChangeConfiguration live-toggles diagnoseDeadCode (no restart)", async () => {
  const client = connect()
  const mainSrc = `PROGRAM Main\nIMPLEMENTATION ST\nx := 1;\nEND_PROGRAM`
  const deadSrc = `FUNCTION_BLOCK FB_Dead\nVAR b : BOOL; i : INT;\nEND_VAR\nIMPLEMENTATION ST\ni := b;\nEND_FUNCTION_BLOCK`
  const deadUri = "file:///FB_Dead.pou"
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  const initial = onceDiag(client, deadUri)
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: "file:///Main.pou", languageId: "iecst", version: 1, text: mainSrc },
  })
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: deadUri, languageId: "iecst", version: 1, text: deadSrc },
  })
  expect(((await initial) as { code?: unknown }[]).some((d) => d.code === "C0032")).toBe(false) // suppressed
  const afterCfg = onceDiag(client, deadUri)
  await client.sendNotification(DidChangeConfigurationNotification.type, { settings: { diagnoseDeadCode: true } })
  expect(((await afterCfg) as { code?: unknown }[]).some((d) => d.code === "C0032")).toBe(true) // now emitted
  client.dispose()
})

describe("the watcher globs (lsp-same-standard finding R3)", () => {
  /**
   * THE SERVER WATCHES EVERY FILE ITS SCAN READS (lsp-same-standard 3.1, finding R3).
   *
   * The re-index on a watched-file event is the only way a `volt pull` reaches a running server. The watcher globs were a
   * second, hand-kept list beside the scan's own, and it had lost `.projectsettings`: a pull that changed only the
   * project's compiler-warning settings (a warning switched off in the IDE) was never re-read until something else changed.
   */
  test("the watcher globs are exactly the extensions the workspace scan reads, `.projectsettings` among them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "volt-watch-"))
    let registered!: (p: RegistrationParams) => void
    const asked = new Promise<RegistrationParams>((resolve) => (registered = resolve))
    const client = connectToServer("codesys", (c) => c.onRequest(RegistrationRequest.type, (p) => registered(p)))
    await client.sendRequest(InitializeRequest.type, {
      processId: null,
      rootUri: pathToFileURL(dir).href,
      capabilities: { workspace: { didChangeWatchedFiles: { dynamicRegistration: true } } },
    })
    await client.sendNotification(InitializedNotification.type, {})
    const registration = await asked
    client.dispose()
    rmSync(dir, { recursive: true, force: true })
    const globs = (
      registration.registrations[0]?.registerOptions as { watchers: { globPattern: string }[] }
    ).watchers.map((w) => w.globPattern)
    expect(globs.sort()).toEqual(SCANNED_EXTENSIONS.map((e) => `**/*${e}`).sort())
    expect(globs).toContain("**/*.projectsettings")
  })
})
