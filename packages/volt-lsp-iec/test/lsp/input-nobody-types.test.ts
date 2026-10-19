/**
 * DOES THE SERVER ANSWER INPUT NOBODY TYPES? (openspec lsp-size-fuzz) — a document nested, chained or long far past
 * anything real is answered with its findings or with ONE `not-analysed` error, never a failed request, and the server
 * keeps answering every other document. PLC Assist found the first such crash (5000 nested parentheses, a stack
 * overflow; openspec lsp-deep-input-no-stack-overflow) with input the suite never fed: every other suite opens friendly
 * code.
 *
 * Generated here, in the test, never committed: deep parentheses, nested `IF`, flat `+` and `OR` chains, and a long
 * file. Each runs on the SHIPPED runtime — `src/server/bin.ts` bundled for node the way the VS Code extension bundles it
 * (`bun build --target=node --format=cjs`), spawned under `node` and driven over stdio — and on bun, in process.
 *
 * Sizes are just past each runtime's measured limit (2026-10-19, the server answering `not-analysed` from):
 *
 * | Input | node 24 (server) | bun, Windows | bun, Linux | corpus max (26451 files) |
 * |---|---|---|---|---|
 * | nested parentheses | 1000 | 10000 | 10000 | 7 |
 * | nested `IF` | 1000 | 5000 | 10000 | 8 (statement nesting) |
 * | flat `+` chain | 3000 | 20000 | 20000 | 29 (binary chain) |
 * | flat `OR` chain | 3000 | 10000 | 10000 | 29 (binary chain) |
 *
 * Node takes the proposal's library-call limits (parentheses 3000, `IF` 1500, chains 5000), which the server passes
 * sooner; bun takes the first size past both of its OSes. Just past matters for the suite's time: below the limit a flat
 * chain or a deep `IF` is analysed in time quadratic in its length (bun: a 10000-term `+` chain ~43 s), past it the
 * overflow answers in milliseconds.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createProtocolConnection,
  DidOpenTextDocumentNotification,
  DocumentDiagnosticRequest,
  InitializeRequest,
  RegistrationRequest,
  StreamMessageReader,
  StreamMessageWriter,
  WorkspaceDiagnosticRequest,
  type Diagnostic,
  type ProtocolConnection,
} from "vscode-languageserver-protocol/node"
import { CAPS, harness } from "./harness.js"

const PRG = (name: string, body: string) =>
  `PROGRAM ${name}\nVAR\n\tb : BOOL;\n\ti : INT;\nEND_VAR\nIMPLEMENTATION ST\n${body}\nEND_PROGRAM\n`

const SHAPES = ["parentheses", "nested IF", "flat +", "flat OR", "long file"] as const
type Shape = (typeof SHAPES)[number]

/** The generators: each body at size `n`. */
const GENERATE: Record<Shape, (n: number) => string> = {
  parentheses: (n: number) => `i := ${"(".repeat(n)}1${")".repeat(n)};`,
  "nested IF": (n: number) => `${"IF b THEN\n".repeat(n)}i := 1;\n${"END_IF\n".repeat(n)}`,
  "flat +": (n: number) => `i := 1${" + 1".repeat(n)};`,
  "flat OR": (n: number) => `b := b${" OR b".repeat(n)};`,
  "long file": (n: number) => "i := i + 1;\n".repeat(n),
}

/** Past each runtime's limit (the table above); the long file has no limit and is sized past any real file. */
const SIZES: Record<"node" | "bun", Record<Shape, number>> = {
  node: { parentheses: 3000, "nested IF": 1500, "flat +": 5000, "flat OR": 5000, "long file": 50_000 },
  bun: { parentheses: 20_000, "nested IF": 10_000, "flat +": 20_000, "flat OR": 20_000, "long file": 50_000 },
}

/** A document of every shape, at the runtime's size; the program is named after its file. */
function generated(runtime: "node" | "bun", prefix: string): { shape: Shape; uri: string; text: string }[] {
  return SHAPES.map((shape, k) => {
    const name = `${prefix}${k}`
    return { shape, uri: `file:///${name}.pou`, text: PRG(name, GENERATE[shape](SIZES[runtime][shape])) }
  })
}

/** A friendly document beside them, with its own finding (C0032: BOOL assigned to INT). */
const FRIENDLY = { uri: "file:///Main.pou", text: PRG("Main", "i := b;") }

/** The contract: findings, or exactly one `not-analysed` error and nothing else. */
function expectAnswered(items: Diagnostic[], what: string) {
  const codes = items.map((d) => d.code)
  if (codes.includes("not-analysed")) expect(codes, what).toEqual(["not-analysed"])
}

/** What one runtime's server is asked: open, pull, pull the workspace. */
interface Client {
  open(uri: string, text: string): Promise<void>
  pull(uri: string): Promise<Diagnostic[]>
  workspacePull(): Promise<Map<string, Diagnostic[]>>
}

/** The questions, the same on both runtimes. */
function questions(runtime: "node" | "bun", client: () => Client) {
  const docs = generated(runtime, "G")
  // The workspace question opens its own copies: a document is opened once.
  const again = generated(runtime, "W")

  test.each(docs.map((d) => [d.shape, d] as const))(
    "%s past the limit is answered with findings or one `not-analysed`, never a failed request",
    async (_shape, d) => {
      await client().open(d.uri, d.text)
      expectAnswered(await client().pull(d.uri), d.shape)
    },
    60_000,
  )

  test("the long file is analysed: nothing in it is past a limit", async () => {
    const long = docs.find((d) => d.shape === "long file")!
    await client().open(long.uri, long.text)
    expect((await client().pull(long.uri)).map((d) => d.code)).not.toContain("not-analysed")
  }, 60_000)

  test("parentheses past the stack: one `not-analysed`, and the workspace pull answers every other document", async () => {
    await client().open(FRIENDLY.uri, FRIENDLY.text)
    for (const d of again) await client().open(d.uri, d.text)
    const reports = await client().workspacePull()
    const deep = again.find((d) => d.shape === "parentheses")!
    expect((reports.get(deep.uri) ?? []).map((d) => d.code)).toEqual(["not-analysed"])
    for (const d of again) expectAnswered(reports.get(d.uri) ?? [], d.shape)
    expect((reports.get(FRIENDLY.uri) ?? []).map((d) => d.code)).toContain("C0032")
    // Still serving after all of it.
    expect((await client().pull(FRIENDLY.uri)).map((d) => d.code)).toContain("C0032")
  }, 60_000)
}

async function workspaceItems(c: ProtocolConnection): Promise<Map<string, Diagnostic[]>> {
  const r = await c.sendRequest(WorkspaceDiagnosticRequest.type, { previousResultIds: [] })
  return new Map(r.items.map((i) => [i.uri, i.kind === "full" ? i.items : []]))
}

describe("node — the shipped bundle over stdio", () => {
  let dir = ""
  let server: ChildProcess | undefined
  let conn: ProtocolConnection | undefined
  const stderr: string[] = []

  beforeAll(async () => {
    const node = Bun.which("node")
    if (node === null) throw new Error("node is not on PATH: the shipped runtime cannot be tested")
    dir = mkdtempSync(join(tmpdir(), "volt-lsp-node-"))
    const built = await Bun.build({
      entrypoints: [join(import.meta.dir, "..", "..", "src", "server", "bin.ts")],
      outdir: dir,
      target: "node",
      format: "cjs",
    })
    if (!built.success) throw new AggregateError(built.logs, "bundling src/server/bin.ts for node failed")
    const child = spawn(node, [built.outputs[0].path, "--stdio", "--codesys"], { stdio: ["pipe", "pipe", "pipe"] })
    server = child
    child.stderr.on("data", (b: Buffer) => stderr.push(b.toString()))
    conn = createProtocolConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin))
    conn.onRequest(RegistrationRequest.type, () => {})
    conn.listen()
    await conn.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: CAPS.pull })
  }, 60_000)

  afterAll(() => {
    // The server must still be running: a crash ends the process, whatever the requests answered.
    const alive = server?.exitCode === null && server.signalCode === null
    conn?.dispose()
    server?.kill()
    rmSync(dir, { recursive: true, force: true })
    if (!alive) throw new Error(`the node server exited during the suite: ${stderr.join("")}`)
  })

  questions("node", () => ({
    open: (uri, text) =>
      conn!.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri, languageId: "iecst", version: 1, text },
      }),
    pull: async (uri) => {
      const r = await conn!.sendRequest(DocumentDiagnosticRequest.type, { textDocument: { uri } })
      return r.kind === "full" ? r.items : []
    },
    workspacePull: () => workspaceItems(conn!),
  }))
})

describe("bun — in process", () => {
  const h = harness()
  beforeAll(() => h.init(CAPS.pull))
  afterAll(() => h.dispose())

  questions("bun", () => ({
    open: (uri, text) => h.open(uri, text),
    pull: (uri) => h.pull(uri),
    workspacePull: async () => new Map((await h.workspacePull()).map((r) => [r.uri, r.items])),
  }))
})
