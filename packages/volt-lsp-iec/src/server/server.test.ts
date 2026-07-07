import { test, expect } from "bun:test"
import { PassThrough } from "node:stream"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  CallHierarchyIncomingCallsRequest,
  CallHierarchyOutgoingCallsRequest,
  CallHierarchyPrepareRequest,
  CodeActionRequest,
  CodeLensRequest,
  CompletionRequest,
  createProtocolConnection,
  DefinitionRequest,
  DidChangeConfigurationNotification,
  DidChangeTextDocumentNotification,
  DidChangeWatchedFilesNotification,
  DocumentDiagnosticRequest,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DidSaveTextDocumentNotification,
  DocumentFormattingRequest,
  DocumentHighlightRequest,
  DocumentSymbolRequest,
  FileChangeType,
  FoldingRangeRequest,
  HoverRequest,
  ImplementationRequest,
  InitializedNotification,
  InitializeRequest,
  InlayHintRequest,
  PrepareRenameRequest,
  PublishDiagnosticsNotification,
  ReferencesRequest,
  RegistrationRequest,
  RenameRequest,
  SelectionRangeRequest,
  SemanticTokensDeltaRequest,
  SemanticTokensRangeRequest,
  SemanticTokensRequest,
  SignatureHelpRequest,
  StreamMessageReader,
  StreamMessageWriter,
  TypeDefinitionRequest,
  TypeHierarchyPrepareRequest,
  TypeHierarchySubtypesRequest,
  TypeHierarchySupertypesRequest,
  WorkspaceDiagnosticRequest,
  WorkspaceSymbolRequest,
  type CallHierarchyItem,
  type TypeHierarchyItem,
} from "vscode-languageserver-protocol/node.js"
import { runServer } from "./server.js"

/** A client connection wired to an in-process server over two pipes. */
function connect(vendor: "codesys" | "twincat" = "codesys") {
  const c2s = new PassThrough()
  const s2c = new PassThrough()
  runServer(c2s, s2c, vendor) // server reads c2s, writes s2c
  const client = createProtocolConnection(new StreamMessageReader(s2c), new StreamMessageWriter(c2s))
  client.onRequest(RegistrationRequest.type, () => null) // ack the file-watcher dynamic registration
  client.listen()
  return client
}

const SRC = `FUNCTION_BLOCK F
VAR
	count : INT;
END_VAR
count := count + 1;
END_FUNCTION_BLOCK`
const URI = "file:///F.fb"

async function openF(client: ReturnType<typeof connect>) {
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: URI, languageId: "iecst", version: 1, text: SRC },
  })
}

test("server: initialize advertises the LSP capabilities", async () => {
  const client = connect()
  const init = await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  expect(init.capabilities.hoverProvider).toBe(true)
  expect(init.capabilities.definitionProvider).toBe(true)
  expect(init.capabilities.completionProvider?.triggerCharacters).toContain(".")
  expect(init.capabilities.semanticTokensProvider).toBeDefined()
  client.dispose()
})

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

test("server: documentSymbol returns the outline", async () => {
  const client = connect()
  await openF(client)
  const syms = await client.sendRequest(DocumentSymbolRequest.type, { textDocument: { uri: URI } })
  expect((syms as { name: string }[])[0]?.name).toBe("F")
  client.dispose()
})

test("server: didOpen pushes diagnostics (type mismatch)", async () => {
  const client = connect()
  const got = new Promise<{ diagnostics: { code?: unknown }[] }>((resolve) => {
    client.onNotification(PublishDiagnosticsNotification.type, (p) => resolve(p as never))
  })
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  const bad = `FUNCTION_BLOCK F\nVAR\n b : BOOL; i : INT;\nEND_VAR\ni := b;\nEND_FUNCTION_BLOCK`
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: URI, languageId: "iecst", version: 1, text: bad },
  })
  const params = await got
  expect(params.diagnostics.some((d) => d.code === "assignment-type-mismatch")).toBe(true)
  client.dispose()
})

test("server: didOpen pushes VG diagnostics for a graphical body", async () => {
  const client = connect()
  const got = new Promise<{ diagnostics: { code?: unknown }[] }>((resolve) => {
    client.onNotification(PublishDiagnosticsNotification.type, (p) => resolve(p as never))
  })
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  const vg = `FUNCTION_BLOCK F\nVAR out : BOOL;\nEND_VAR\nNETWORK 0 LD\nout := TRUE;\nEND_FUNCTION_BLOCK` // no END_NETWORK
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: URI, languageId: "iecst", version: 1, text: vg },
  })
  const params = await got
  expect(params.diagnostics.some((d) => d.code === "VG_NETWORK_NOT_CLOSED")).toBe(true)
  client.dispose()
})

test("server: a dead FB's diagnostics are suppressed by default, emitted with diagnoseDeadCode", async () => {
  // FB_Dead is never called/instantiated by the PROGRAM → structurally dead. Its genuine type error must
  // NOT surface by default (matches the compiler, which never compiles it).
  const mainSrc = `PROGRAM Main\nx := 1;\nEND_PROGRAM`
  const deadSrc = `FUNCTION_BLOCK FB_Dead\nVAR b : BOOL; i : INT;\nEND_VAR\ni := b;\nEND_FUNCTION_BLOCK`
  const deadUri = "file:///FB_Dead.fb"

  async function diagsFor(diagnoseDeadCode: boolean): Promise<{ code?: unknown }[]> {
    const client = connect()
    const got = new Promise<{ diagnostics: { code?: unknown }[] }>((resolve) => {
      client.onNotification(PublishDiagnosticsNotification.type, (p) => {
        if ((p as { uri: string }).uri === deadUri) resolve(p as never)
      })
    })
    await client.sendRequest(InitializeRequest.type, {
      processId: null,
      rootUri: null,
      capabilities: {},
      initializationOptions: { diagnoseDeadCode },
    })
    await client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: "file:///Main.prg", languageId: "iecst", version: 1, text: mainSrc },
    })
    await client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: deadUri, languageId: "iecst", version: 1, text: deadSrc },
    })
    const params = await got
    client.dispose()
    return params.diagnostics
  }

  const suppressed = await diagsFor(false)
  expect(suppressed.some((d) => d.code === "assignment-type-mismatch")).toBe(false)

  const emitted = await diagsFor(true)
  expect(emitted.some((d) => d.code === "assignment-type-mismatch")).toBe(true)
})

test("server: hover inside a VG body resolves a wire's inferred type", async () => {
  const client = connect()
  const vg = `FUNCTION_BLOCK F\nVAR a : BOOL; b : BOOL; out : BOOL;\nEND_VAR\nNETWORK 0 LD\nLET g := (a AND b);\nout := g;\nEND_NETWORK\nEND_FUNCTION_BLOCK`
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: URI, languageId: "iecst", version: 1, text: vg },
  })
  const h = await client.sendRequest(HoverRequest.type, {
    textDocument: { uri: URI },
    position: { line: 5, character: 7 }, // the `g` use in `out := g;`
  })
  expect((h as { contents: { value: string } })?.contents.value).toContain("g : BOOL")
  client.dispose()
})

// ─── remaining protocol handlers: drive each once so the routing + response shape is covered ───

const td = { textDocument: { uri: URI } }
const atCount = { ...td, position: { line: 4, character: 0 } } // the `count :=` usage

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

test("server: structural requests (selectionRange, foldingRange, semanticTokens, codeLens) respond", async () => {
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
  const lenses = (await client.sendRequest(CodeLensRequest.type, td)) as unknown[]
  expect(Array.isArray(lenses)).toBe(true)
  client.dispose()
})

test("server: assist requests (signatureHelp, typeDefinition, implementation, inlayHint, codeAction, formatting) respond without error", async () => {
  const client = connect()
  await openF(client)
  // These may legitimately return null/empty for this source — the point is the handler runs + routes.
  await client.sendRequest(SignatureHelpRequest.type, atCount)
  await client.sendRequest(TypeDefinitionRequest.type, atCount)
  await client.sendRequest(ImplementationRequest.type, atCount)
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
  const edits = (await client.sendRequest(DocumentFormattingRequest.type, {
    ...td,
    options: { tabSize: 2, insertSpaces: true },
  })) as unknown[]
  expect(Array.isArray(edits)).toBe(true)
  client.dispose()
})

test("server: didChange re-parses; didClose clears diagnostics", async () => {
  const client = connect()
  await openF(client)
  // change the body so `count` becomes `total` — a hover on the old name no longer resolves
  await client.sendNotification(DidChangeTextDocumentNotification.type, {
    textDocument: { uri: URI, version: 2 },
    contentChanges: [{ text: SRC.replace(/count/g, "total") }],
  })
  const h = await client.sendRequest(HoverRequest.type, { ...td, position: { line: 4, character: 0 } })
  expect((h as { contents: { value: string } })?.contents.value).toContain("total")
  // close → server publishes empty diagnostics for the uri
  const cleared = new Promise<{ diagnostics: unknown[] }>((res) =>
    client.onNotification(PublishDiagnosticsNotification.type, (p) => p.uri === URI && res(p)),
  )
  await client.sendNotification(DidCloseTextDocumentNotification.type, { textDocument: { uri: URI } })
  expect((await cleared).diagnostics).toEqual([])
  client.dispose()
})

// ─── eager workspace index: cross-file resolution from disk + freshness on file events ──────────

/** The next PublishDiagnostics for `uri`. Register BEFORE the action that triggers the publish. */
function onceDiag(client: ReturnType<typeof connect>, uri: string): Promise<{ message: string }[]> {
  return new Promise((res) => {
    const d = client.onNotification(PublishDiagnosticsNotification.type, (p) => {
      if (p.uri === uri) {
        d.dispose()
        res(p.diagnostics as { message: string }[])
      }
    })
  })
}
const notDefined = (diags: { message: string }[], name: string) =>
  diags.some((x) => x.message === `Identifier '${name}' not defined`)

/** initialize + `initialized` (which runs the eager crawl) against a real workspace dir. */
async function initInDir(client: ReturnType<typeof connect>, root: string) {
  await client.sendRequest(InitializeRequest.type, {
    processId: null,
    rootUri: pathToFileURL(root).href,
    capabilities: { workspace: { didChangeWatchedFiles: { dynamicRegistration: true } } },
  })
  await client.sendNotification(InitializedNotification.type, {})
}

function tempWorkspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "volt-ws-"))
  for (const [name, content] of Object.entries(files)) {
    const p = join(dir, name)
    mkdirSync(join(p, ".."), { recursive: true })
    writeFileSync(p, content)
  }
  return dir
}

const PRG = `PROGRAM PLC_PRG\nVAR\n\tmode : E_Mode;\nEND_VAR\nmode := E_Mode.Idle;\nEND_PROGRAM`
const ENUM = `TYPE E_Mode : (Idle, Run); END_TYPE`

test("server: a type in an unopened sibling file resolves (eager disk index)", async () => {
  const dir = tempWorkspace({ "PLC_PRG.prg": PRG, "E_Mode.enum": ENUM })
  const client = connect()
  await initInDir(client, dir)
  const prgUri = pathToFileURL(join(dir, "PLC_PRG.prg")).href
  const diags = onceDiag(client, prgUri)
  // Open ONLY the referencing file; E_Mode lives in an unopened sibling on disk.
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: prgUri, languageId: "iecst", version: 1, text: PRG },
  })
  expect(notDefined(await diags, "E_Mode")).toBe(false)
  client.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test("server: an open buffer overrides the on-disk version", async () => {
  // Disk declares E_Mode; the open buffer renames it away → the reference no longer resolves.
  const dir = tempWorkspace({ "E_Mode.enum": ENUM })
  const client = connect()
  await initInDir(client, dir)
  const uri = pathToFileURL(join(dir, "E_Mode.enum")).href
  const diags = onceDiag(client, uri)
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri, languageId: "iecst", version: 1, text: `TYPE E_Other : (Idle, Run); END_TYPE` },
  })
  await diags // just ensure the buffer is analyzed, not disk
  // Now a referencing file should NOT see E_Mode (the buffer shadows the disk decl).
  const prgUri = pathToFileURL(join(dir, "PLC_PRG.prg")).href
  const prgDiags = onceDiag(client, prgUri)
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: prgUri, languageId: "iecst", version: 1, text: PRG },
  })
  expect(notDefined(await prgDiags, "E_Mode")).toBe(true)
  client.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test("server: a newly added file re-indexes on didChangeWatchedFiles (create)", async () => {
  const dir = tempWorkspace({ "PLC_PRG.prg": PRG }) // no E_Mode yet
  const client = connect()
  await initInDir(client, dir)
  const prgUri = pathToFileURL(join(dir, "PLC_PRG.prg")).href
  const before = onceDiag(client, prgUri)
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: prgUri, languageId: "iecst", version: 1, text: PRG },
  })
  expect(notDefined(await before, "E_Mode")).toBe(true) // unresolved until the enum lands

  const enumPath = join(dir, "E_Mode.enum")
  writeFileSync(enumPath, ENUM)
  const after = onceDiag(client, prgUri) // reindex re-publishes for open docs
  await client.sendNotification(DidChangeWatchedFilesNotification.type, {
    changes: [{ uri: pathToFileURL(enumPath).href, type: FileChangeType.Created }],
  })
  expect(notDefined(await after, "E_Mode")).toBe(false)
  client.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test("server: a deleted file re-indexes on didChangeWatchedFiles (delete)", async () => {
  const dir = tempWorkspace({ "PLC_PRG.prg": PRG, "E_Mode.enum": ENUM })
  const client = connect()
  await initInDir(client, dir)
  const prgUri = pathToFileURL(join(dir, "PLC_PRG.prg")).href
  const before = onceDiag(client, prgUri)
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: prgUri, languageId: "iecst", version: 1, text: PRG },
  })
  expect(notDefined(await before, "E_Mode")).toBe(false)

  const enumPath = join(dir, "E_Mode.enum")
  rmSync(enumPath)
  const after = onceDiag(client, prgUri)
  await client.sendNotification(DidChangeWatchedFilesNotification.type, {
    changes: [{ uri: pathToFileURL(enumPath).href, type: FileChangeType.Deleted }],
  })
  expect(notDefined(await after, "E_Mode")).toBe(true)
  client.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test("server: a closed declaring file stays indexed from disk", async () => {
  const dir = tempWorkspace({ "PLC_PRG.prg": PRG, "E_Mode.enum": ENUM })
  const client = connect()
  await initInDir(client, dir)
  const prgUri = pathToFileURL(join(dir, "PLC_PRG.prg")).href
  const enumUri = pathToFileURL(join(dir, "E_Mode.enum")).href
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: prgUri, languageId: "iecst", version: 1, text: PRG },
  })
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: enumUri, languageId: "iecst", version: 1, text: ENUM },
  })
  // Close the declaring file — its disk copy must keep E_Mode resolvable in PLC_PRG.
  await client.sendNotification(DidCloseTextDocumentNotification.type, { textDocument: { uri: enumUri } })
  const diags = onceDiag(client, prgUri)
  await client.sendNotification(DidChangeTextDocumentNotification.type, {
    textDocument: { uri: prgUri, version: 2 },
    contentChanges: [{ text: PRG }], // touch to force a re-publish
  })
  expect(notDefined(await diags, "E_Mode")).toBe(false)
  client.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test("server: a file open AND on disk contributes its symbols once (definition is single)", async () => {
  const dir = tempWorkspace({ "PLC_PRG.prg": PRG, "E_Mode.enum": ENUM })
  const client = connect()
  await initInDir(client, dir)
  const prgUri = pathToFileURL(join(dir, "PLC_PRG.prg")).href
  const enumUri = pathToFileURL(join(dir, "E_Mode.enum")).href
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: prgUri, languageId: "iecst", version: 1, text: PRG },
  })
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: enumUri, languageId: "iecst", version: 1, text: ENUM },
  })
  const def = await client.sendRequest(DefinitionRequest.type, {
    textDocument: { uri: prgUri },
    position: { line: 2, character: 9 }, // the `E_Mode` type ref in `mode : E_Mode;`
  })
  // One declaration, not two — the merge keyed the open buffer and its disk file to one entry.
  const locations = Array.isArray(def) ? def : def ? [def] : []
  expect(locations.length).toBe(1)
  client.dispose()
  rmSync(dir, { recursive: true, force: true })
})

// ─── workspace navigation: call/type hierarchy + workspace symbol ───────────────────────────────

const CALLS = `FUNCTION Helper : INT
Helper := 1;
END_FUNCTION
FUNCTION Caller : INT
Caller := Helper();
END_FUNCTION`
const CALLS_URI = "file:///Calls.fun"

async function openCalls(client: ReturnType<typeof connect>) {
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: CALLS_URI, languageId: "iecst", version: 1, text: CALLS },
  })
}

test("server: initialize advertises hierarchy + workspaceSymbol providers", async () => {
  const client = connect()
  const init = await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  expect(init.capabilities.callHierarchyProvider).toBe(true)
  expect(init.capabilities.typeHierarchyProvider).toBe(true)
  expect(init.capabilities.workspaceSymbolProvider).toBe(true)
  client.dispose()
})

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
const OOP_URI = "file:///Oop.fb"

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

test("server: textDocument/diagnostic pulls the same diagnostics as the push channel", async () => {
  const client = connect()
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  const bad = `FUNCTION_BLOCK F\nVAR\n b : BOOL; i : INT;\nEND_VAR\ni := b;\nEND_FUNCTION_BLOCK`
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: URI, languageId: "iecst", version: 1, text: bad },
  })
  const report = (await client.sendRequest(DocumentDiagnosticRequest.type, { textDocument: { uri: URI } })) as {
    kind: string
    items: { code?: unknown }[]
  }
  expect(report.kind).toBe("full")
  expect(report.items.some((d) => d.code === "assignment-type-mismatch")).toBe(true)
  client.dispose()
})

test("server: didSave re-publishes diagnostics for the saved document", async () => {
  const client = connect()
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  const bad = `FUNCTION_BLOCK F\nVAR\n b : BOOL; i : INT;\nEND_VAR\ni := b;\nEND_FUNCTION_BLOCK`
  const first = onceDiag(client, URI)
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: URI, languageId: "iecst", version: 1, text: bad },
  })
  await first
  const onSave = onceDiag(client, URI)
  await client.sendNotification(DidSaveTextDocumentNotification.type, { textDocument: { uri: URI } })
  const diags = (await onSave) as { code?: unknown }[]
  expect(diags.some((d) => d.code === "assignment-type-mismatch")).toBe(true)
  client.dispose()
})

test("server: didChangeConfiguration live-toggles diagnoseDeadCode (no restart)", async () => {
  const client = connect()
  const mainSrc = `PROGRAM Main\nx := 1;\nEND_PROGRAM`
  const deadSrc = `FUNCTION_BLOCK FB_Dead\nVAR b : BOOL; i : INT;\nEND_VAR\ni := b;\nEND_FUNCTION_BLOCK`
  const deadUri = "file:///FB_Dead.fb"
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  const initial = onceDiag(client, deadUri)
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: "file:///Main.prg", languageId: "iecst", version: 1, text: mainSrc },
  })
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: deadUri, languageId: "iecst", version: 1, text: deadSrc },
  })
  expect(((await initial) as { code?: unknown }[]).some((d) => d.code === "assignment-type-mismatch")).toBe(false) // suppressed
  const afterCfg = onceDiag(client, deadUri)
  await client.sendNotification(DidChangeConfigurationNotification.type, { settings: { diagnoseDeadCode: true } })
  expect(((await afterCfg) as { code?: unknown }[]).some((d) => d.code === "assignment-type-mismatch")).toBe(true) // now emitted
  client.dispose()
})

test("server: workspace/diagnostic reports errors in unopened files (eager index)", async () => {
  const badFb = `FUNCTION_BLOCK F\nVAR\n b : BOOL; i : INT;\nEND_VAR\ni := b;\nEND_FUNCTION_BLOCK`
  const dir = tempWorkspace({ "F.fb": badFb })
  const client = connect()
  await initInDir(client, dir) // crawls F.fb without opening it
  const report = (await client.sendRequest(WorkspaceDiagnosticRequest.type, { previousResultIds: [] })) as {
    items: { uri: string; items: { code?: unknown }[] }[]
  }
  const fUri = pathToFileURL(join(dir, "F.fb")).href
  const fReport = report.items.find((r) => r.uri === fUri)
  expect(fReport?.items.some((d) => d.code === "assignment-type-mismatch")).toBe(true)
  client.dispose()
  rmSync(dir, { recursive: true, force: true })
})

test("server: workspaceSymbol finds a DUT in an unopened file and narrows by query", async () => {
  const dir = tempWorkspace({ "E_Mode.enum": ENUM, "PLC_PRG.prg": PRG })
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
