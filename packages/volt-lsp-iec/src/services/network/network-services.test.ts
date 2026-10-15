/**
 * The services over a network-text body (`network-services.ts`): hover, definition, completion and resolution at an
 * offset, the hidden body's line hover, and the references and rename that span ST and network text.
 */
import { test, expect } from "bun:test"
import { parseSource, STRUCTURE_ONLY } from "../../frontend/syntax/index.js"
import { parseNetworkText } from "../../frontend/types/index.js"
import { build } from "../../frontend/symbols/index.js"
import {
  networkCompletion,
  networkDefinition,
  networkHover,
  networkResolveAt,
  readOnlyBodyHover,
  referencesAnywhere,
  renameAnywhere,
} from "./network-services.js"
import { doc, project, projectDiags, vgBody, vgDiags } from "../../../test/support/network-docs.js"

// ─── F.2d services ────────────────────────────────────────────────────────────

const WIRED = `FUNCTION_BLOCK F
VAR a : BOOL; b : BOOL; out : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
VAR_TEMP g1 : BOOL; END_VAR
g1 := (a AND b);
out := g1;
END_NETWORK
END_FUNCTION_BLOCK`

test("network text hover: a wire shows its declaration and its producer", () => {
  const d = doc(WIRED)
  const off = WIRED.indexOf("out := g1") + "out := ".length // the `g1` USE
  const value = (networkHover(d, project(d), off) as { contents: { value: string } })?.contents.value
  expect(value).toContain("g1 : BOOL")
  expect(value).toContain("g1 := (a AND b);")
})

test("network text hover: a real variable shows its declared type", () => {
  const d = doc(WIRED)
  const off = WIRED.indexOf("(a AND b)") + 1 // the `a` operand
  const h = networkHover(d, project(d), off)
  expect((h as { contents: { value: string } })?.contents.value).toContain("a : BOOL")
})

test("network text definition: a wire use jumps to its VAR_TEMP declaration", () => {
  const d = doc(WIRED)
  const useOff = WIRED.indexOf("out := g1") + "out := ".length
  const loc = networkDefinition(d, project(d), useOff)
  const declLine = WIRED.slice(0, WIRED.indexOf("VAR_TEMP")).split("\n").length - 1 // 0-based line of the block
  expect(loc?.range.start.line).toBe(declLine)
})

test("network text definition: a real-var operand jumps to its declaration", () => {
  const d = doc(WIRED)
  const off = WIRED.indexOf("(a AND b)") + 1
  const loc = networkDefinition(d, project(d), off)
  expect(loc?.range.start.line).toBe(1) // the VAR line
})

test("network text completion: offers POU vars AND the network's wires", () => {
  const d = doc(WIRED)
  const off = WIRED.indexOf("out := g1") + "out := ".length
  const labels = networkCompletion(d, project(d), off).map((c) => c.label)
  expect(labels).toContain("out") // POU var
  expect(labels).toContain("g1") // network wire
})

test("network text resolve: a member chain operand resolves to its field", () => {
  const src = `FUNCTION_BLOCK Inner
VAR Q : BOOL; END_VAR
END_FUNCTION_BLOCK
FUNCTION_BLOCK F
VAR t : Inner; done : BOOL; END_VAR
IMPLEMENTATION FBD
NETWORK
done := t.Q;
END_NETWORK
END_FUNCTION_BLOCK`
  const d = doc(src)
  const off = src.indexOf("t.Q") + 2 // the `Q` member
  const sym = networkResolveAt(d, project(d), off)
  expect(sym?.name).toBe("Q")
})

test("network text: a hidden body's line hover explains the body (F.2e)", () => {
  const src = `FUNCTION_BLOCK F\nVAR END_VAR\nIMPLEMENTATION CFC UNSUPPORTED\nEND_FUNCTION_BLOCK`
  const d = doc(src)
  const value = (readOnlyBodyHover(d, src.indexOf("CFC")) as { contents: { value: string } })?.contents.value
  expect(value).toContain("Continuous Function Chart")
  expect(value).toContain("IDE")
  expect(value).toContain("declaration")   // 3b: the declaration above the line stays editable
  // a hidden body is read by neither parser (no diagnostics)
  expect(vgDiags(src)).toEqual([])

  const ld = `FUNCTION_BLOCK F\nVAR END_VAR\nIMPLEMENTATION LD UNSUPPORTED\nEND_FUNCTION_BLOCK`
  const unsupported = (readOnlyBodyHover(doc(ld), ld.indexOf("UNSUPPORTED")) as { contents: { value: string } })?.contents.value
  expect(unsupported).toContain("Ladder Diagram")
  expect(unsupported).toContain("cannot represent")

  // A language Volt has never seen, under the vendor's name (D27): Volt does not read it — no network-text excuse.
  const uml = `FUNCTION_BLOCK F\nVAR END_VAR\nIMPLEMENTATION UML UNSUPPORTED\nEND_FUNCTION_BLOCK`
  const unknown = (readOnlyBodyHover(doc(uml), uml.indexOf("UML")) as { contents: { value: string } })?.contents.value
  expect(unknown).toContain("Volt does not read UML")
  expect(vgDiags(uml)).toEqual([])

  // Only the line a body opens with answers — not an ST body, and not the line quoted in a comment.
  const st = `FUNCTION_BLOCK F\nVAR END_VAR\n(* IMPLEMENTATION CFC UNSUPPORTED *)\nIMPLEMENTATION ST\nEND_FUNCTION_BLOCK`
  expect(readOnlyBodyHover(doc(st), st.indexOf("CFC"))).toBeUndefined()
  expect(readOnlyBodyHover(doc(st), st.indexOf("ST\n"))).toBeUndefined()
})

// ─── cross-body references / rename: a symbol used in BOTH ST and network text bodies ─────

/** A multi-file project: a GVL global read by one FB's ST body and another FB's network text (LD) body. */
function crossBodyProject() {
  const files: Record<string, string> = {
    "file:///G.gvl": `VAR_GLOBAL\n\tFlag : BOOL;\nEND_VAR`,
    "file:///FB_ST.pou": `FUNCTION_BLOCK FB_ST\nFlag := TRUE;\nEND_FUNCTION_BLOCK`,
    "file:///FB_VG.pou": `FUNCTION_BLOCK FB_VG\nVAR\n\tx : BOOL;\nEND_VAR\nIMPLEMENTATION LD
NETWORK\nx := Flag;\nEND_NETWORK\nEND_FUNCTION_BLOCK`,
  }
  const docs = Object.entries(files).map(([uri, source]) => ({ uri, source, parseResult: parseSource(source, { networkText: true }, "codesys") }))
  return { docs, project: build.buildSymbolTable(docs, [], "codesys"), by: (uri: string) => docs.find((d) => d.uri === uri)! }
}

test("network text references: a global read in a network-text operand is found from an ST cursor", () => {
  const { docs, project, by } = crossBodyProject()
  const st = by("file:///FB_ST.pou")
  const locs = referencesAnywhere(docs, project, st, st.source.indexOf("Flag"))
  const uris = new Set(locs?.map((l) => l.uri))
  // declaration (GVL) + the ST use + the network-text operand use — the network-text body must not be missed
  expect(uris).toEqual(new Set(["file:///G.gvl", "file:///FB_ST.pou", "file:///FB_VG.pou"]))
})

test("network text rename: renaming from a network-text operand edits every ST and network text occurrence", () => {
  const { docs, project, by } = crossBodyProject()
  const vg = by("file:///FB_VG.pou")
  const edit = renameAnywhere(docs, project, vg, vg.source.indexOf("Flag"), "Enabled")
  const changed = Object.keys(edit?.changes ?? {}).sort()
  expect(changed).toEqual(["file:///FB_ST.pou", "file:///FB_VG.pou", "file:///G.gvl"])
  // the network-text operand edit lands on `Flag` within the LD network
  const vgEdits = edit!.changes!["file:///FB_VG.pou"]!
  expect(vgEdits.every((e) => e.newText === "Enabled")).toBe(true)
})

test("network text references: a cursor outside any symbol resolves to nothing", () => {
  const { docs, project, by } = crossBodyProject()
  const vg = by("file:///FB_VG.pou")
  expect(referencesAnywhere(docs, project, vg, vg.source.indexOf("NETWORK"))).toBeUndefined()
})

test("network text rename: a new name that is a word of the text is backticked where the text reads it bare", () => {
  const files: Record<string, string> = {
    "file:///G.gvl": `VAR_GLOBAL\n\tFlag : BOOL;\nEND_VAR`,
    "file:///FB_ST.pou": `FUNCTION_BLOCK FB_ST\nFlag := TRUE;\nEND_FUNCTION_BLOCK`,
    "file:///FB_VG.pou": `FUNCTION_BLOCK FB_VG\nVAR\n\tx : BOOL;\nEND_VAR\nIMPLEMENTATION LD
NETWORK\nx := Flag;\nFlag := x;\nx := \`Flag OR x\`;\nEND_NETWORK\nEND_FUNCTION_BLOCK`,
  }
  const docs = Object.entries(files).map(([uri, source]) => ({ uri, source, parseResult: parseSource(source, { networkText: true }, "codesys") }))
  const proj = build.buildSymbolTable(docs, [], "codesys")
  const vg = docs.find((d) => d.uri === "file:///FB_VG.pou")!
  const edit = renameAnywhere(docs, proj, vg, vg.source.indexOf("Flag"), "Execute")!
  // ST and a declaration take the name as it is; inside backticked text it is verbatim ST, so it is not backticked again.
  expect(edit.changes!["file:///G.gvl"]!.map((e) => e.newText)).toEqual(["Execute"])
  expect(edit.changes!["file:///FB_ST.pou"]!.map((e) => e.newText)).toEqual(["Execute"])
  expect(edit.changes!["file:///FB_VG.pou"]!.map((e) => e.newText)).toEqual(["`Execute`", "`Execute`", "Execute"])
  // …and the renamed network reads clean.
  const lines = vg.source.split("\n")
  for (const e of [...edit.changes!["file:///FB_VG.pou"]!].reverse()) {
    const l = lines[e.range.start.line]!
    lines[e.range.start.line] = l.slice(0, e.range.start.character) + e.newText + l.slice(e.range.end.character)
  }
  const renamed = lines.join("\n").replace("\tx : BOOL;", "\tx : BOOL;\n\tExecute : BOOL;")
  expect(parseNetworkText(vgBody(renamed), STRUCTURE_ONLY, "codesys").diagnostics).toEqual([])
})

test("network text: a marker line with trailing blanks is the marker — the bridge's line allows them", () => {
  // `ImplementationMarker.Line` is `^\s*(*…*)\s*$`: a trailing space or tab after the marker is layout. Refused here, the
  // body read no networks at all, so rename and references skipped it and a rename left the old name behind.
  const files: Record<string, string> = {
    "file:///G.gvl": `VAR_GLOBAL\n\tFlag : BOOL;\nEND_VAR`,
    "file:///S.pou": `PROGRAM S\nFlag := TRUE;\nEND_PROGRAM`,
    "file:///P.pou": `PROGRAM P\nVAR x : BOOL; END_VAR\nIMPLEMENTATION FBD \t\nNETWORK\nx := Flag;\nEND_NETWORK\nEND_PROGRAM`,
  }
  expect(projectDiags(files, "file:///P.pou")).toEqual([])
  const docs = Object.entries(files).map(([uri, source]) => ({ uri, source, parseResult: parseSource(source, { networkText: true }, "codesys") }))
  const proj = build.buildSymbolTable(docs, [], "codesys")
  const s = docs.find((d) => d.uri === "file:///S.pou")!
  const edit = renameAnywhere(docs, proj, s, s.source.indexOf("Flag"), "Enabled")
  expect(Object.keys(edit?.changes ?? {}).sort()).toEqual(["file:///G.gvl", "file:///P.pou", "file:///S.pou"])
})
