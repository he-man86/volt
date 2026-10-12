/**
 * The watcher fallback (`file-watch.ts`, openspec lsp-server-scheduling 2.5) over the harness: a client that cannot
 * register file watchers still sees a `volt pull` — a source written, changed (one refresh for the save, however many
 * times `fs.watch` fires) and deleted reach the store through the server's own recursive watch. Waits poll with a
 * bound (`until`); the connection is ended before the workspace is removed, which closes the watch.
 */
import { afterAll, expect, test } from "bun:test"
import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileUri, harness, until, type Harness } from "../../test/lsp/harness.js"
import { tempWorkspace } from "../../test/lsp/sources.js"

const MAIN = `PROGRAM Main\nVAR\n\tn : FB_N;\nEND_VAR\nIMPLEMENTATION ST\nn();\nEND_PROGRAM\n`
const FB_N = `FUNCTION_BLOCK FB_N\nVAR\n\ti : INT;\nEND_VAR\nIMPLEMENTATION ST\ni := i + 1;\nEND_FUNCTION_BLOCK\n`
const UNKNOWN = "Unknown type: 'FB_N'"

const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/** Main's messages, as a workspace pull reports them. */
async function mainMessages(h: Harness, root: string): Promise<string[]> {
  return ((await h.workspacePull()).find((r) => r.uri === fileUri(root, "Main.pou"))?.items ?? []).map((d) =>
    typeof d.message === "string" ? d.message : d.message.value,
  )
}

/** Pull until Main's messages satisfy `holds` (every 50 ms, at most 5 s). */
async function eventually(h: Harness, root: string, holds: (messages: string[]) => boolean, what: string): Promise<void> {
  let last: string[] = []
  const t0 = Date.now()
  while (!holds((last = await mainMessages(h, root))) && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50))
  expect({ what, last }).toEqual({ what, last: holds(last) ? last : ["(never held)"] })
}

test("a client with no dynamic file watching: a written, saved and deleted source reach the store", async () => {
  const root = tempWorkspace({ "Main.pou": MAIN })
  roots.push(root)
  const h = harness()
  // A pull client that takes refreshes, and no `didChangeWatchedFiles` capability: the server watches itself.
  await h.initIn(root, {
    textDocument: { diagnostic: { dynamicRegistration: false } },
    workspace: { diagnostics: { refreshSupport: true } },
  })
  expect(h.registrations()).toEqual([]) // nothing asked of the client
  expect(await mainMessages(h, root)).toContain(UNKNOWN)

  writeFileSync(join(root, "FB_N.pou"), FB_N) // a pull writes a new POU
  await eventually(h, root, (m) => !m.includes(UNKNOWN), "the new FB_N binds")

  const refreshes = h.refreshCount()
  writeFileSync(join(root, "FB_N.pou"), `${FB_N}// saved\n`) // one save: fs.watch may fire more than once
  await until(() => h.refreshCount() > refreshes, 5000, "a refresh after the save")
  await new Promise((r) => setTimeout(r, 300)) // any further event of the same save has fired by now
  expect(h.refreshCount()).toBe(refreshes + 1)

  rmSync(join(root, "FB_N.pou"))
  await eventually(h, root, (m) => m.includes(UNKNOWN), "the deleted FB_N leaves the project")
  h.endInput() // ends the server, which closes its watch
  await until(() => h.exits().length > 0, 2000, "the server ended")
  h.dispose()
}, 20_000)
