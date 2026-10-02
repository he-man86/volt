/**
 * references/rename over TYPE positions (P0 — the rename-corruption bug). A type used only in declarations
 * (`inst : T`, `EXTENDS T`, `IMPLEMENTS T`, return type) must be found by references and updated by rename —
 * otherwise renaming the type silently leaves those uses stale, producing a broken project.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { definition, references, rename } from "./index.js"
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
  const parseResult = parseSource(SRC, { networkText: true })
  const doc: Document = { uri: "file:///F.fb", source: SRC, parseResult }
  return { doc, project: build.buildSymbolTable([{ uri: doc.uri, parseResult, source: SRC }]) }
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
  const edits = edit?.changes?.["file:///F.fb"] ?? []
  expect(edits).toHaveLength(6)
  // Apply the edits and confirm no "FB_Base" survives and the code still parses.
  const applied = applyEdits(SRC, edits)
  expect(applied).not.toContain("FB_Base")
  expect(parseSource(applied, { networkText: true }).errors).toHaveLength(0)
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
  const parseResult = parseSource(src, { networkText: true })
  const doc: Document = { uri: "file:///G.fb", source: src, parseResult }
  const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }])
  // Rename the local var `T : INT` — must touch only the var (decl + 2 body uses = 3), never the FB type `T`.
  const varDecl = src.indexOf("T : INT")
  const edit = rename([doc], project, doc, varDecl, "n")
  expect(edit?.changes?.["file:///G.fb"] ?? []).toHaveLength(3)
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
  const parseResult = parseSource(src, { networkText: true })
  const doc: Document = { uri: "file:///H.fb", source: src, parseResult }
  const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }])
  const bare = src.indexOf("o := gv;") + "o := ".length
  // the global: its declaration, `.gv` and `gv` in F, `.gv` in G — never G's local `gv`
  expect(references([doc], project, doc, bare)).toHaveLength(4)
  const edit = rename([doc], project, doc, bare, "gx")
  const applied = applyEdits(src, edit?.changes?.["file:///H.fb"] ?? [])
  expect(applied).toContain("o := .gx;\no := gx;")
  expect(applied).toContain("gv := .gx;")
  // …and from the `.gv` itself
  const dotted = src.indexOf(".gv;") + 1
  expect(definition(doc, project, dotted)?.range.start.line).toBe(1)
  expect(references([doc], project, doc, dotted)).toHaveLength(4)
})
