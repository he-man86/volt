/**
 * The FORMATTING handlers (`handlers/formatting.ts`) over the harness: the whole document, and format-on-type, which
 * indents the new line and reprints nothing.
 */
import { describe, expect, test } from "bun:test"
import {
  DidOpenTextDocumentNotification,
  DocumentFormattingRequest,
  DocumentOnTypeFormattingRequest,
  InitializeRequest,
} from "vscode-languageserver-protocol/node"
import { connect, openF, td } from "../../../test/lsp/sources.js"
import { connectToServer } from "../../../test/lsp/harness.js"

test("server: formatting responds without error", async () => {
  const client = connect()
  await openF(client)
  const edits = (await client.sendRequest(DocumentFormattingRequest.type, {
    ...td,
    options: { tabSize: 2, insertSpaces: true },
  })) as unknown[]
  expect(Array.isArray(edits)).toBe(true)
  client.dispose()
})

describe("on-type formatting (lsp-same-standard finding R2)", () => {
  /**
   * ON-TYPE FORMATTING INDENTS THE NEW LINE, AND DOES NOTHING ELSE (lsp-same-standard 3.1, finding R2).
   *
   * The server answered `textDocument/onTypeFormatting` with RANGE formatting of the trigger's line — a reprint of the
   * whole unit around it, on every `;` and every newline — while `formatOnType`, the auto-indent written and tested for
   * exactly this request, had no caller. Typing reflowed the POU under the cursor.
   */
  const URI = "file:///P.pou"

  // unformatted on purpose (`i:=1;`): a reprint would show as an edit
  const SRC = `PROGRAM P\nVAR\n  i : INT;\nEND_VAR\nIMPLEMENTATION ST\nFOR i:=0 TO 10 DO\n\nEND_FOR\ni:=1;\nEND_PROGRAM\n`

  async function onType(ch: string, line: number, character: number): Promise<unknown> {
    const client = connectToServer("codesys")
    try {
      const init = await client.sendRequest(InitializeRequest.type, {
        processId: null,
        rootUri: null,
        capabilities: {},
      })
      expect(init.capabilities.documentOnTypeFormattingProvider).toEqual({ firstTriggerCharacter: "\n" })
      await client.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri: URI, languageId: "iecst", version: 1, text: SRC },
      })
      return await client.sendRequest(DocumentOnTypeFormattingRequest.type, {
        textDocument: { uri: URI },
        position: { line, character },
        ch,
        options: { tabSize: 4, insertSpaces: false },
      })
    } finally {
      client.dispose()
    }
  }

  test("a newline inside a block indents the new line to its depth — one edit, at the cursor", async () => {
    expect(await onType("\n", 6, 0)).toEqual([
      { range: { start: { line: 6, character: 0 }, end: { line: 6, character: 0 } }, newText: "\t" },
    ])
  })

  test("a `;` reprints nothing: the unit around it keeps its layout", async () => {
    expect(await onType(";", 8, 5)).toEqual([])
  })
})
