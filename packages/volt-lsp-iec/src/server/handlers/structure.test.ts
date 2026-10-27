/**
 * The STRUCTURE handlers (`handlers/structure.ts`) over the harness: document and workspace symbols, folding, selection,
 * and the semantic tokens — full, range (its ends clamped, as LSP says) and delta.
 */
import { describe, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import {
  DidChangeTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DocumentSymbolRequest,
  FoldingRangeRequest,
  InitializeRequest,
  InlayHintRequest,
  SelectionRangeRequest,
  SemanticTokensDeltaRequest,
  SemanticTokensRangeRequest,
  SemanticTokensRequest,
  WorkspaceSymbolRequest,
} from "vscode-languageserver-protocol/node"
import { connect, SRC, URI, openF, td, initInDir, tempWorkspace, PRG, ENUM } from "../../../test/lsp/sources.js"
import { connectToServer } from "../../../test/lsp/harness.js"

test("server: documentSymbol returns the outline", async () => {
  const client = connect()
  await openF(client)
  const syms = await client.sendRequest(DocumentSymbolRequest.type, { textDocument: { uri: URI } })
  expect((syms as { name: string }[])[0]?.name).toBe("F")
  client.dispose()
})

test("server: structural requests (selectionRange, foldingRange, semanticTokens) respond", async () => {
  const client = connect()
  await openF(client)
  const sel = (await client.sendRequest(SelectionRangeRequest.type, {
    ...td,
    positions: [{ line: 4, character: 0 }],
  })) as unknown[]
  expect(sel.length).toBe(1)
  const folds = (await client.sendRequest(FoldingRangeRequest.type, td)) as unknown[]
  expect(folds.length).toBeGreaterThan(0)
  const tokens = (await client.sendRequest(SemanticTokensRequest.type, td)) as { data: number[] }
  expect(tokens.data.length % 5).toBe(0)
  client.dispose()
})

test("server: semanticTokens/range returns tokens for the viewport only (multiple of 5)", async () => {
  const client = connect()
  await openF(client)
  const tokens = (await client.sendRequest(SemanticTokensRangeRequest.type, {
    textDocument: { uri: URI },
    range: { start: { line: 0, character: 0 }, end: { line: 3, character: 0 } },
  })) as { data: number[] }
  expect(tokens.data.length).toBeGreaterThan(0)
  expect(tokens.data.length % 5).toBe(0)
  client.dispose()
})

test("server: semanticTokens/full/delta returns edits against the prior result id", async () => {
  const client = connect()
  await openF(client)
  const full = (await client.sendRequest(SemanticTokensRequest.type, td)) as { resultId: string; data: number[] }
  expect(typeof full.resultId).toBe("string")
  // Change a declared type (INT→REAL) so the token stream actually differs.
  await client.sendNotification(DidChangeTextDocumentNotification.type, {
    textDocument: { uri: URI, version: 2 },
    contentChanges: [{ text: SRC.replace("INT", "REAL") }],
  })
  const delta = (await client.sendRequest(SemanticTokensDeltaRequest.type, {
    textDocument: { uri: URI },
    previousResultId: full.resultId,
  })) as { resultId: string; edits?: { start: number; deleteCount: number; data: number[] }[]; data?: number[] }
  expect(typeof delta.resultId).toBe("string")
  expect(Array.isArray(delta.edits)).toBe(true) // matched the prior id → a diff, not a full set
  client.dispose()
})

test("server: workspaceSymbol finds a DUT in an unopened file and narrows by query", async () => {
  const dir = tempWorkspace({ "E_Mode.dut": ENUM, "PLC_PRG.pou": PRG })
  const client = connect()
  await initInDir(client, dir) // eager crawl indexes both files without opening them
  const all = (await client.sendRequest(WorkspaceSymbolRequest.type, { query: "E_Mode" })) as {
    name: string
    location: { uri: string }
  }[]
  expect(all.some((s) => s.name === "E_Mode")).toBe(true)
  // The query narrows — an unrelated substring returns no E_Mode.
  const narrowed = (await client.sendRequest(WorkspaceSymbolRequest.type, { query: "zzz" })) as { name: string }[]
  expect(narrowed.some((s) => s.name === "E_Mode")).toBe(false)
  client.dispose()
  rmSync(dir, { recursive: true, force: true })
})

describe("a range's ends are clamped (lsp-same-standard finding R7b)", () => {
  /**
   * A RANGE'S ENDS ARE CLAMPED, AS LSP SAYS (lsp-same-standard 3.1, finding R7b): a character past its line's end is the
   * line's end, a line past the last is the end of the text. Read as cursor positions instead, an end past the text was
   * "nowhere" (-1) and a request for the whole document — semantic tokens, inlay hints, range formatting — answered nothing.
   */
  const URI = "file:///P.pou"

  const SRC = `FUNCTION F : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\n%LANGUAGE ST\nF := a;\nEND_FUNCTION\nPROGRAM P\nVAR\n\tn : INT;\nEND_VAR\n%LANGUAGE ST\nn := F(1);\nEND_PROGRAM`

  const PAST_THE_END = { start: { line: 0, character: 0 }, end: { line: 999, character: 0 } }

  test("a range past the end of the text covers the whole document", async () => {
    const client = connectToServer("codesys")
    try {
      await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
      await client.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri: URI, languageId: "iecst", version: 1, text: SRC },
      })
      const full = await client.sendRequest(SemanticTokensRequest.type, { textDocument: { uri: URI } })
      const ranged = await client.sendRequest(SemanticTokensRangeRequest.type, {
        textDocument: { uri: URI },
        range: PAST_THE_END,
      })
      expect(ranged?.data).toEqual(full!.data)
      const hints = await client.sendRequest(InlayHintRequest.type, { textDocument: { uri: URI }, range: PAST_THE_END })
      expect(hints?.map((h) => h.label)).toEqual(["a:"])
    } finally {
      client.dispose()
    }
  })
})
