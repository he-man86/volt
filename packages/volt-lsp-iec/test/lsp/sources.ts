/**
 * THE SERVER TESTS' SOURCES AND STEPS — the documents the server's colocated tests (under `src/server/`) open and the
 * client steps they share (open a document, initialize in a directory, a temporary workspace, wait for a document's next
 * push), over the harness (`harness.ts`).
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  DidOpenTextDocumentNotification,
  InitializedNotification,
  InitializeRequest,
  PublishDiagnosticsNotification,
} from "vscode-languageserver-protocol/node"
import { connectToServer } from "./harness.js"

/** A client connection wired to an in-process server over two pipes — `harness.ts` owns the setup, and the typed
 *  `harness()` built on it is what the wire-behaviour tests beside this file use. */
export const connect = () => connectToServer("codesys")

export const SRC = `FUNCTION_BLOCK F
VAR
	count : INT;
END_VAR
count := count + 1;
END_FUNCTION_BLOCK`

export const URI = "file:///F.pou"

export async function openF(client: ReturnType<typeof connect>) {
  await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
  await client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: URI, languageId: "iecst", version: 1, text: SRC },
  })
}

// ─── remaining protocol handlers: drive each once so the routing + response shape is covered ───

export const td = { textDocument: { uri: URI } }

export const atCount = { ...td, position: { line: 4, character: 0 } }

/** initialize + `initialized` (which runs the eager crawl) against a real workspace dir. */
export async function initInDir(client: ReturnType<typeof connect>, root: string) {
  await client.sendRequest(InitializeRequest.type, {
    processId: null,
    rootUri: pathToFileURL(root).href,
    capabilities: { workspace: { didChangeWatchedFiles: { dynamicRegistration: true } } },
  })
  await client.sendNotification(InitializedNotification.type, {})
}

export function tempWorkspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "volt-ws-"))
  for (const [name, content] of Object.entries(files)) {
    const p = join(dir, name)
    mkdirSync(join(p, ".."), { recursive: true })
    writeFileSync(p, content)
  }
  return dir
}

export const PRG = `PROGRAM PLC_PRG\nVAR\n\tmode : E_Mode;\nEND_VAR\n%LANGUAGE ST\nmode := E_Mode.Idle;\nEND_PROGRAM`

export const ENUM = `TYPE E_Mode : (Idle, Run); END_TYPE`

/** The next PublishDiagnostics for `uri`. Register BEFORE the action that triggers the publish. */
export function onceDiag(client: ReturnType<typeof connect>, uri: string): Promise<{ message: string }[]> {
  return new Promise((res) => {
    const d = client.onNotification(PublishDiagnosticsNotification.type, (p) => {
      if (p.uri === uri) {
        d.dispose()
        res(p.diagnostics as { message: string }[])
      }
    })
  })
}

export const notDefined = (diags: { message: string }[], name: string) =>
  diags.some((x) => x.message === `Identifier '${name}' not defined`)
