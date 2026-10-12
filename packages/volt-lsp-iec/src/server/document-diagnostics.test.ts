/**
 * `document-diagnostics.ts` — what a client receives: the store's inputs read for one document, its findings converted
 * to the wire (the compiler `Cnnnn` where one is mapped, no code on the missing-language finding), and the manifest
 * warnings named by file URI. The composition itself (dead code, unstated bodies) is `analysis/pipeline/document.test.ts`'s
 * (moved there with it, openspec lsp-server-scheduling 2.4). The library-origin gate is pinned here end to end: a
 * referenced library is precompiled (CODESYS never recompiles it), so its materialized source must not be error-checked
 * — the root fix for the class where library GVLs/FBs false-positived (an array bound `[0..GC_MAX]` on a library global
 * that we can't prove constant).
 */
import { test, expect } from "bun:test"
import { pathToFileURL } from "node:url"
import { resolveConfig, type Vendor } from "../analysis/index.js"
import { WorkspaceStore } from "../workspace/workspace-store.js"
import { failLoud } from "../../test/support/fail-loud.js"
import { NETWORK_TEXT_ENABLED } from "./config.js"
import { documentDiagnostics, libraryManifestDiagnostics } from "./document-diagnostics.js"
import { MATERIALIZATION } from "../frontend/library/index.js"

/** What a client receives for `uri` in a workspace of `files`. */
function diagnoseIn(files: Record<string, string>, uri: string, vendor: Vendor = "codesys") {
  const store = new WorkspaceStore(resolveConfig({ vendor }), { networkText: NETWORK_TEXT_ENABLED }, failLoud)
  store.seedDisk(Object.entries(files).map(([u, source]) => ({ uri: u, source })))
  return documentDiagnostics(store, store.workspace().find((x) => x.uri === uri)!)
}

// A library GVL that would otherwise trip array-bound-non-const (bound is a plain global, not provably const).
const LIB_SRC = `VAR_GLOBAL\n  GC_USIMAXNETID : USINT := 9;\n  M_ISTACK : ARRAY [0..gc_usiMaxNetId] OF INT;\nEND_VAR`
const diagnose = (uri: string) => diagnoseIn({ [uri]: LIB_SRC }, uri)

test("a library-origin document (Library Manager path) is not error-checked at all", () => {
  // Live server URI form: file:// with an encoded space (`Library%20Manager`) — the exact case a raw match missed.
  expect(diagnose("file:///App/Library%20Manager/CANopen/Stack.gvl")).toEqual([])
})

test("the same source in a PROJECT file IS checked (the gate is library-only, not a blanket mute)", () => {
  const diags = diagnose("file:///App/POUs/Stack.gvl")
  expect(diags.some((x) => x.code === "C0161")).toBe(true) // the mapped wire code for array-bound-non-const
})

// What a client SEES for a GVL whose global misses its `;` (`pwh_gvl_missing_semicolon`): on CODESYS nothing, since the
// compiler says nothing; on TwinCAT the one message it gives.
test("a global missing its `;`: silent on CODESYS, reported on TwinCAT, in what the client receives", () => {
  const seen = (vendor: Vendor): string[] =>
    diagnoseIn({ "C:/w/GVL.gvl": "VAR_GLOBAL\n\tg_a : INT\n\tg_b : INT;\nEND_VAR\n" }, "C:/w/GVL.gvl", vendor).map((x) => x.message)
  expect(seen("codesys")).toEqual([])
  expect(seen("twincat")).toEqual(["';, :=, REF=, ( or [' expected instead of 'g_b'"])
})

// ONE PARSE ERROR, ONE DIAGNOSTIC (analysis-conformance 2.5): once, with its code — the codeless copy the server's own
// raw parse-error stream added is gone.
test("one top-level parse error is one diagnostic, with its code", () => {
  const files = { "C:/w/H.pou": "FUNCTION_BLOCK H\nVAR\n\tx : ;\nEND_VAR\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n" }
  expect(diagnoseIn(files, "C:/w/H.pou").map((d) => [d.code, d.range.start.line])).toEqual([["C0002", 2]])
})

test("the missing-language finding carries no code on the wire", () => {
  const uri = "C:/w/FB.pou"
  const [d, ...rest] = diagnoseIn({ [uri]: "FUNCTION_BLOCK FB\nVAR\n\ti : INT;\nEND_VAR\ni := 1;\nEND_FUNCTION_BLOCK\n" }, uri)
  expect(rest).toEqual([])
  expect(d!.message).toContain("states no language")
  expect("code" in d!).toBe(false)
  expect(d!.range.start).toEqual({ line: 4, character: 0 })
})

test("a manifest's warning is named by the manifest's file URI, at its top", () => {
  const path = "/w/Library Manager/Standard/Standard.library"
  const byUri = libraryManifestDiagnostics([
    { uri: path, folder: "Library Manager/Standard", dir: "/w/Library Manager/Standard/", namespace: "Standard", library: "Standard", dependencies: [], materialization: MATERIALIZATION - 1 },
  ])
  expect([...byUri.keys()]).toEqual([pathToFileURL(path).href])
  const [warning] = [...byUri.values()].flat()
  expect({ code: warning?.code, range: warning?.range, codeDescription: warning?.codeDescription }).toEqual({
    code: "library-stale",
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    codeDescription: undefined,
  })
})

// A FIX IS DATA ON THE FINDING (openspec lsp-quick-fixes design.md §2): it rides to the client in `Diagnostic.data`,
// which the client hands back unchanged with a code-action request — so the renderer re-derives nothing. A finding with
// no fix carries no `data` at all.
test("a finding's fixes travel in Diagnostic.data; a finding without one has no data", () => {
  const uri = "C:/w/FB.pou"
  const src = "FUNCTION_BLOCK FB\nVAR\n\twide : LREAL;\n\tnarrow : REAL;\nEND_VAR\nIMPLEMENTATION ST\nnarrow := wide;\nEND_FUNCTION_BLOCK\n"
  const [d, ...rest] = diagnoseIn({ [uri]: src }, uri)
  expect(rest).toEqual([])
  expect(d!.code).toBe("C0197")
  const at = src.indexOf("wide;")
  expect(d!.data).toEqual({
    fixes: [
      {
        title: "Wrap in TO_REAL(…)",
        preferred: true,
        edits: [{ span: { start: at, end: at + 4, startLine: 7, startCol: 10, endLine: 7, endCol: 14 }, replaces: "wide", newText: "TO_REAL(wide)" }],
      },
    ],
  })
  const [plain] = diagnoseIn({ [uri]: src.replace("narrow := wide;", "narrow := undeclared;") }, uri)
  expect(plain!.code).toBe("C0046")
  expect("data" in plain!).toBe(false)
})
