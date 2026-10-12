/**
 * The server's NAVIGATION and ASSIST handlers over the harness (`handlers/navigation.ts`, `handlers/assist.ts`):
 * completion, references and highlights, rename, the call and type hierarchies, hover in network text.
 */
import { test, expect } from "bun:test"
import {
  CallHierarchyIncomingCallsRequest,
  CallHierarchyOutgoingCallsRequest,
  CallHierarchyPrepareRequest,
  CompletionRequest,
  DidOpenTextDocumentNotification,
  DocumentHighlightRequest,
  HoverRequest,
  InitializeRequest,
  PrepareRenameRequest,
  ReferencesRequest,
  RenameRequest,
  TypeHierarchyPrepareRequest,
  TypeHierarchySubtypesRequest,
  TypeHierarchySupertypesRequest,
  type CallHierarchyItem,
  type TypeHierarchyItem,
} from "vscode-languageserver-protocol/node"
import { connect, URI, openF, atCount } from "../../test/server/sources.js"

test("server: hover inside a network-text body resolves a wire's declared type", async () => {
  const client = connect()
  const vg = `FUNCTION_BLOCK F\nVAR a : BOOL; b : BOOL; out : BOOL;\nEND_VAR\nIMPLEMENTATION LD\nNETWORK\nVAR_TEMP g1 : BOOL; END_VAR\ng1 := (a AND b);\nout := g1;\nEND_NETWORK\nEND_FUNCTION_BLOCK`
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: URI, languageId: "iecst", version: 1, text: vg },
  })
  const h = await client.sendRequest(HoverRequest.type, {
    textDocument: { uri: URI },
    position: { line: 7, character: 7 }, // the `g1` use in `out := g1;`
  })
  expect((h as { contents: { value: string } })?.contents.value).toContain("g1 : BOOL")
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

test("server: references + documentHighlight cover every binding", async () => {
  const client = connect()
  await openF(client)
  const refs = (await client.sendRequest(ReferencesRequest.type, {
    ...atCount,
    context: { includeDeclaration: true },
  })) as unknown[]
  expect(refs.length).toBe(3) // decl + two uses
  const hl = (await client.sendRequest(DocumentHighlightRequest.type, atCount)) as unknown[]
  expect(hl.length).toBe(3)
  client.dispose()
})

test("server: prepareRename + rename produce a workspace edit", async () => {
  const client = connect()
  await openF(client)
  const range = await client.sendRequest(PrepareRenameRequest.type, atCount)
  expect(range).toBeDefined()
  const edit = (await client.sendRequest(RenameRequest.type, { ...atCount, newName: "tally" })) as {
    changes: Record<string, unknown[]>
  }
  expect(edit.changes[URI]?.length).toBe(3)
  client.dispose()
})

// ─── workspace navigation: call/type hierarchy + workspace symbol ───────────────────────────────

const CALLS = `FUNCTION Helper : INT
Helper := 1;
END_FUNCTION
FUNCTION Caller : INT
Caller := Helper();
END_FUNCTION`

const CALLS_URI = "file:///Calls.pou"

async function openCalls(client: ReturnType<typeof connect>) {
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: CALLS_URI, languageId: "iecst", version: 1, text: CALLS },
  })
}

test("server: call hierarchy — incoming reports the caller with ranges (from/fromRanges)", async () => {
  const client = connect()
  await openCalls(client)
  const prep = (await client.sendRequest(CallHierarchyPrepareRequest.type, {
    textDocument: { uri: CALLS_URI },
    position: { line: 0, character: 11 }, // the `Helper` in `FUNCTION Helper`
  })) as CallHierarchyItem[]
  expect(prep[0]?.name).toBe("Helper")
  const incoming = (await client.sendRequest(CallHierarchyIncomingCallsRequest.type, { item: prep[0]! })) as {
    from: { name: string }
    fromRanges: unknown[]
  }[]
  expect(incoming[0]?.from.name).toBe("Caller")
  expect(incoming[0]?.fromRanges.length).toBeGreaterThan(0)
  client.dispose()
})

test("server: call hierarchy — outgoing lists the callee (to/fromRanges)", async () => {
  const client = connect()
  await openCalls(client)
  const prep = (await client.sendRequest(CallHierarchyPrepareRequest.type, {
    textDocument: { uri: CALLS_URI },
    position: { line: 3, character: 11 }, // the `Caller` in `FUNCTION Caller`
  })) as CallHierarchyItem[]
  expect(prep[0]?.name).toBe("Caller")
  const outgoing = (await client.sendRequest(CallHierarchyOutgoingCallsRequest.type, { item: prep[0]! })) as {
    to: { name: string }
    fromRanges: unknown[]
  }[]
  expect(outgoing.map((o) => o.to.name)).toContain("Helper")
  expect(outgoing[0]?.fromRanges.length).toBeGreaterThan(0)
  client.dispose()
})

const OOP = `FUNCTION_BLOCK Base
END_FUNCTION_BLOCK
FUNCTION_BLOCK Derived EXTENDS Base
END_FUNCTION_BLOCK`

const OOP_URI = "file:///Oop.pou"

test("server: type hierarchy — supertypes and subtypes span the workspace", async () => {
  const client = connect()
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: OOP_URI, languageId: "iecst", version: 1, text: OOP },
  })
  // Prepare on Derived → its supertype is Base.
  const prepDerived = (await client.sendRequest(TypeHierarchyPrepareRequest.type, {
    textDocument: { uri: OOP_URI },
    position: { line: 2, character: 17 }, // the `Derived` in `FUNCTION_BLOCK Derived`
  })) as TypeHierarchyItem[]
  expect(prepDerived[0]?.name).toBe("Derived")
  const supers = (await client.sendRequest(TypeHierarchySupertypesRequest.type, { item: prepDerived[0]! })) as {
    name: string
  }[]
  expect(supers.map((s) => s.name)).toContain("Base")
  // Prepare on Base → its subtype is Derived.
  const prepBase = (await client.sendRequest(TypeHierarchyPrepareRequest.type, {
    textDocument: { uri: OOP_URI },
    position: { line: 0, character: 16 }, // the `Base` in `FUNCTION_BLOCK Base`
  })) as TypeHierarchyItem[]
  const subs = (await client.sendRequest(TypeHierarchySubtypesRequest.type, { item: prepBase[0]! })) as {
    name: string
  }[]
  expect(subs.map((s) => s.name)).toContain("Derived")
  client.dispose()
})
