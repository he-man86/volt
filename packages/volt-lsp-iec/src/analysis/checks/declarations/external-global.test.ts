/**
 * external-global — C0237 (no matching VAR_GLOBAL). A VAR_EXTERNAL with a matching global stays silent (zero-FP).
 * C0236 (type mismatch) is NOT checked — the live IDE builds it clean (not an error).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../../../test/support/test-uri.js"

const run = (prg: string, gvl?: string) => {
  const inputs = [
    { uri: "PLC_PRG.pou", source: prg, parseResult: parseSource(prg, { networkText: true, unicodeIdentifiers: false }, "codesys") },
    ...(gvl ? [{ uri: "GVL.gvl", source: gvl, parseResult: parseSource(gvl, { networkText: true, unicodeIdentifiers: false }, "codesys") }] : []),
  ]
  const project = build.buildSymbolTable(inputs, [], "codesys")
  return computeDiagnostics({ uri: inputs[0].uri, parseResult: inputs[0].parseResult, source: prg, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code.startsWith("external-"))
}
const codes = (prg: string, gvl?: string) => run(prg, gvl).map((d) => d.code)

// openspec lsp-field-false-positives 8 (class 4), CODESYS 2026-10-29: a VAR_EXTERNAL may name an instance PATH — no
// global's name, so no C0237 (`dp_var_external_dotted`) — read as the member access it spells: a member the type does
// not have is "'nope' is no component of 'FB_T'", at the member (`dp_var_external_dotted_unknown`)
test("a VAR_EXTERNAL instance path is no dangling global; its unknown member is no component", () => {
  const fbT = "FUNCTION_BLOCK FB_T\nVAR\n\ty : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n"
  const all = (decl: string) => {
    const user = `FUNCTION_BLOCK F\nVAR_EXTERNAL\n\t${decl} : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n`
    const prg = "PROGRAM PLC_PRG\nVAR\n\tinst : FB_T;\nEND_VAR\nEND_PROGRAM\n"
    const docs = [["F.pou", user], ["PLC_PRG.pou", prg], ["FB_T.pou", fbT]].map(([uri, source]) => ({ uri: uri!, source: source!, parseResult: parseSource(source!, { networkText: true, unicodeIdentifiers: false }, "codesys") }))
    const project = build.buildSymbolTable(docs, [], "codesys")
    return computeDiagnostics({ ...docs[0]!, project, config: resolveConfig({ vendor: "codesys" }) }).map((d) => [d.code, d.message, user.slice(d.span.start, d.span.end)])
  }
  expect(all("PLC_PRG.inst.y")).toEqual([])
  expect(all("PLC_PRG.inst.nope")).toEqual([["unknown-member", "'nope' is no component of 'FB_T'", "nope"]])
})

test("C0237 — VAR_EXTERNAL with no matching global", () => {
  const ds = run("PROGRAM PLC_PRG\nVAR_EXTERNAL\n g_i : INT;\nEND_VAR\nEND_PROGRAM")
  expect(ds.map((d) => d.code)).toEqual(["external-no-global"])
  expect(ds[0].message).toBe(`No global definition found for VAR_EXTERNAL g_i`)
})

test("a matching global exists (even a different type) — no FP (the IDE does not flag a type mismatch)", () => {
  expect(codes("PROGRAM PLC_PRG\nVAR_EXTERNAL\n g_i : INT;\nEND_VAR\nEND_PROGRAM", "VAR_GLOBAL\n g_i : INT;\nEND_VAR")).toEqual([])
  expect(codes("PROGRAM PLC_PRG\nVAR_EXTERNAL\n g_i : BOOL;\nEND_VAR\nEND_PROGRAM", "VAR_GLOBAL\n g_i : INT;\nEND_VAR")).toEqual([])
})

// frontend-conformance 3.1.3 (rule Y13): a VAR_EXTERNAL binds the global of its name the way a bare name reaches it — a
// `qualified_only` list's variable is reachable only as `GVL.v`, so it is no global for VAR_EXTERNAL either: "No global
// definition found for VAR_EXTERNAL g_veqo", and every use is then undefined (`sym_var_external_qualified_only_global`,
// both vendors 2026-10-02)
test("a VAR_EXTERNAL naming a qualified_only list's variable finds no global, and its uses are undefined", () => {
  const ds = run(
    "PROGRAM PLC_PRG\nVAR_EXTERNAL\n g_q : INT;\nEND_VAR\nVAR\n o : INT;\nEND_VAR\no := g_q;\nEND_PROGRAM",
    "{attribute 'qualified_only'}\nVAR_GLOBAL\n g_q : INT;\nEND_VAR",
  )
  expect(ds.map((d) => d.message)).toEqual(["No global definition found for VAR_EXTERNAL g_q"])
})
