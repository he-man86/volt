/** A rename to a name the dialect refuses is refused by name over the wire (lsp-same-standard 3.1, finding R6). */
import { expect, test } from "bun:test"
import { DidOpenTextDocumentNotification, InitializeRequest, RenameRequest } from "vscode-languageserver-protocol/node"
import { connectToServer } from "../../test/server/harness.js"

const URI = "file:///F.pou"
const SRC = `FUNCTION_BLOCK F\nVAR\n\tcount : INT;\nEND_VAR\nIMPLEMENTATION ST\ncount := count + 1;\nEND_FUNCTION_BLOCK`

async function renameTo(newName: string): Promise<unknown> {
  const client = connectToServer("codesys")
  try {
    await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
    await client.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri: URI, languageId: "iecst", version: 1, text: SRC } })
    return await client.sendRequest(RenameRequest.type, { textDocument: { uri: URI }, position: { line: 5, character: 1 }, newName })
  } finally {
    client.dispose()
  }
}

test("rename to a keyword is refused, naming the name", async () => {
  await expect(renameTo("IF")).rejects.toThrow("'IF' is no name a declaration accepts")
})

test("rename to a valid name edits every occurrence", async () => {
  const edit = (await renameTo("total")) as { changes: Record<string, unknown[]> }
  expect(edit.changes[URI]).toHaveLength(3)
})
