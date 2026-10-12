/**
 * DOES THE SERVER STAY UP, SAY WHAT WENT WRONG, AND KEEP THE PROTOCOL'S LIFECYCLE? (openspec lsp-server-scheduling
 * 1.3) — a request the client cancelled while it still waited in the queue is never computed; the indexing progress
 * begins before it ends, and only on a token the client accepted; a client that never answers the progress create
 * still gets its diagnostics; a parse that throws leaves the server serving, is logged to `window/logMessage`, and the
 * file it broke says so with ONE error instead of a clean report; a request before `initialize` is refused with
 * ServerNotInitialized and one after `shutdown` with InvalidRequest; a closed connection and a dead parent process
 * end the server, through `runServer`'s exit seam (never a real `process.exit` here).
 *
 * The `test.failing` tests are red until 2.3 builds them (cancellation, progress, logger, quarantine, lifecycle); the
 * step that turns one green removes its mark. Refused by name: the `exit`-notification test — today `exit` calls
 * `process.exit(0)`, which would end `bun test` mid-run; it lands with the exit seam in 2.3.
 */
import { afterAll, expect, test } from "bun:test"
import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  CancellationTokenSource,
  DiagnosticSeverity,
  DidOpenTextDocumentNotification,
  DocumentDiagnosticRequest,
  FileChangeType,
  FoldingRangeRequest,
  HoverRequest,
  InitializeRequest,
  ShutdownRequest,
  type Diagnostic,
} from "vscode-languageserver-protocol/node"
import { CAPS, fileUri, harness, until, within, type Harness } from "./harness.js"
import { parsed, resetParses, THROWS_IN_PARSE } from "./probes.js"
import { tempWorkspace } from "./sources.js"

const PRG = (name: string, body = "i := i + 1;") =>
  `PROGRAM ${name}\nVAR\n\tb : BOOL;\n\ti : INT;\nEND_VAR\nIMPLEMENTATION ST\n${body}\nEND_PROGRAM\n`
const BROKEN = PRG("Main", "i := b;") // C0032

const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})
function workspace(): string {
  const root = tempWorkspace({ "Main.pou": BROKEN })
  roots.push(root)
  return root
}

/** The JSON-RPC error code a rejected request carried (undefined when it was answered). */
async function errorCode(p: Promise<unknown>): Promise<number | undefined> {
  try {
    await p
    return undefined
  } catch (e) {
    return (e as { code?: number }).code
  }
}

/** Poll the workspace pull (every 100 ms, at most 5 s) until `uri` reports `code`; the codes it reported last. A report
 *  that arrives at all proves the crawl ran: before it every pull answers nothing. */
async function untilReported(h: Harness, uri: string, code: string): Promise<unknown[]> {
  let codes: unknown[] = []
  const t0 = Date.now()
  while (!codes.includes(code) && Date.now() - t0 < 5000) {
    codes = ((await h.workspacePull()).find((r) => r.uri === uri)?.items ?? []).map((d) => d.code)
    if (!codes.includes(code)) await new Promise((r) => setTimeout(r, 100))
  }
  return codes
}

/** The `{ code, line, severity }` of each finding a workspace pull reports for `uri`. */
async function findings(h: Harness, uri: string) {
  return ((await h.workspacePull()).find((r) => r.uri === uri)?.items ?? []).map((d) => ({
    code: d.code,
    line: d.range.start.line,
    severity: d.severity,
  }))
}
const NOT_ANALYSED = [{ code: "not-analysed", line: 0, severity: DiagnosticSeverity.Error }]

const HOVER = { textDocument: { uri: "file:///A.pou" }, position: { line: 0, character: 9 } }

test.failing("a pull cancelled while still queued answers RequestCancelled and is never computed", async () => {
  const h = harness()
  await h.init(CAPS.pull)
  const a = "file:///A.pou"
  const b = "file:///B.pou"
  await h.open(a, PRG("PA"))
  await h.open(b, PRG("PB"))
  resetParses()
  // One burst: A (a request that parses A alone), B (a pull, which would build the project and parse B), cancel B.
  const cancel = new CancellationTokenSource()
  const first = h.request(FoldingRangeRequest.type, { textDocument: { uri: a } })
  const second = h.request(DocumentDiagnosticRequest.type, { textDocument: { uri: b } }, cancel.token)
  cancel.cancel()
  await first
  expect(await errorCode(second)).toBe(-32800) // RequestCancelled
  expect(parsed().get(b)).toBeUndefined()
  h.dispose()
})

test.failing("the indexing progress begins before it ends", async () => {
  const h = harness("codesys", "answer")
  await h.initIn(workspace(), CAPS.vscode)
  await until(() => h.progress().length >= 2, 3000, "a begin and an end")
  expect(h.progress()).toEqual(["begin", "end"])
  h.dispose()
})

test.failing("a refused progress create still crawls, and sends no progress on its token", async () => {
  // A refusal is no reason to skip the crawl: without it `indexed` stays false and every pull answers `Full []`.
  const h = harness("codesys", "refuse")
  const root = workspace()
  await h.initIn(root, CAPS.vscode)
  expect(await untilReported(h, fileUri(root, "Main.pou"), "C0032")).toContain("C0032") // the crawl ran
  expect(h.progress()).toEqual([])
  h.dispose()
}, 10_000)

test("a client that never answers the progress create still gets its diagnostics, and no `begin`", async () => {
  // The create is bounded (2 s): without the bound, `indexed` would stay false and every pull answer `Full []` for good.
  // Passes today (the crawl does not wait for the create); it pins that 2.3's awaited create keeps it so.
  const h = harness("codesys", "never")
  const root = workspace()
  await h.initIn(root, CAPS.vscode)
  expect(await untilReported(h, fileUri(root, "Main.pou"), "C0032")).toContain("C0032")
  expect(h.progress()).not.toContain("begin")
  h.dispose()
}, 10_000)

test.failing(
  "a throwing parse leaves the server serving, is logged, and its file reports one `not-analysed` error",
  async () => {
    const h = harness()
    await h.init(CAPS.pull)
    const good = "file:///Good.pou"
    const bad = "file:///Quarantine.pou"
    await h.open(good, BROKEN)
    await h.open(bad, `${PRG("PQ")}${THROWS_IN_PARSE}\n`)
    // Every other document is still analysed…
    expect((await h.pull(good)).map((d) => d.code)).toContain("C0032")
    // …the failure is logged, naming the file…
    expect(h.logs().some((l) => l.message.includes(bad))).toBe(true)
    // …and the file it broke is not shown clean: one error, on line 0, that names it as not analysed.
    const own: Diagnostic[] = await h.pull(bad)
    expect(own.map((d) => ({ code: d.code, line: d.range.start.line, severity: d.severity }))).toEqual([
      { code: "not-analysed", line: 0, severity: 1 },
    ])
    // Content that parses again is analysed again (the quarantine lasts until the content changes).
    await h.change(bad, 2, PRG("PQ", "i := b;"))
    expect((await h.pull(bad)).map((d) => d.code)).toEqual(["C0032"])
    h.dispose()
  },
)

test.failing("a disk file whose parse throws during the crawl is quarantined; the crawl serves every other file", async () => {
  const root = tempWorkspace({ "Main.pou": BROKEN, "Bad.pou": `${PRG("PQ")}${THROWS_IN_PARSE}\n` })
  roots.push(root)
  const h = harness()
  await h.initIn(root, CAPS.vscode)
  expect((await findings(h, fileUri(root, "Main.pou"))).map((f) => f.code)).toContain("C0032")
  expect(await findings(h, fileUri(root, "Bad.pou"))).toEqual(NOT_ANALYSED)
  expect(h.logs().some((l) => l.message.includes(fileUri(root, "Bad.pou")))).toBe(true)
  h.dispose()
})

test.failing("a watched source whose parse throws is quarantined; every other file is still served", async () => {
  const root = tempWorkspace({ "Main.pou": BROKEN, "Bad.pou": PRG("PQ") })
  roots.push(root)
  const h = harness()
  await h.initIn(root, CAPS.vscode)
  writeFileSync(join(root, "Bad.pou"), `${PRG("PQ")}${THROWS_IN_PARSE}\n`)
  await h.watched([{ uri: fileUri(root, "Bad.pou"), type: FileChangeType.Changed }])
  expect((await findings(h, fileUri(root, "Main.pou"))).map((f) => f.code)).toContain("C0032")
  expect(await findings(h, fileUri(root, "Bad.pou"))).toEqual(NOT_ANALYSED)
  h.dispose()
})

test("a notification before `initialize` is dropped", async () => {
  const h = harness()
  const a = "file:///A.pou"
  await h.notify(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: a, languageId: "iecst", version: 1, text: BROKEN },
  })
  await h.init(CAPS.pull)
  expect(await h.pull(a)).toEqual([]) // an unknown document: the open never happened
  h.dispose()
})

test.failing("a request before `initialize` is refused with ServerNotInitialized (-32002)", async () => {
  const h = harness()
  expect(await errorCode(within(h.request(HoverRequest.type, HOVER), 2000, "the refusal"))).toBe(-32002)
  h.dispose()
})

test.failing("a request after `shutdown` is refused with InvalidRequest (-32600)", async () => {
  const h = harness()
  await h.init(CAPS.pull)
  await h.open("file:///A.pou", PRG("PA"))
  await h.request(ShutdownRequest.type, undefined)
  expect(await errorCode(within(h.request(HoverRequest.type, HOVER), 2000, "the refusal"))).toBe(-32600)
  h.dispose()
})

test.failing("a closed connection after `shutdown` ends the server with code 0", async () => {
  const h = harness()
  await h.init(CAPS.pull)
  await h.request(ShutdownRequest.type, undefined)
  h.endInput()
  await until(() => h.exits().length > 0, 2000, "an exit after the connection closed")
  expect(h.exits()).toEqual([0])
  h.dispose()
})

test.failing("a closed connection ends the server, with code 1 when no `shutdown` came first", async () => {
  const h = harness()
  await h.init(CAPS.pull)
  h.endInput()
  await until(() => h.exits().length > 0, 2000, "an exit after the connection closed")
  expect(h.exits()).toEqual([1])
  h.dispose()
})

test.failing(
  "a dead parent process (`processId`) ends the server with code 1",
  async () => {
    // A process that has exited: its pid names no live process (the server's watchdog probes it every 3 s).
    const gone = Bun.spawn([process.execPath, "-e", "0"])
    await gone.exited
    const h = harness()
    await h.request(InitializeRequest.type, { processId: gone.pid, rootUri: null, capabilities: {} })
    await until(() => h.exits().length > 0, 5000, "an exit after the parent process died")
    expect(h.exits()).toEqual([1])
    h.dispose()
  },
  10_000,
)
