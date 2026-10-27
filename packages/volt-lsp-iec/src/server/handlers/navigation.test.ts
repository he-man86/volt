/**
 * The NAVIGATION handlers (`handlers/navigation.ts`) over the harness: definition, type definition and implementation,
 * references and highlights, rename (and its refusal by name), the call and type hierarchies.
 */
import { describe, expect, test } from "bun:test"
import {
  CallHierarchyPrepareRequest,
  DefinitionRequest,
  DidOpenTextDocumentNotification,
  DocumentHighlightRequest,
  ImplementationRequest,
  InitializeRequest,
  PrepareRenameRequest,
  ReferencesRequest,
  TypeDefinitionRequest,
  TypeHierarchyPrepareRequest,
  CallHierarchyIncomingCallsRequest,
  CallHierarchyOutgoingCallsRequest,
  RenameRequest,
  TypeHierarchySubtypesRequest,
  TypeHierarchySupertypesRequest,
  type CallHierarchyItem,
  type TypeHierarchyItem,
} from "vscode-languageserver-protocol/node"
import { connect, SRC, URI, openF, atCount } from "../../../test/lsp/sources.js"
import { connectToServer } from "../../../test/lsp/harness.js"

test("server: definition resolves a body usage to its declaration", async () => {
  const client = connect()
  await openF(client)
  const def = await client.sendRequest(DefinitionRequest.type, {
    textDocument: { uri: URI },
    position: { line: 4, character: 0 }, // the `count` usage
  })
  expect((def as { range: { start: { line: number } } })?.range.start.line).toBe(2) // the declaration line
  client.dispose()
})

test("server: typeDefinition and implementation respond without error", async () => {
  const client = connect()
  await openF(client)
  // These may legitimately return null/empty for this source — the point is the handler runs + routes.
  await client.sendRequest(TypeDefinitionRequest.type, atCount)
  await client.sendRequest(ImplementationRequest.type, atCount)
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

describe("a refused rename (lsp-same-standard finding R6)", () => {
  /** A rename to a name the dialect refuses is refused by name over the wire (lsp-same-standard 3.1, finding R6). */
  const URI = "file:///F.pou"

  const SRC = `FUNCTION_BLOCK F\nVAR\n\tcount : INT;\nEND_VAR\n%LANGUAGE ST\ncount := count + 1;\nEND_FUNCTION_BLOCK`

  async function renameTo(newName: string): Promise<unknown> {
    const client = connectToServer("codesys")
    try {
      await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
      await client.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri: URI, languageId: "iecst", version: 1, text: SRC },
      })
      return await client.sendRequest(RenameRequest.type, {
        textDocument: { uri: URI },
        position: { line: 5, character: 1 },
        newName,
      })
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
})
