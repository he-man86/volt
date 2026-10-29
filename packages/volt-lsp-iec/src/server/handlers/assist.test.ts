/**
 * The ASSIST handlers (`handlers/assist.ts`) over the harness: hover (in ST and in network text), completion, signature
 * help, inlay hints, code lenses and code actions.
 */
import { expect, test } from "bun:test"
import {
  CodeActionRequest,
  CodeLensRequest,
  CompletionRequest,
  DidOpenTextDocumentNotification,
  HoverRequest,
  InitializeRequest,
  InlayHintRequest,
  SignatureHelpRequest,
} from "vscode-languageserver-protocol/node"
import { connect, URI, openF, td, atCount } from "../../../test/lsp/sources.js"

test("server: didOpen → hover returns the declaration", async () => {
  const client = connect()
  await openF(client)
  const h = await client.sendRequest(HoverRequest.type, {
    textDocument: { uri: URI },
    position: { line: 4, character: 0 },
  })
  expect((h as { contents: { value: string } })?.contents.value).toContain("count : INT")
  client.dispose()
})

test("server: hover inside a network-text body resolves a wire", async () => {
  const client = connect()
  const vg = `FUNCTION_BLOCK F\nVAR a : BOOL; b : BOOL; out : BOOL;\nEND_VAR\n%LANGUAGE LD\n%NETWORK\nVAR_TEMP w1 : ANY; END_VAR\nw1 := a AND b;\nout := w1;\nEND_FUNCTION_BLOCK`
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: URI, languageId: "iecst", version: 1, text: vg },
  })
  const h = await client.sendRequest(HoverRequest.type, {
    textDocument: { uri: URI },
    position: { line: 7, character: 7 }, // the `w1` use in `out := w1;`
  })
  expect((h as { contents: { value: string } })?.contents.value).toContain("w1")
  client.dispose()
})

// the `count :=` usage

test("server: completion returns items in scope", async () => {
  const client = connect()
  await openF(client)
  const items = (await client.sendRequest(CompletionRequest.type, atCount)) as { label: string }[]
  expect(Array.isArray(items)).toBe(true)
  expect(items.some((i) => i.label === "count")).toBe(true)
  client.dispose()
})

test("server: assist requests (signatureHelp, inlayHint, codeAction) respond without error", async () => {
  const client = connect()
  await openF(client)
  // These may legitimately return null/empty for this source — the point is the handler runs + routes.
  await client.sendRequest(SignatureHelpRequest.type, atCount)
  const hints = (await client.sendRequest(InlayHintRequest.type, {
    ...td,
    range: { start: { line: 0, character: 0 }, end: { line: 6, character: 0 } },
  })) as unknown[]
  expect(Array.isArray(hints)).toBe(true)
  const actions = (await client.sendRequest(CodeActionRequest.type, {
    ...td,
    range: { start: { line: 4, character: 0 }, end: { line: 4, character: 5 } },
    context: { diagnostics: [] },
  })) as unknown[]
  expect(Array.isArray(actions)).toBe(true)
  client.dispose()
})

test("server: codeLens responds", async () => {
  const client = connect()
  await openF(client)
  const lenses = (await client.sendRequest(CodeLensRequest.type, td)) as unknown[]
  expect(Array.isArray(lenses)).toBe(true)
  client.dispose()
})
