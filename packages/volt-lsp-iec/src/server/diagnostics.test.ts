/**
 * documentDiagnostics — the ONE compute shared by push + pull. Focused on the library-origin gate: a
 * referenced library is precompiled (CODESYS never recompiles it), so its materialized source must not be
 * error-checked. This is the root fix for the class where library GVLs/FBs false-positived (e.g. an array
 * bound `[0..GC_MAX]` on a library global that we can't prove constant).
 */
import { test, expect } from "bun:test"
import { resolveConfig } from "../analysis/index.js"
import { WorkspaceStore } from "./workspace-store.js"
import { documentDiagnostics, libraryManifestDiagnostics } from "./diagnostics.js"
import { MATERIALIZATION } from "../frontend/library/index.js"

// A library GVL that would otherwise trip array-bound-non-const (bound is a plain global, not provably const).
const LIB_SRC = `VAR_GLOBAL\n  GC_USIMAXNETID : USINT := 9;\n  M_ISTACK : ARRAY [0..gc_usiMaxNetId] OF INT;\nEND_VAR`

function diagnose(uri: string) {
  const store = new WorkspaceStore(resolveConfig({ vendor: "codesys" }))
  store.seedDisk([{ uri, source: LIB_SRC }])
  const d = store.workspace().find((x) => x.uri === uri)!
  return documentDiagnostics(store, d)
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

// What a client SEES for a GVL whose global misses its `;` (`pwh_gvl_missing_semicolon`): on CODESYS nothing, since the
// compiler says nothing; on TwinCAT the one message it gives. The parse errors reach a client by this path as well as
// by the semantic pass, so the vendor's rule has to hold on both.
test("a global missing its `;`: silent on CODESYS, reported on TwinCAT, in what the client receives", () => {
  const seen = (vendor: "codesys" | "twincat"): string[] => {
    const store = new WorkspaceStore(resolveConfig({ vendor }))
    store.seedDisk([{ uri: "C:/w/GVL.gvl", source: "VAR_GLOBAL\n\tg_a : INT\n\tg_b : INT;\nEND_VAR\n" }])
    return [...new Set(store.workspace().flatMap((d) => documentDiagnostics(store, d).map((x) => x.message)))]
  }
  expect(seen("codesys")).toEqual([])
  expect(seen("twincat")).toEqual(["';, :=, REF=, ( or [' expected instead of 'g_b'"])
})

// ONE PARSE ERROR, ONE DIAGNOSTIC (analysis-conformance 2.5). The server used to append the parse's raw error stream
// beside the pipeline's `checkParseErrors`, so every top-level parse error reached a client twice: once as C0002 and
// once with no code. The pipeline's finding is the one a client gets; the codeless copy is gone.
const PRG_MAIN = "PROGRAM PLC_PRG\nVAR\n\tfb : FB_Live;\nEND_VAR\nIMPLEMENTATION ST\nfb();\nEND_PROGRAM\n"
const LIVE_FB = "FUNCTION_BLOCK FB_Live\nVAR\n\tb : BOOL;\n\ti : INT;\nEND_VAR\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n"
/** `[code, line]` of every diagnostic on `uri`, with the dead-code suppression on (the default) or off (`diagnoseDeadCode`,
 *  the control: what the same file gives when nothing is suppressed). */
function diagnoseIn(files: Record<string, string>, uri: string, diagnoseDeadCode = false): [unknown, number][] {
  const store = new WorkspaceStore(resolveConfig({ vendor: "codesys", diagnoseDeadCode }))
  store.seedDisk(Object.entries(files).map(([u, source]) => ({ uri: u, source })))
  return documentDiagnostics(store, store.workspace().find((x) => x.uri === uri)!).map((d): [unknown, number] => [d.code, d.range.start.line])
    .sort((a, b) => a[1] - b[1])
}

test("one top-level parse error is one diagnostic, with its code", () => {
  const files = { "C:/w/H.pou": "FUNCTION_BLOCK H\nVAR\n\tx : ;\nEND_VAR\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n" }
  expect(diagnoseIn(files, "C:/w/H.pou")).toEqual([["C0002", 2]])
})

// DEAD CODE, RECORDED (analysis-conformance 2.5, 2026-10-06): an FB nothing reaches builds CLEAN on both vendors even
// with a parse error in it — `dead_fb_missing_then` (a statement), `dead_fb_declaration_parse_error` (a declaration) —
// so a dead POU shows nothing, parse errors included. A method nothing calls inside a LIVE FB is not skipped that way:
// its parse errors are reported on both vendors (`dead_method_missing_then`, `sig_empty_type`), so they stay.
test("a dead POU shows nothing, not even its parse errors (the build never reads it)", () => {
  const files = {
    "C:/w/PLC_PRG.pou": PRG_MAIN,
    "C:/w/FB_Live.pou": LIVE_FB,
    // an FB no PROGRAM reaches: a declaration parse error (line 4), a conversion error (line 7), and a statement parse
    // error in its method (line 11)
    "C:/w/FB_Dead.pou":
      "FUNCTION_BLOCK FB_Dead\nVAR\n\tb : BOOL;\n\ti : INT;\n\tx : ;\nEND_VAR\nIMPLEMENTATION ST\ni := b;\nEND_FUNCTION_BLOCK\n" +
      "METHOD M\nIMPLEMENTATION ST\nIF TRUE i := 1; END_IF\nEND_METHOD\n",
  }
  expect(diagnoseIn(files, "C:/w/FB_Dead.pou", true)).toEqual([["C0002", 4], ["C0032", 7], ["C0002", 11]])
  expect(diagnoseIn(files, "C:/w/FB_Dead.pou")).toEqual([])
})

test("a parse error in a dead member is still shown (recorded), the member's semantic findings are not", () => {
  const files = {
    "C:/w/PLC_PRG.pou": PRG_MAIN,
    // two methods nothing calls: a declaration parse error (line 10) and a conversion error (line 13); a statement parse
    // error (line 17)
    "C:/w/FB_Live.pou":
      LIVE_FB +
      "METHOD Unused\nVAR\n\tx : ;\nEND_VAR\nIMPLEMENTATION ST\ni := b;\nEND_METHOD\n" +
      "METHOD Unused2\nIMPLEMENTATION ST\nIF TRUE i := 1; END_IF\nEND_METHOD\n",
  }
  expect(diagnoseIn(files, "C:/w/FB_Live.pou", true)).toEqual([["C0002", 10], ["C0032", 13], ["C0002", 17]])
  expect(diagnoseIn(files, "C:/w/FB_Live.pou")).toEqual([["C0002", 10], ["C0002", 17]])
})
