/**
 * The PULL diagnostics handlers (`handlers/diagnostics.ts`) over the harness: `textDocument/diagnostic` answers what the
 * push channel would, `workspace/diagnostic` reaches unopened files, and a workspace another Volt pulled is told once,
 * on its manifests. The push is `state.test.ts`'s.
 */
import { expect, test } from "bun:test"
import { rmSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  DocumentDiagnosticRequest,
  DidOpenTextDocumentNotification,
  InitializeRequest,
  WorkspaceDiagnosticRequest,
} from "vscode-languageserver-protocol/node"
import { MATERIALIZATION } from "../../frontend/library/index.js"
import { connect, URI, initInDir, tempWorkspace, PRG, ENUM } from "../../../test/lsp/sources.js"

test("server: textDocument/diagnostic pulls the same diagnostics as the push channel", async () => {
  const client = connect()
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  const bad = `FUNCTION_BLOCK F\nVAR\n b : BOOL; i : INT;\nEND_VAR\n%LANGUAGE ST\ni := b;\nEND_FUNCTION_BLOCK`
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: URI, languageId: "iecst", version: 1, text: bad },
  })
  const report = (await client.sendRequest(DocumentDiagnosticRequest.type, { textDocument: { uri: URI } })) as {
    kind: string
    items: { code?: unknown }[]
  }
  expect(report.kind).toBe("full")
  expect(report.items.some((d) => d.code === "C0032")).toBe(true)
  client.dispose()
})

test("server: workspace/diagnostic reports errors in unopened files (eager index)", async () => {
  const badFb = `FUNCTION_BLOCK F\nVAR\n b : BOOL; i : INT;\nEND_VAR\n%LANGUAGE ST\ni := b;\nEND_FUNCTION_BLOCK`
  const dir = tempWorkspace({ "F.pou": badFb })
  const client = connect()
  await initInDir(client, dir) // crawls F.pou without opening it
  const report = (await client.sendRequest(WorkspaceDiagnosticRequest.type, { previousResultIds: [] })) as {
    items: { uri: string; items: { code?: unknown }[] }[]
  }
  const fUri = pathToFileURL(join(dir, "F.pou")).href
  const fReport = report.items.find((r) => r.uri === fUri)
  expect(fReport?.items.some((d) => d.code === "C0032")).toBe(true)
  client.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test("server: a library an older bridge materialized is told to re-pull — on its manifest, and nowhere else", async () => {
  // format 1 skipped FUNCTIONs without a return type, so their calls read as undefined; the LSP keeps no list of those
  // names to paper over it (review 2026-09-26) — it says, on the manifest, what the repair is
  const lib = (name: string, materialization: string) =>
    `LIBRARY ${name}\nNAMESPACE ${name}\nRESOLUTION ${name}, 1.0.0.0 (x)\nPLACEHOLDER true\nSYSTEM true\n${materialization}`
  const dir = tempWorkspace({
    "Library Manager/Old/Old.library": lib("Old", ""),
    "Library Manager/New/New.library": lib("New", `MATERIALIZATION ${MATERIALIZATION}\n`),
    "PLC_PRG.pou": PRG,
    "E_Mode.dut": ENUM,
  })
  const client = connect()
  await initInDir(client, dir)
  const report = (await client.sendRequest(WorkspaceDiagnosticRequest.type, { previousResultIds: [] })) as {
    items: { uri: string; items: { code?: unknown; message: string }[] }[]
  }
  const oldUri = pathToFileURL(join(dir, "Library Manager/Old/Old.library")).href
  const stale = report.items.filter((r) => r.items.some((d) => d.code === "library-stale"))
  expect(stale.map((r) => r.uri)).toEqual([oldUri])
  expect(stale[0]!.items[0]!.message).toContain("volt pull")
  // pulled for the manifest itself, as a client does for an open file
  const pulled = (await client.sendRequest(DocumentDiagnosticRequest.type, { textDocument: { uri: oldUri } })) as {
    items: { code?: unknown }[]
  }
  expect(pulled.items.map((d) => d.code)).toEqual(["library-stale"])
  client.dispose()
  rmSync(dir, { recursive: true, force: true })
})

/** A graphical body the way format 2 wrote it: network text v1, behind the retired bare comment marker. */
const V1_BODY = `FUNCTION_BLOCK F\nVAR a : BOOL; out : BOOL;\nEND_VAR\n(* @volt-implementation *)\nNETWORK 0 LD\n  out := a;\nEND_NETWORK\n\nEND_FUNCTION_BLOCK`

/** …the way format 3 wrote it: network text v2, behind the retired comment marker naming its language… */
const RETIRED_MARKER_BODY = `FUNCTION_BLOCK F\nVAR a : BOOL; out : BOOL;\nEND_VAR\n(* @volt-implementation LD *)\nNETWORK\n  out := a;\nEND_NETWORK\n\nEND_FUNCTION_BLOCK`

/** …and the way a pull writes it: network text under the line that states its language. */
const NETWORK_BODY = `FUNCTION_BLOCK F\nVAR a : BOOL; out : BOOL;\nEND_VAR\n%LANGUAGE LD\n%NETWORK\nout := a;\n\nEND_FUNCTION_BLOCK`

/** …and one with a finding of its own: a wire used without its `%WIRES` declaration. */
const FLAWED_NETWORK_BODY = `FUNCTION_BLOCK F\nVAR a : BOOL; out : BOOL;\nEND_VAR\n%LANGUAGE LD\n%NETWORK\nw5 := a;\nout := w5;\n\nEND_FUNCTION_BLOCK`

/** Every diagnostic of a workspace, by file name. */
async function workspaceDiagnostics(files: Record<string, string>) {
  const dir = tempWorkspace(files)
  const client = connect()
  await initInDir(client, dir)
  const report = (await client.sendRequest(WorkspaceDiagnosticRequest.type, { previousResultIds: [] })) as {
    items: { uri: string; items: { code?: unknown; message: string }[] }[]
  }
  client.dispose()
  rmSync(dir, { recursive: true, force: true })
  const byFile = new Map<string, { code?: unknown; message: string }[]>()
  for (const r of report.items)
    if (r.items.length > 0) byFile.set(decodeURIComponent(r.uri).split("/").at(-1)!, r.items)
  return byFile
}

const libAt = (format: string) =>
  `LIBRARY Standard\nNAMESPACE Standard\nRESOLUTION Standard, 1.0.0.0 (x)\nPLACEHOLDER true\nSYSTEM true\n${format}`

test("server: a workspace an OLDER Volt pulled is told once, on its manifests — not with a finding on every graphical body", async () => {
  // MATERIALIZATION 3 is network text v2; format 2 wrote v1, which the parser refuses body by body (re-pull). With the
  // workspace's own number in hand, the mismatch is named where the repair is decided, and the bodies stay quiet.
  const diags = await workspaceDiagnostics({
    "Library Manager/Standard/Standard.library": libAt("MATERIALIZATION 2\n"),
    "F.pou": V1_BODY,
  })
  const manifest = diags.get("Standard.library") ?? []
  expect(manifest.map((d) => d.code)).toEqual(["library-stale"])
  expect(manifest[0]!.message).toContain("volt pull")
  expect(diags.get("F.pou") ?? []).toEqual([])
})

test("server: a workspace format 3 pulled is told once that its bodies state no language — its ladders are not ST errors", async () => {
  // Format 3 marked the boundary with a comment: to this server a line-less ladder is an ST body, and every rung a
  // parse error. The manifest names the re-pull (once — it no longer lists what each format lacked), and the bodies that
  // state no language stay quiet.
  const diags = await workspaceDiagnostics({
    "Library Manager/Standard/Standard.library": libAt("MATERIALIZATION 3\n"),
    "F.pou": RETIRED_MARKER_BODY,
  })
  const manifest = diags.get("Standard.library") ?? []
  expect(manifest.map((d) => d.code)).toEqual(["library-stale"])
  expect(manifest[0]!.message).toContain("volt pull")
  expect(diags.get("F.pou") ?? []).toEqual([])
})

test("server: a workspace a NEWER Volt pulled names the language server as the stale side", async () => {
  // The volt-vscode bundle carries its own LSP and can lag the CLI: an old one meeting a newer materialization must
  // say so once, not misread every body the newer format wrote.
  // The body must be one that DOES draw a network-text finding at this server's own format — a clean one says nothing
  // either way, and the suppression would go untested.
  const atOwnFormat = await workspaceDiagnostics({
    "Library Manager/Standard/Standard.library": libAt(`MATERIALIZATION ${MATERIALIZATION}\n`),
    "F.pou": FLAWED_NETWORK_BODY,
  })
  expect((atOwnFormat.get("F.pou") ?? []).length).toBeGreaterThan(0)

  const diags = await workspaceDiagnostics({
    "Library Manager/Standard/Standard.library": libAt(`MATERIALIZATION ${MATERIALIZATION + 1}\n`),
    "F.pou": FLAWED_NETWORK_BODY,
  })
  const manifest = diags.get("Standard.library") ?? []
  expect(manifest.map((d) => d.code)).toEqual(["materialization-newer"])
  expect(manifest[0]!.message).toContain("newer Volt")
  expect(manifest[0]!.message).toContain(`format ${MATERIALIZATION + 1}`)
  expect(diags.get("F.pou") ?? []).toEqual([])
})

test("server: a workspace at the LSP's own materialization says nothing about it", async () => {
  const diags = await workspaceDiagnostics({
    "Library Manager/Standard/Standard.library": libAt(`MATERIALIZATION ${MATERIALIZATION}\n`),
    "F.pou": NETWORK_BODY,
  })
  expect(diags.get("Standard.library") ?? []).toEqual([])
  expect(diags.get("F.pou") ?? []).toEqual([])
})

test("server: without a manifest, a file whose bodies state no language is told to `volt pull` — its ladder is not ST errors", async () => {
  // No manifest states a format (a workspace with no library), so the file itself is the only place left to say it —
  // and it does: the body states no language, which the push refuses naming `volt pull` (`StReader.Unmarked`). A
  // `(* @volt-… *)` comment there is a comment, named by nothing (no users, no backward compat). Read as ST every rung
  // would be a parse error meaning only "this body states no language": those stay quiet.
  for (const [format, body] of [
    ["format 2 (v1)", V1_BODY],
    ["format 3", RETIRED_MARKER_BODY],
  ] as const) {
    const messages = [
      ...new Set(((await workspaceDiagnostics({ "F.pou": body })).get("F.pou") ?? []).map((d) => d.message)),
    ]
    const first = messages[0] ?? ""
    expect({
      format,
      count: messages.length,
      pull: first.includes("volt pull"),
    }).toEqual({
      format,
      count: 1,
      pull: true,
    })
  }
})

