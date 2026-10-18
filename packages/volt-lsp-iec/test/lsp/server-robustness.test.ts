/**
 * DOES THE SERVER STAY UP, SAY WHAT WENT WRONG, AND KEEP THE PROTOCOL'S LIFECYCLE? (openspec lsp-server-scheduling
 * 1.3) — a request the client cancelled while it still waited in the queue is never computed; the indexing progress
 * begins before it ends, and only on a token the client accepted; a client that never answers the progress create
 * still gets its diagnostics; a parse that throws leaves the server serving, is logged to `window/logMessage`, and the
 * file it broke says so with ONE error instead of a clean report; a request before `initialize` is refused with
 * ServerNotInitialized and one after `shutdown` with InvalidRequest; a closed connection and a dead parent process
 * end the server, through `runServer`'s exit seam (never a real `process.exit` here).
 *
 * Written red in step 1; 2.3 (cancellation, progress, logger, quarantine, lifecycle) turned them green. The
 * `exit`-notification tests came with the exit seam in 2.3: before it `exit` called `process.exit(0)`, which would have
 * ended `bun test` mid-run.
 */
import { afterAll, expect, test } from "bun:test"
import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  CancellationTokenSource,
  DiagnosticSeverity,
  DidOpenTextDocumentNotification,
  DocumentDiagnosticRequest,
  ExitNotification,
  FileChangeType,
  FoldingRangeRequest,
  HoverRequest,
  InitializeRequest,
  ShutdownRequest,
  type Diagnostic,
} from "vscode-languageserver-protocol/node"
import { CAPS, fileUri, harness, until, within, type Harness } from "./harness.js"
import { parsed, resetParses, THROWS_IN_BIND, THROWS_IN_PARSE } from "./probes.js"
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

test("a pull cancelled while still queued answers RequestCancelled and is never computed", async () => {
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
  // Its rejection is observed at once: one left unobserved while `first` is awaited is an unhandled rejection.
  const second = errorCode(h.request(DocumentDiagnosticRequest.type, { textDocument: { uri: b } }, cancel.token))
  cancel.cancel()
  await first
  expect(await second).toBe(-32800) // RequestCancelled
  expect(parsed().get(b)).toBeUndefined()
  h.dispose()
})

test("the indexing progress begins before it ends", async () => {
  const h = harness("codesys", "answer")
  await h.initIn(workspace(), CAPS.vscode)
  await until(() => h.progress().length >= 2, 3000, "a begin and an end")
  expect(h.progress()).toEqual(["begin", "end"])
  h.dispose()
})

test("a refused progress create still crawls, and sends no progress on its token", async () => {
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

test(
  "a throwing parse leaves the server serving, is logged, and its file reports one `not-analysed` error",
  async () => {
    const h = harness()
    await h.init(CAPS.pull)
    const good = "file:///Good.pou"
    const bad = "file:///PQ.pou" // named after its POU: a file's name and its POU's must match (signature-name-mismatch)
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

test("a disk file whose parse throws during the crawl is quarantined; the crawl serves every other file", async () => {
  const root = tempWorkspace({ "Main.pou": BROKEN, "Bad.pou": `${PRG("PQ")}${THROWS_IN_PARSE}\n` })
  roots.push(root)
  const h = harness()
  await h.initIn(root, CAPS.vscode)
  expect((await findings(h, fileUri(root, "Main.pou"))).map((f) => f.code)).toContain("C0032")
  expect(await findings(h, fileUri(root, "Bad.pou"))).toEqual(NOT_ANALYSED)
  expect(h.logs().some((l) => l.message.includes(fileUri(root, "Bad.pou")))).toBe(true)
  h.dispose()
})

test("a watched source whose parse throws is quarantined; every other file is still served", async () => {
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


test("a disk file whose BIND throws during the crawl is quarantined; the crawl serves every other file", async () => {
  const root = tempWorkspace({ "Main.pou": BROKEN, "Bad.pou": `${PRG("PQ")}${THROWS_IN_BIND}\n` })
  roots.push(root)
  const h = harness()
  await h.initIn(root, CAPS.vscode)
  expect((await findings(h, fileUri(root, "Main.pou"))).map((f) => f.code)).toContain("C0032")
  expect(await findings(h, fileUri(root, "Bad.pou"))).toEqual(NOT_ANALYSED)
  expect(h.logs().some((l) => l.message.includes(fileUri(root, "Bad.pou")))).toBe(true)
  h.dispose()
})

test("a watched source whose BIND throws is quarantined; every other file is still served", async () => {
  const root = tempWorkspace({ "Main.pou": BROKEN, "Bad.pou": PRG("PQ") })
  roots.push(root)
  const h = harness()
  await h.initIn(root, CAPS.vscode)
  await h.workspacePull() // the project is built: the upsert rebinds the one file
  writeFileSync(join(root, "Bad.pou"), `${PRG("PQ")}${THROWS_IN_BIND}\n`)
  await h.watched([{ uri: fileUri(root, "Bad.pou"), type: FileChangeType.Changed }])
  expect((await findings(h, fileUri(root, "Main.pou"))).map((f) => f.code)).toContain("C0032")
  expect(await findings(h, fileUri(root, "Bad.pou"))).toEqual(NOT_ANALYSED)
  h.dispose()
})
test("a buffer that throws, saved to disk and closed, still reports `not-analysed` (parse and bind)", async () => {
  // The disk now holds the content the open buffer threw on: the quarantine belongs to the disk copy too, and the
  // file never drops out of the project with nothing in the pull to say why (gate 2 review).
  for (const marker of [THROWS_IN_PARSE, THROWS_IN_BIND]) {
    const root = tempWorkspace({ "Main.pou": BROKEN, "PQ.pou": PRG("PQ") })
    roots.push(root)
    const h = harness()
    await h.initIn(root, CAPS.vscode)
    const bad = fileUri(root, "PQ.pou")
    const text = `${PRG("PQ")}${marker}\n`
    await h.open(bad, text)
    expect(await findings(h, bad), marker).toEqual(NOT_ANALYSED)
    writeFileSync(join(root, "PQ.pou"), text)
    await h.watched([{ uri: bad, type: FileChangeType.Changed }])
    await h.close(bad)
    expect(await findings(h, bad), marker).toEqual(NOT_ANALYSED)
    expect((await findings(h, fileUri(root, "Main.pou"))).map((f) => f.code), marker).toContain("C0032")
    h.dispose()
  }
})

test("a disk file that throws stays `not-analysed` after a buffer of it is edited clean and closed unsaved", async () => {
  const root = tempWorkspace({ "Main.pou": BROKEN, "PQ.pou": `${PRG("PQ")}${THROWS_IN_PARSE}\n` })
  roots.push(root)
  const h = harness()
  await h.initIn(root, CAPS.vscode)
  const bad = fileUri(root, "PQ.pou")
  await h.open(bad, `${PRG("PQ")}${THROWS_IN_PARSE}\n`)
  await h.change(bad, 2, PRG("PQ")) // edited clean, never saved: the disk still holds the content that threw
  expect(await findings(h, bad)).toEqual([])
  await h.close(bad)
  expect(await findings(h, bad)).toEqual(NOT_ANALYSED)
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

test("a request before `initialize` is refused with ServerNotInitialized (-32002)", async () => {
  const h = harness()
  expect(await errorCode(within(h.request(HoverRequest.type, HOVER), 2000, "the refusal"))).toBe(-32002)
  h.dispose()
})

test("a request after `shutdown` is refused with InvalidRequest (-32600)", async () => {
  const h = harness()
  await h.init(CAPS.pull)
  await h.open("file:///A.pou", PRG("PA"))
  await h.request(ShutdownRequest.type, undefined)
  expect(await errorCode(within(h.request(HoverRequest.type, HOVER), 2000, "the refusal"))).toBe(-32600)
  h.dispose()
})

test("`exit` after `shutdown` ends the server with code 0", async () => {
  const h = harness()
  await h.init(CAPS.pull)
  await h.request(ShutdownRequest.type, undefined)
  await h.notify(ExitNotification.type, undefined)
  await until(() => h.exits().length > 0, 2000, "an exit after the `exit` notification")
  expect(h.exits()).toEqual([0])
  h.dispose()
})

test("`exit` with no `shutdown` first ends the server with code 1", async () => {
  const h = harness()
  await h.init(CAPS.pull)
  await h.notify(ExitNotification.type, undefined)
  await until(() => h.exits().length > 0, 2000, "an exit after the `exit` notification")
  expect(h.exits()).toEqual([1])
  h.dispose()
})

test("a closed connection after `shutdown` ends the server with code 0", async () => {
  const h = harness()
  await h.init(CAPS.pull)
  await h.request(ShutdownRequest.type, undefined)
  h.endInput()
  await until(() => h.exits().length > 0, 2000, "an exit after the connection closed")
  expect(h.exits()).toEqual([0])
  h.dispose()
})

test("a closed connection ends the server, with code 1 when no `shutdown` came first", async () => {
  const h = harness()
  await h.init(CAPS.pull)
  h.endInput()
  await until(() => h.exits().length > 0, 2000, "an exit after the connection closed")
  expect(h.exits()).toEqual([1])
  h.dispose()
})

test(
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

/** A body nested `depth` parentheses deep — the PLC Assist item (openspec lsp-deep-input-no-stack-overflow). Real code
 *  nests at most 7 (corpus census); this is far past every recursive pass's stack. */
const DEEP = (name: string, depth: number) => PRG(name, `i := ${"(".repeat(depth)}1${")".repeat(depth)};`)
/** Past the stack of the runtime the suite runs on: Node 24 overflows from 3000, bun (whose stack is larger) not at
 *  5000 and from 20000. */
const DEPTH = 20_000
const NOT_COMPUTED = /failed computing this file's findings/

test("a document whose findings throw answers one `not-analysed` error; the workspace pull answers every other document", async () => {
  const h = harness()
  await h.init(CAPS.pull)
  const good = "file:///Main.pou"
  const deep = "file:///PD.pou"
  await h.open(good, BROKEN)
  await h.open(deep, DEEP("PD", DEPTH))
  const reports = await h.workspacePull()
  expect((reports.find((r) => r.uri === good)?.items ?? []).map((d) => d.code)).toContain("C0032")
  const own = reports.find((r) => r.uri === deep)?.items ?? []
  expect(own.map((d) => ({ code: d.code, line: d.range.start.line, severity: d.severity }))).toEqual(NOT_ANALYSED)
  expect(own[0]!.message).toMatch(NOT_COMPUTED)
  expect(h.logs().some((l) => l.message.includes(deep))).toBe(true)
  h.dispose()
}, 30_000)

test("the same document through `textDocument/diagnostic`: one `not-analysed` error, computed once per generation", async () => {
  const h = harness()
  await h.init(CAPS.pull)
  const deep = "file:///PD.pou"
  await h.open(deep, DEEP("PD", DEPTH))
  const first = await h.pull(deep)
  expect(first.map((d) => ({ code: d.code, line: d.range.start.line, severity: d.severity }))).toEqual(NOT_ANALYSED)
  expect(first[0]!.message).toMatch(NOT_COMPUTED)
  const logged = () => h.logs().filter((l) => l.message.includes(deep)).length
  const once = logged()
  expect(once).toBe(1)
  await h.pull(deep)
  expect(logged()).toBe(once)
  h.dispose()
}, 30_000)
