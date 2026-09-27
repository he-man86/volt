/**
 * documentDiagnostics — the ONE compute shared by push + pull. Focused on the library-origin gate: a
 * referenced library is precompiled (CODESYS never recompiles it), so its materialized source must not be
 * error-checked. This is the root fix for the class where library GVLs/FBs false-positived (e.g. an array
 * bound `[0..GC_MAX]` on a library global that we can't prove constant).
 */
import { test, expect } from "bun:test"
import { messagesFor, resolveConfig } from "../analysis/index.js"
import { WorkspaceStore } from "./workspace-store.js"
import { documentDiagnostics, libraryManifestDiagnostics } from "./diagnostics.js"
import { MATERIALIZATION } from "../symbols/index.js"

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

// Every format below this server's own must say what it lacks: the stale-manifest warning is built from that list,
// and a format with no entry printed "…(format 3, now 4): . Run `volt pull`…" — an empty clause, no failure.
test("libraryManifestDiagnostics: every older format names what the workspace lacks", () => {
  for (let format = 1; format < MATERIALIZATION; format++) {
    const uri = `/w/Library Manager/Standard/Standard.library`
    const byUri = libraryManifestDiagnostics([
      {
        uri,
        folder: "Library Manager/Standard",
        namespace: "Standard",
        library: "Standard",
        dependencies: [],
        materialization: format,
      },
    ])
    const [warning] = [...byUri.values()].flat()
    expect(warning?.code).toBe("library-stale")
    expect(warning!.message).not.toContain("): .")
    const clause = warning!.message.split(`(format ${format}, now ${MATERIALIZATION}): `)[1] ?? ""
    expect(clause.startsWith(".")).toBe(false)
    expect(clause.length).toBeGreaterThan(0)
  }
})

// The re-pull repair assumes the CLI on PATH is at least this server's format. volt-vscode is published on its own and
// bundles its own LSP, so the extension can be AHEAD of the installed CLI — and then `volt pull` writes the same old
// format back and the warning (with every graphical body unchecked) never clears. The warning must name that case:
// the CLI is the stale side, and the repair is updating it before the pull.
test("libraryManifestDiagnostics: an older manifest names an older CLI as a possible stale side", () => {
  const uri = `/w/Library Manager/Standard/Standard.library`
  const byUri = libraryManifestDiagnostics([
    {
      uri,
      folder: "Library Manager/Standard",
      namespace: "Standard",
      library: "Standard",
      dependencies: [],
      materialization: MATERIALIZATION - 1,
    },
  ])
  const [warning] = [...byUri.values()].flat()
  expect(warning?.code).toBe("library-stale")
  expect(warning!.message).toContain("volt pull")
  expect(warning!.message).toContain(`format ${MATERIALIZATION}`)
  expect(warning!.message).toMatch(/update the volt CLI/i)
})
