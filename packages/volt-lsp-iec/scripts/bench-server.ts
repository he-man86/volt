/**
 * THE SERVER SCHEDULING BENCH — what a real client sees from the running server over a corpus project (openspec
 * lsp-server-scheduling 0.1 / 3.1). Unlike `test/lsp/bench.test.ts` (the per-edit store→compute path, no pipe), this drives
 * `runServer` over two in-process pipes as a VS Code-like client (pull + workspace pull + refresh + dynamic watchers +
 * progress) with the project as its root, and measures the SCHEDULING the protocol layer adds:
 *
 *   crawl            `initialized` → the first request answered (the eager crawl blocks the loop)
 *   workspace pass   one `workspace/diagnostic`
 *   10 idle pulls    ten back-to-back `workspace/diagnostic` with nothing changed (an idle editor re-pulls forever)
 *   save             Ctrl+S on ONE file whose content REALLY changed: a comment line is appended, sent as didChange,
 *                    written to disk, then didSave + the watched-file `Changed`. Measures the files re-parsed (disk entries
 *                    seeded — a real change must re-parse at least that one, so 0 means a missing upsert, never a
 *                    skipped identical one) and the ms the loop is blocked (the next hover's latency), then the re-pull
 *                    the refresh it sends triggers
 *   hover in pull    a hover sent right behind a `workspace/diagnostic` — how long the user waits
 *
 *   bun run scripts/bench-server.ts <corpus project> [<corpus project> …]     (default: pro2193 lenze-mid)
 *
 * Every workspace pull sends back the resultIds of the previous one (`previousResultIds`), as VS Code does: under the
 * protocol a server may answer `unchanged` only for a resultId the client sent, so an empty list would read 0
 * `unchanged` whatever the server does. The project is COPIED to a temp dir first — the save writes to disk, and the
 * corpus is tracked.
 *
 * Counts re-parses by wrapping `WorkspaceStore.prototype.seedDisk` (the disk layer's only parse site) — no product hook.
 */
import { PassThrough } from "node:stream"
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { extname, join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  createProtocolConnection,
  DiagnosticRefreshRequest,
  DidChangeTextDocumentNotification,
  DidChangeWatchedFilesNotification,
  DidOpenTextDocumentNotification,
  DidSaveTextDocumentNotification,
  FileChangeType,
  HoverRequest,
  InitializedNotification,
  InitializeRequest,
  RegistrationRequest,
  StreamMessageReader,
  StreamMessageWriter,
  WorkDoneProgress,
  WorkDoneProgressCreateRequest,
  WorkspaceDiagnosticRequest,
  type PreviousResultId,
  type WorkspaceDiagnosticReport,
} from "vscode-languageserver-protocol/node"
import { runServer } from "../src/server/index.js"
import { CAPS } from "../test/lsp/harness.js"
import { WorkspaceStore } from "../src/workspace/workspace-store.js"
import { SOURCE_EXTENSION_SET } from "../src/workspace/source-extensions.js"

const CORPUS = join(import.meta.dir, "..", "test-corpus")
const IDLE_PULLS = 10

/** What VS Code (vscode-languageclient 10) advertises for the parts this server reads — the scheduling suites' client too. */
const VSCODE_CAPS = CAPS.vscode

let seeded = 0 // disk entries parsed by seedDisk since the last reset
const realSeed = WorkspaceStore.prototype.seedDisk
WorkspaceStore.prototype.seedDisk = function (files) {
  seeded += files.length
  return realSeed.call(this, files)
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (SOURCE_EXTENSION_SET.has(extname(p))) out.push(p)
  }
  return out
}

const ms = (t0: number) => performance.now() - t0
const f = (n: number) => `${n.toFixed(0)} ms`

async function bench(name: string): Promise<void> {
  const source = join(CORPUS, name)
  if (!existsSync(source)) throw new Error(`no corpus project ${source} — bun run refresh:corpus ${name}`)
  const tmp = mkdtempSync(join(tmpdir(), "volt-bench-server-"))
  try {
    const root = join(tmp, name)
    cpSync(source, root, { recursive: true })
    await benchAt(name, root)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function benchAt(name: string, root: string): Promise<void> {
  const files = walk(root)

  const c2s = new PassThrough()
  const s2c = new PassThrough()
  runServer(c2s, s2c, "codesys", "(bench)")
  const client = createProtocolConnection(new StreamMessageReader(s2c), new StreamMessageWriter(c2s))
  const progress: string[] = []
  let refreshes = 0
  let onRefresh: (() => void) | undefined
  client.onRequest(RegistrationRequest.type, () => {})
  client.onRequest(WorkDoneProgressCreateRequest.type, () => {})
  client.onProgress(WorkDoneProgress.type, "volt-index-1", (v) => {
    progress.push(v.kind)
  })
  client.onRequest(DiagnosticRefreshRequest.type, () => {
    refreshes++
    onRefresh?.()
  })
  client.listen()

  // The edit/hover target: the largest PROJECT POU (as test/lsp/bench.test.ts picks it), hovered on its own name.
  const target = files
    .filter((p) => /\.pou$/i.test(p) && !/Library Manager/i.test(p))
    .map((p) => ({ p, src: readFileSync(p, "utf8") }))
    .sort((a, b) => b.src.length - a.src.length)[0]!
  const uri = pathToFileURL(target.p).href
  const header =
    /^\s*(?:FUNCTION_BLOCK|PROGRAM|FUNCTION)\s+(?:(?:PUBLIC|PRIVATE|INTERNAL|ABSTRACT|FINAL)\s+)*(\w+)/m.exec(
      target.src,
    )
  if (header === null) throw new Error(`no POU header in ${target.p}`)
  const nameOff = header.index + header[0].length - header[1]!.length
  const before = target.src.slice(0, nameOff).split("\n")
  const hoverPos = { line: before.length - 1, character: before.at(-1)!.length + 1 }
  const hover = () => client.sendRequest(HoverRequest.type, { textDocument: { uri }, position: hoverPos })
  // As VS Code: send back every resultId the previous pull returned (a report without one is not sent back).
  let previousResultIds: PreviousResultId[] = []
  const pullAll = async () => {
    const r = (await client.sendRequest(WorkspaceDiagnosticRequest.type, {
      previousResultIds,
    })) as WorkspaceDiagnosticReport
    const ids = new Map(previousResultIds.map((p) => [p.uri, p.value]))
    for (const i of r.items) if (i.resultId !== undefined) ids.set(i.uri, i.resultId)
    previousResultIds = [...ids].map(([uri, value]) => ({ uri, value }))
    return r
  }

  await client.sendRequest(InitializeRequest.type, {
    processId: null,
    rootUri: pathToFileURL(root).href,
    capabilities: VSCODE_CAPS,
  })
  seeded = 0
  let t = performance.now()
  await client.sendNotification(InitializedNotification.type, {})
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri, languageId: "iecst", version: 1, text: target.src },
  })
  await hover()
  const crawl = ms(t)
  const crawlParsed = seeded

  t = performance.now()
  const first = await pullAll()
  const pass = ms(t)
  const reports = first.items.length
  const full = first.items.filter((i) => i.kind === "full").length

  t = performance.now()
  const idle: number[] = []
  let unchanged = 0
  for (let i = 0; i < IDLE_PULLS; i++) {
    const t1 = performance.now()
    const r = await pullAll()
    idle.push(ms(t1))
    unchanged += r.items.filter((x) => x.kind === "unchanged").length
  }
  const idleTotal = ms(t)

  // Ctrl+S in VS Code on a real edit: the buffer change, the write to disk, didSave, then the watcher's Changed.
  const nl = target.src.includes("\r\n") ? "\r\n" : "\n"
  const edited = `${target.src}${target.src.endsWith(nl) ? "" : nl}// bench-server edit${nl}`
  await client.sendNotification(DidChangeTextDocumentNotification.type, {
    textDocument: { uri, version: 2 },
    contentChanges: [{ text: edited }],
  })
  writeFileSync(target.p, edited)
  seeded = 0
  refreshes = 0
  const refreshed = new Promise<void>((res) => (onRefresh = res))
  t = performance.now()
  await client.sendNotification(DidSaveTextDocumentNotification.type, { textDocument: { uri } })
  await client.sendNotification(DidChangeWatchedFilesNotification.type, {
    changes: [{ uri, type: FileChangeType.Changed }],
  })
  await hover()
  const saveBlocked = ms(t)
  const saveParsed = seeded
  await Promise.race([
    refreshed,
    new Promise((_, rej) => setTimeout(() => rej(new Error("no refresh within 30 s")), 30_000)),
  ])
  const t2 = performance.now()
  await pullAll()
  const savePull = ms(t2)
  const saveToFresh = ms(t)

  // A hover sent right behind a workspace pull (VS Code re-pulls 2 s after each one, so this is the common case).
  const pending = pullAll()
  t = performance.now()
  await hover()
  const hoverInPull = ms(t)
  await pending
  t = performance.now()
  await hover()
  const hoverIdle = ms(t)

  const sorted = [...idle].sort((a, b) => a - b)
  console.log(`\n== ${name}: ${files.length} source files; target ${target.p.slice(root.length + 1)} ==`)
  console.log(
    `crawl (initialized → first answer) ${f(crawl)}   disk entries parsed ${crawlParsed}   progress ${JSON.stringify(progress)}`,
  )
  console.log(`workspace pass                     ${f(pass)}   reports ${reports} (full ${full})`)
  console.log(
    `${IDLE_PULLS} idle pulls                      ${f(idleTotal)} total = ${(idleTotal / pass).toFixed(1)} passes   p50 ${f(sorted[5]!)}  unchanged reports ${unchanged}`,
  )
  console.log(
    `idle busy share at a 2 s re-pull   ${((100 * sorted[5]!) / (sorted[5]! + 2000)).toFixed(0)} % (p50 pull vs 2 s gap)`,
  )
  console.log(
    `save: disk entries re-parsed       ${saveParsed}   loop blocked ${f(saveBlocked)}   refreshes ${refreshes}   re-pull ${f(savePull)}   save → fresh ${f(saveToFresh)}`,
  )
  console.log(`hover behind a workspace pull      ${f(hoverInPull)}   (idle hover ${f(hoverIdle)})`)
  client.dispose()
}

for (const name of process.argv.length > 2 ? process.argv.slice(2) : ["pro2193", "lenze-mid"]) await bench(name)
process.exit(0)
