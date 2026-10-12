/**
 * THE SERVER DECIDES THE VENDOR ONCE (openspec lsp-same-standard design §7, finding R1).
 *
 * The vendors are identical on the Volt layer: their difference is data read from ONE fact, the project's dialect.
 * That fact used to be decided by a silent default — `bin.ts` read "no `--twincat`" as codesys and `runServer` defaulted
 * to codesys — so the Claude Code plugin, which launches `--stdio` with no flag, analysed every TwinCAT workspace as
 * CODESYS: CODESYS-only names resolved and hovered, and every message was CODESYS's. The workspace states its vendor
 * (`.git/volt/config.json`, written by `volt init --vendor`); the server reads it when the client states none, and
 * refuses by name when neither does.
 */
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  DidOpenTextDocumentNotification,
  HoverRequest,
  InitializedNotification,
  InitializeRequest,
  WorkspaceSymbolRequest,
} from "vscode-languageserver-protocol/node"
import { connectToServer } from "../../test/lsp/harness.js"
import type { Vendor } from "../analysis/index.js"

const SRC = `PROGRAM P\nVAR\n\ts : STRING;\nEND_VAR\nIMPLEMENTATION ST\ns := __POUNAME();\nEND_PROGRAM`

/** A workspace folder holding P.pou, bound to `vendor` when one is given (the binding's real shape: `{ bridge: { vendor } }`). */
function workspace(vendor?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "volt-vendor-"))
  writeFileSync(join(dir, "P.pou"), SRC)
  if (vendor !== undefined) {
    mkdirSync(join(dir, ".git", "volt"), { recursive: true })
    writeFileSync(join(dir, ".git", "volt", "config.json"), JSON.stringify({ bridge: { vendor }, project: { platform: vendor, projectName: "P" } }))
  }
  return dir
}

/** Hover on `__POUNAME` (CODESYS-only: TwinCAT reports it "not defined", so hover must answer nothing there). */
async function hoverPouName(flag: Vendor | undefined, dir: string): Promise<unknown> {
  const client = connectToServer(flag)
  try {
    await client.sendRequest(InitializeRequest.type, { processId: null, rootUri: pathToFileURL(dir).href, capabilities: {} })
    await client.sendNotification(InitializedNotification.type, {})
    const uri = pathToFileURL(join(dir, "P.pou")).href
    await client.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: "iecst", version: 1, text: SRC } })
    const line = SRC.split("\n").findIndex((l) => l.includes("__POUNAME"))
    return await client.sendRequest(HoverRequest.type, { textDocument: { uri }, position: { line, character: 6 } })
  } finally {
    client.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
}

test("no flag: a TwinCAT-bound workspace is analysed as TwinCAT (a CODESYS-only built-in hovers nothing)", async () => {
  expect(await hoverPouName(undefined, workspace("twincat"))).toBeNull()
})

test("no flag: a CODESYS-bound workspace is analysed as CODESYS", async () => {
  expect(await hoverPouName(undefined, workspace("codesys"))).not.toBeNull()
})

test("a flag that agrees with the binding is served", async () => {
  expect(await hoverPouName("codesys", workspace("codesys"))).not.toBeNull()
  expect(await hoverPouName("twincat", workspace("twincat"))).toBeNull()
})

test("a flag with no binding is the vendor", async () => {
  expect(await hoverPouName("codesys", workspace())).not.toBeNull()
  expect(await hoverPouName("twincat", workspace())).toBeNull()
})

// Two facts that disagree (a user-scope `volt.iec.vendor` passed to every window, a twincat-bound folder) are refused
// naming both — the flag used to win silently, analysing a TwinCAT workspace with the CODESYS dialect and wording.
test("a flag that contradicts the binding is refused, naming both", async () => {
  for (const [flag, bound] of [["codesys", "twincat"], ["twincat", "codesys"]] as const) {
    const dir = workspace(bound)
    const client = connectToServer(flag)
    try {
      const init = client.sendRequest(InitializeRequest.type, { processId: null, rootUri: pathToFileURL(dir).href, capabilities: {} })
      await expect(init).rejects.toThrow(new RegExp(`vendor conflict: [\\s\\S]*--${flag}[\\s\\S]*bound to ${bound}`))
    } finally {
      client.dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

test("no flag and no binding: the server refuses by name and serves nothing", async () => {
  const dir = workspace()
  const client = connectToServer(undefined)
  try {
    const init = client.sendRequest(InitializeRequest.type, { processId: null, rootUri: pathToFileURL(dir).href, capabilities: {} })
    await expect(init).rejects.toThrow(/no vendor[\s\S]*volt init --vendor <codesys\|twincat>[\s\S]*--codesys\|--twincat/)
  } finally {
    client.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("no flag and no workspace folder: the server refuses by name", async () => {
  const client = connectToServer(undefined)
  try {
    const init = client.sendRequest(InitializeRequest.type, { processId: null, rootUri: null, capabilities: {} })
    await expect(init).rejects.toThrow(/no vendor/)
  } finally {
    client.dispose()
  }
})

test("multi-root: the first BOUND folder decides, past an unbound one", async () => {
  const unbound = workspace()
  const bound = workspace("twincat")
  const client = connectToServer(undefined)
  try {
    await client.sendRequest(InitializeRequest.type, {
      processId: null,
      rootUri: pathToFileURL(unbound).href,
      workspaceFolders: [unbound, bound].map((d) => ({ uri: pathToFileURL(d).href, name: d })),
      capabilities: {},
    })
    const uri = pathToFileURL(join(bound, "P.pou")).href
    await client.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: "iecst", version: 1, text: SRC } })
    const line = SRC.split("\n").findIndex((l) => l.includes("__POUNAME"))
    expect(await client.sendRequest(HoverRequest.type, { textDocument: { uri }, position: { line, character: 6 } })).toBeNull()
  } finally {
    client.dispose()
    rmSync(unbound, { recursive: true, force: true })
    rmSync(bound, { recursive: true, force: true })
  }
})

// The vendor and the crawl come from ONE folder: the vendor used to be the first bound folder's while the crawl was
// `rootUri`'s — an unbound folder analysed with a dialect read from a folder never crawled.
test("multi-root: the folder the vendor is read from is the folder crawled", async () => {
  const unbound = workspace()
  const bound = workspace("twincat")
  writeFileSync(join(bound, "OnlyInBound.pou"), "PROGRAM OnlyInBound\nIMPLEMENTATION ST\n;\nEND_PROGRAM\n")
  writeFileSync(join(unbound, "OnlyInUnbound.pou"), "PROGRAM OnlyInUnbound\nIMPLEMENTATION ST\n;\nEND_PROGRAM\n")
  const client = connectToServer(undefined)
  try {
    await client.sendRequest(InitializeRequest.type, {
      processId: null,
      rootUri: pathToFileURL(unbound).href,
      workspaceFolders: [unbound, bound].map((d) => ({ uri: pathToFileURL(d).href, name: d })),
      capabilities: {},
    })
    await client.sendNotification(InitializedNotification.type, {})
    const names = ((await client.sendRequest(WorkspaceSymbolRequest.type, { query: "OnlyIn" })) ?? []).map((s) => s.name)
    expect(names).toEqual(["OnlyInBound"])
  } finally {
    client.dispose()
    rmSync(unbound, { recursive: true, force: true })
    rmSync(bound, { recursive: true, force: true })
  }
})
