/**
 * documentDiagnostics — the ONE compute shared by push + pull. Focused on the library-origin gate: a
 * referenced library is precompiled (CODESYS never recompiles it), so its materialized source must not be
 * error-checked. This is the root fix for the class where library GVLs/FBs false-positived (e.g. an array
 * bound `[0..GC_MAX]` on a library global that we can't prove constant).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../syntax/index.js"
import { messagesFor, resolveConfig } from "../analysis/index.js"
import { WorkspaceStore } from "./workspace-store.js"
import { documentDiagnostics } from "./diagnostics.js"

const messages = messagesFor("codesys")
// A library GVL that would otherwise trip array-bound-non-const (bound is a plain global, not provably const).
const LIB_SRC = `VAR_GLOBAL\n  GC_USIMAXNETID : USINT := 9;\n  M_ISTACK : ARRAY [0..gc_usiMaxNetId] OF INT;\nEND_VAR`

function diagnose(uri: string) {
  const store = new WorkspaceStore(resolveConfig({ vendor: "codesys" }))
  store.seedDisk([{ uri, source: LIB_SRC }])
  const d = store.workspace().find((x) => x.uri === uri)!
  return documentDiagnostics(store, messages, d)
}

test("a library-origin document (Library Manager path) is not error-checked at all", () => {
  // Live server URI form: file:// with an encoded space (`Library%20Manager`) — the exact case a raw match missed.
  expect(diagnose("file:///App/Library%20Manager/CANopen/Stack.gvl")).toEqual([])
})

test("the same source in a PROJECT file IS checked (the gate is library-only, not a blanket mute)", () => {
  const diags = diagnose("file:///App/POUs/Stack.gvl")
  expect(diags.some((x) => x.code === "C0161")).toBe(true) // the mapped wire code for array-bound-non-const
})
