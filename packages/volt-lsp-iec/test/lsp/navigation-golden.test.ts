/**
 * Navigation golden checks (behavior-conformance). Pin the exact wire shape of the core navigations so a
 * regression in the response envelope (uri, range) is caught, not just the analysis result. The unit tests
 * assert the service output; these assert what a client receives over the protocol.
 */
import { test, expect } from "bun:test"
import { DefinitionRequest, HoverRequest, ReferencesRequest } from "vscode-languageserver-protocol/node.js"
import { CAPS, harness } from "./harness.js"

const URI = "file:///F.fb"
//                        line0                    line1  line2 (decl)      line3      line4 (usages)
const SRC = `FUNCTION_BLOCK F\nVAR\n\tcount : INT;\nEND_VAR\ncount := count + 1;\nEND_FUNCTION_BLOCK`

async function open() {
  const h = harness()
  await h.init(CAPS.pull)
  await h.open(URI, SRC)
  return h
}

test("definition: a body usage resolves to the declaration, exact wire shape", async () => {
  const h = await open()
  const def = await h.request<unknown, { uri: string; range: { start: { line: number; character: number } } }>(
    DefinitionRequest.type,
    { textDocument: { uri: URI }, position: { line: 4, character: 0 } }, // the `count` usage
  )
  expect(def.uri).toBe(URI)
  expect(def.range.start).toEqual({ line: 2, character: 1 }) // `count` decl, after the tab
  h.dispose()
})

test("hover: renders the declaration", async () => {
  const h = await open()
  const hov = await h.request<unknown, { contents: { value: string } }>(HoverRequest.type, {
    textDocument: { uri: URI },
    position: { line: 4, character: 0 },
  })
  expect(hov.contents.value).toContain("count : INT")
  h.dispose()
})

test("references: both usages + declaration, each a wire Location", async () => {
  const h = await open()
  const refs = await h.request<unknown, { uri: string; range: unknown }[]>(ReferencesRequest.type, {
    textDocument: { uri: URI },
    position: { line: 4, character: 0 },
    context: { includeDeclaration: true },
  })
  // decl (line 2) + two usages on line 4 = 3 locations, all in this file.
  expect(refs.length).toBe(3)
  expect(refs.every((r) => r.uri === URI)).toBe(true)
  expect(refs.map((r) => (r.range as { start: { line: number } }).start.line).sort()).toEqual([2, 4, 4])
  h.dispose()
})
