/**
 * The reference set (`references.ts`), as references and rename read it: references/rename over TYPE positions (P0 — the rename-corruption bug). A type used only in declarations
 * (`inst : T`, `EXTENDS T`, `IMPLEMENTS T`, return type) must be found by references and updated by rename —
 * otherwise renaming the type silently leaves those uses stale, producing a broken project.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { definition } from "./index.js"
import { references, rename } from "./rename.js"
import type { Document } from "../shared/index.js"
import { build } from "../../frontend/symbols/index.js"

const SRC = `FUNCTION_BLOCK FB_Base
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_Derived EXTENDS FB_Base
VAR
    inner : FB_Base;
    arr : ARRAY[0..3] OF FB_Base;
END_VAR
END_FUNCTION_BLOCK

PROGRAM PLC_PRG
VAR
    a : FB_Base;
    b : FB_Base;
END_VAR
a();
END_PROGRAM`

const setup = () => {
  const parseResult = parseSource(SRC, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const doc: Document = { uri: "file:///F.pou", source: SRC, parseResult }
  return { doc, project: build.buildSymbolTable([{ uri: doc.uri, parseResult, source: SRC }], [], "codesys") }
}
const at = (needle: string, n = 1) => {
  let i = -1
  for (let k = 0; k < n; k++) i = SRC.indexOf(needle, i + 1)
  return i + 1
}

test("references on a type include EXTENDS + every `: FB_Base` declaration use", () => {
  const { doc, project } = setup()
  // FB_Base is used: its decl + EXTENDS FB_Base + inner:FB_Base + arr OF FB_Base + a:FB_Base + b:FB_Base = 6
  const refs = references([doc], project, doc, at("FUNCTION_BLOCK FB_Base") + "FUNCTION_BLOCK ".length)
  expect(refs).toHaveLength(6)
})

test("rename of a type rewrites its type-position uses (no stale `: FB_Base` left)", () => {
  const { doc, project } = setup()
  const edit = rename([doc], project, doc, at("FUNCTION_BLOCK FB_Base") + "FUNCTION_BLOCK ".length, "FB_Renamed")
  const edits = edit?.changes?.["file:///F.pou"] ?? []
  expect(edits).toHaveLength(6)
  // Apply the edits and confirm no "FB_Base" survives and the code still parses.
  const applied = applyEdits(SRC, edits)
  expect(applied).not.toContain("FB_Base")
  expect(parseSource(applied, { networkText: true, unicodeIdentifiers: false }, "codesys").errors).toHaveLength(0)
})

test("a same-named local variable is NOT swept up by a type rename (identity, not text)", () => {
  const src = `FUNCTION_BLOCK T
END_FUNCTION_BLOCK
PROGRAM PLC_PRG
VAR
    T : INT;
END_VAR
T := T + 1;
END_PROGRAM`
  const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const doc: Document = { uri: "file:///G.pou", source: src, parseResult }
  const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }], [], "codesys")
  // Rename the local var `T : INT` — must touch only the var (decl + 2 body uses = 3), never the FB type `T`.
  const varDecl = src.indexOf("T : INT")
  const edit = rename([doc], project, doc, varDecl, "n")
  expect(edit?.changes?.["file:///G.pou"] ?? []).toHaveLength(3)
})

/** Apply LSP text edits (non-overlapping) to a source string, right-to-left so offsets stay valid. */
function applyEdits(src: string, edits: { range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }[]): string {
  const lines = src.split("\n")
  const off = (p: { line: number; character: number }) => lines.slice(0, p.line).reduce((a, l) => a + l.length + 1, 0) + p.character
  const sorted = [...edits].sort((a, b) => off(b.range.start) - off(a.range.start))
  let out = src
  for (const e of sorted) out = out.slice(0, off(e.range.start)) + e.newText + out.slice(off(e.range.end))
  return out
}

// A GLOBAL named through the global-namespace dot (`.gv`, rule E33) is a reference to it like the bare name: rename,
// references and go-to-definition each matched only `ident_expr`, so a rename of `gv` left `.gv` behind — which the LSP
// itself then reports "There is no global definition for 'gv'". And `.gv` resolves past a local of the same name.
test("rename, references and definition see `.gv` (the global-namespace dot, E33)", () => {
  const src = `VAR_GLOBAL
    gv : INT;
END_VAR
FUNCTION_BLOCK F
VAR
    o : INT;
END_VAR
o := .gv;
o := gv;
END_FUNCTION_BLOCK
FUNCTION_BLOCK G
VAR
    gv : INT;
END_VAR
gv := .gv;
END_FUNCTION_BLOCK`
  const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const doc: Document = { uri: "file:///H.pou", source: src, parseResult }
  const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }], [], "codesys")
  const bare = src.indexOf("o := gv;") + "o := ".length
  // the global: its declaration, `.gv` and `gv` in F, `.gv` in G — never G's local `gv`
  expect(references([doc], project, doc, bare)).toHaveLength(4)
  const edit = rename([doc], project, doc, bare, "gx")
  const applied = applyEdits(src, edit?.changes?.["file:///H.pou"] ?? [])
  expect(applied).toContain("o := .gx;\no := gx;")
  expect(applied).toContain("gv := .gx;")
  // …and from the `.gv` itself
  const dotted = src.indexOf(".gv;") + 1
  expect(definition(doc, project, dotted)?.range.start.line).toBe(1)
  expect(references([doc], project, doc, dotted)).toHaveLength(4)
})

// A scene of several files (openspec references-named-pins): an FB's members named as a call's pins, in ST and in a
// network, a marked output, a box output read through its call, and a global asked at its declaration in its list.
const SCENE: Record<string, string> = {
  "file:///Belt.pou": `FUNCTION_BLOCK Belt
VAR_INPUT
    Speed : REAL;
END_VAR
VAR_OUTPUT
    Actual : REAL;
END_VAR
END_FUNCTION_BLOCK`,
  "file:///Eye.pou": `FUNCTION_BLOCK Eye
VAR_OUTPUT
    Active : BOOL;
END_VAR
END_FUNCTION_BLOCK`,
  "file:///Scene.gvl": `VAR_GLOBAL
    belt : Belt;
    eye : Eye;
END_VAR`,
  "file:///Main.pou": `PROGRAM Main
VAR
    v : REAL;
    Speed : REAL;
END_VAR
belt(Speed := Speed, Actual => v);
END_PROGRAM`,
  "file:///Cell.pou": `PROGRAM Cell
VAR
    av : REAL;
    y : BOOL;
END_VAR
%LANGUAGE LD
%NETWORK
belt(EN := RAIL(), Speed := av, Actual => av);
%NETWORK
ASSIGN(eye().Active, Q_INVERTED => y);
%NETWORK
AND(eye(Active_INVERTED => y), TRUE);
END_PROGRAM`,
}

const scene = () => {
  const docs: Document[] = Object.entries(SCENE).map(([uri, source]) => ({
    uri,
    source,
    parseResult: parseSource(source, { networkText: true, unicodeIdentifiers: false }, "codesys"),
  }))
  const project = build.buildSymbolTable(docs.map((d) => ({ uri: d.uri, parseResult: d.parseResult, source: d.source })), [], "codesys")
  const doc = (name: string) => docs.find((d) => d.uri.endsWith(name))!
  const renamed = (file: string, needle: string, to: string) => {
    const d = doc(file)
    const edit = rename(docs, project, d, d.source.indexOf(needle), to)
    return Object.fromEntries(docs.map((x) => [x.uri.slice("file:///".length), applyEdits(x.source, edit?.changes?.[x.uri] ?? [])]))
  }
  return { docs, project, doc, renamed }
}

test("a global asked at its declaration in its list is the global, not the list (A)", () => {
  const { docs, project, doc, renamed } = scene()
  const gvl = doc("Scene.gvl")
  const atEye = gvl.source.indexOf("eye :")
  expect(definition(gvl, project, atEye)?.range.start.line).toBe(2)
  // …and its type beside it, `Eye`, is the FB, never the global of its name (case-insensitive)
  expect(definition(gvl, project, gvl.source.indexOf(": Eye") + 2)?.uri).toBe("file:///Eye.pou")
  expect(references(docs, project, gvl, atEye)).toHaveLength(3) // its declaration and Cell's two boxes
  const out = renamed("Scene.gvl", "eye :", "cam")
  expect(out["Scene.gvl"]).toContain("cam : Eye;")
  expect(out["Cell.pou"]).toContain("ASSIGN(cam().Active, Q_INVERTED => y);")
  expect(out["Cell.pou"]).toContain("AND(cam(Active_INVERTED => y), TRUE);")
})

test("a rename of an input renames the call's named pin, in ST and in a network — never a local of its name (B)", () => {
  const { renamed } = scene()
  const out = renamed("Belt.pou", "Speed :", "Velocity")
  expect(out["Belt.pou"]).toContain("Velocity : REAL;")
  expect(out["Main.pou"]).toContain("belt(Velocity := Speed, Actual => v);")
  expect(out["Main.pou"]).toContain("    Speed : REAL;")
  expect(out["Cell.pou"]).toContain("belt(EN := RAIL(), Velocity := av, Actual => av);")
  // …and the local renamed leaves the pin
  expect(renamed("Main.pou", "Speed :", "s")["Main.pou"]).toContain("belt(Speed := s, Actual => v);")
})

test("a rename of an output renames `=>` pins, a marked one's name part, and a box output read through its call (B, C)", () => {
  const { renamed } = scene()
  expect(renamed("Belt.pou", "Actual :", "Real")["Main.pou"]).toContain("belt(Speed := Speed, Real => v);")
  const out = renamed("Eye.pou", "Active :", "On")
  expect(out["Eye.pou"]).toContain("On : BOOL;")
  expect(out["Cell.pou"]).toContain("ASSIGN(eye().On, Q_INVERTED => y);")
  expect(out["Cell.pou"]).toContain("AND(eye(On_INVERTED => y), TRUE);")
  expect(out["Cell.pou"]).toContain("belt(EN := RAIL(), Speed := av, Actual => av);")
})

test("a rename of a FUNCTION's input renames its named pin in a call", () => {
  const files: Record<string, string> = {
    "file:///F.pou": `FUNCTION F : INT
VAR_INPUT
    inp : INT;
END_VAR
F := inp;
END_FUNCTION`,
    "file:///P.pou": `PROGRAM P
VAR
    res : INT;
END_VAR
res := F(inp := 1);
END_PROGRAM`,
  }
  const docs: Document[] = Object.entries(files).map(([uri, source]) => ({
    uri,
    source,
    parseResult: parseSource(source, { networkText: true, unicodeIdentifiers: false }, "codesys"),
  }))
  const project = build.buildSymbolTable(docs.map((d) => ({ uri: d.uri, parseResult: d.parseResult, source: d.source })), [], "codesys")
  const edit = rename(docs, project, docs[0]!, files["file:///F.pou"]!.indexOf("inp :"), "x")
  expect(applyEdits(files["file:///P.pou"]!, edit?.changes?.["file:///P.pou"] ?? [])).toContain("res := F(x := 1);")
})

test("a use in an initial value is a reference: a global's (`a : INT := g;`) and an FB output's (`b : TIME := t.ET;`)", () => {
  const src = `FUNCTION_BLOCK FB_T
VAR_OUTPUT
    ET : TIME;
END_VAR
END_FUNCTION_BLOCK

VAR_GLOBAL
    g : INT;
    t : FB_T;
END_VAR

PROGRAM P
VAR
    a : INT := g;
    b : TIME := t.ET;
END_VAR
a := g;
END_PROGRAM`
  const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const doc: Document = { uri: "file:///P.pou", source: src, parseResult }
  const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }], [], "codesys")
  const lines = (offset: number) => (references([doc], project, doc, offset) ?? []).map((r) => r.range.start.line).sort((x, y) => x - y)
  const g = src.indexOf("g : INT")
  expect(lines(g)).toEqual([7, 13, 16])
  expect(lines(src.indexOf("ET : TIME") + 1)).toEqual([2, 14])
  // asked at the use in the initial value: definition, references and rename act on the same symbols
  const atInit = src.indexOf(":= g;") + 3
  expect(definition(doc, project, atInit)?.range.start.line).toBe(7)
  expect(lines(atInit)).toEqual([7, 13, 16])
  expect(lines(src.indexOf("t.ET;") + 3)).toEqual([2, 14])
  const edits = rename([doc], project, doc, atInit, "gg")?.changes?.[doc.uri] ?? []
  expect(edits).toHaveLength(3)
})
