/**
 * `applyWatchedChanges` (`disk-sync.ts`) over the harness, for what the protocol-level suite (`test/lsp/disk-sync.test.ts`)
 * does not ask: a batch that moves nothing sends no refresh; `.git` and non-file URIs are not the workspace's; a deleted
 * path that held nothing the server read is no folder event; a source rewritten with its own bytes is not re-parsed.
 */
import { afterAll, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { FileChangeType } from "vscode-languageserver-protocol/node"
import { fileUri, harness } from "../../test/lsp/harness.js"
import { parsed, resetParses } from "../../test/lsp/probes.js"
import { tempWorkspace } from "../../test/lsp/sources.js"

const FB = `FUNCTION_BLOCK FB_A\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := n + 1;\nEND_FUNCTION_BLOCK\n`

const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/** A workspace with one source and a pull client that takes refreshes and watches files, so a batch's refresh counts. */
async function setup() {
  const root = tempWorkspace({ "FB_A.pou": FB, "Notes/readme.txt": "not a source\n" })
  roots.push(root)
  const h = harness()
  await h.initIn(root, {
    textDocument: { diagnostic: { dynamicRegistration: false } },
    workspace: { diagnostics: { refreshSupport: true }, didChangeWatchedFiles: { dynamicRegistration: true } },
  })
  return { root, h, refreshes: h.refreshCount() }
}

test("a batch that moves nothing sends no refresh and parses nothing", async () => {
  const { root, h, refreshes } = await setup()
  resetParses()
  writeFileSync(join(root, "FB_A.pou"), FB) // the same bytes
  await h.watched([
    { uri: fileUri(root, "FB_A.pou"), type: FileChangeType.Changed },
    { uri: fileUri(root, "Notes/readme.txt"), type: FileChangeType.Changed }, // no scanned extension
    { uri: fileUri(root, ".git/index"), type: FileChangeType.Changed }, // the repository, no item
    { uri: "untitled:Untitled-1", type: FileChangeType.Changed }, // not a file
  ])
  expect(parsed(pathToFileURL(root).href)).toEqual(new Map())
  expect(h.refreshCount()).toBe(refreshes)
  h.dispose()
})

test("a deleted path with no scanned extension that held nothing the server read is no folder event", async () => {
  const { root, h, refreshes } = await setup()
  rmSync(join(root, "Notes"), { recursive: true })
  await h.watched([{ uri: fileUri(root, "Notes"), type: FileChangeType.Deleted }])
  expect(h.refreshCount()).toBe(refreshes)
  h.dispose()
})

test("a created folder with a source in it is one batch: one parse, one refresh", async () => {
  const { root, h, refreshes } = await setup()
  mkdirSync(join(root, "New"))
  writeFileSync(join(root, "New/FB_B.pou"), FB.replaceAll("FB_A", "FB_B"))
  resetParses()
  await h.watched([
    { uri: fileUri(root, "New"), type: FileChangeType.Created },
    { uri: fileUri(root, "New/FB_B.pou"), type: FileChangeType.Created }, // a host may name both
  ])
  expect(parsed(pathToFileURL(root).href)).toEqual(new Map([[fileUri(root, "New/FB_B.pou"), 1]]))
  expect(h.refreshCount()).toBe(refreshes + 1)
  h.dispose()
})
