/**
 * A RANGE'S ENDS ARE CLAMPED, AS LSP SAYS (lsp-same-standard 3.1, finding R7b): a character past its line's end is the
 * line's end, a line past the last is the end of the text. Read as cursor positions instead, an end past the text was
 * "nowhere" (-1) and a request for the whole document — semantic tokens, inlay hints, range formatting — answered nothing.
 */
import { expect, test } from "bun:test"
import {
  DidOpenTextDocumentNotification,
  InitializeRequest,
  InlayHintRequest,
  SemanticTokensRangeRequest,
  SemanticTokensRequest,
} from "vscode-languageserver-protocol/node"
import { connectToServer } from "../../test/server/harness.js"

const URI = "file:///P.pou"
const SRC = `FUNCTION F : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nIMPLEMENTATION ST\nF := a;\nEND_FUNCTION\nPROGRAM P\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := F(1);\nEND_PROGRAM`
const PAST_THE_END = { start: { line: 0, character: 0 }, end: { line: 999, character: 0 } }

test("a range past the end of the text covers the whole document", async () => {
  const client = connectToServer("codesys")
  try {
    await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
    await client.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri: URI, languageId: "iecst", version: 1, text: SRC } })
    const full = await client.sendRequest(SemanticTokensRequest.type, { textDocument: { uri: URI } })
    const ranged = await client.sendRequest(SemanticTokensRangeRequest.type, { textDocument: { uri: URI }, range: PAST_THE_END })
    expect(ranged?.data).toEqual(full!.data)
    const hints = await client.sendRequest(InlayHintRequest.type, { textDocument: { uri: URI }, range: PAST_THE_END })
    expect(hints?.map((h) => h.label)).toEqual(["a:"])
  } finally {
    client.dispose()
  }
})
