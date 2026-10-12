/**
 * THE SERVER WATCHES EVERY FILE ITS SCAN READS (lsp-same-standard 3.1, finding R3).
 *
 * The re-index on a watched-file event is the only way a `volt pull` reaches a running server. The watcher globs were a
 * second, hand-kept list beside the scan's own, and it had lost `.projectsettings`: a pull that changed only the
 * project's compiler-warning settings (a warning switched off in the IDE) was never re-read until something else changed.
 */
import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { InitializedNotification, InitializeRequest, RegistrationRequest, type RegistrationParams } from "vscode-languageserver-protocol/node"
import { connectToServer } from "../../test/server/harness.js"
import { SCANNED_EXTENSIONS } from "../workspace/workspace-refs.js"

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
  const globs = (registration.registrations[0]?.registerOptions as { watchers: { globPattern: string }[] }).watchers.map((w) => w.globPattern)
  expect(globs.sort()).toEqual(SCANNED_EXTENSIONS.map((e) => `**/*${e}`).sort())
  expect(globs).toContain("**/*.projectsettings")
})
