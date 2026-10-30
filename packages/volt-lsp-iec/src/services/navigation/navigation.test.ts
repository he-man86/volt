import { test, expect } from "bun:test"
import { parseSource } from "../../frontend/syntax/index.js"
import { definition, typeDefinition, implementation } from "./index.js"
import { documentHighlights, prepareRename, references, rename, renameRefusal } from "./index.js"
import type { Document } from "../shared/index.js"
import { build } from "../../frontend/symbols/index.js"

function setup(src: string) {
  const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const doc: Document = { uri: "file:///F.pou", source: src, parseResult }
  const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }], [], "codesys")
  return { doc, project }
}

/** Byte offset just inside the `n`-th occurrence of `needle`. */
function at(src: string, needle: string, n = 1): number {
  let idx = -1
  for (let i = 0; i < n; i++) idx = src.indexOf(needle, idx + 1)
  return idx + 1
}

const FB = `FUNCTION_BLOCK F
VAR
	count : INT;
END_VAR
count := count + 1;
END_FUNCTION_BLOCK`

const IFACE = `INTERFACE IThing
METHOD Run : BOOL
END_METHOD
END_INTERFACE
FUNCTION_BLOCK Doer IMPLEMENTS IThing
END_FUNCTION_BLOCK
METHOD Run : BOOL
END_METHOD`

test("implementation: interface → implementing FB; interface method → concrete method", () => {
  const { doc, project } = setup(IFACE)
  const onIface = implementation([doc], project, doc, at(IFACE, "INTERFACE IThing") + "INTERFACE ".length)
  expect(onIface?.map((l) => l.range.start.line)).toEqual([4]) // the `Doer` name on line 5

  const onMethod = implementation([doc], project, doc, at(IFACE, "METHOD Run") + "METHOD ".length)
  expect(onMethod).toHaveLength(1) // Doer's concrete Run
})

test("implementation: a plain variable resolves to nothing", () => {
  const { doc, project } = setup(FB)
  expect(implementation([doc], project, doc, at(FB, "count", 1))).toBeUndefined()
})

test("definition: a body usage lands on the declaration", () => {
  const { doc, project } = setup(FB)
  const fromUsage = definition(doc, project, at(FB, "count", 2)) // `count :=`
  const fromDecl = definition(doc, project, at(FB, "count", 1)) // the declaration
  expect(fromUsage).toBeDefined()
  expect(fromUsage).toEqual(fromDecl) // both resolve to the same declaring location
  expect(fromUsage?.range.start).toEqual({ line: 2, character: 1 }) // `\tcount` on line 3
})

test("references + rename cover every binding (decl + 2 uses)", () => {
  const { doc, project } = setup(FB)
  const refs = references([doc], project, doc, at(FB, "count", 2))
  expect(refs).toHaveLength(3) // declaration + `count :=` + `count + 1`
  const edit = rename([doc], project, doc, at(FB, "count", 2), "total")
  expect(Object.values(edit!.changes!)[0]).toHaveLength(3)
  expect(references([doc], project, doc, at(FB, "count", 2), false)).toHaveLength(2) // no declaration
})

test("document highlights return the in-document occurrences", () => {
  const { doc, project } = setup(FB)
  expect(documentHighlights(doc, project, at(FB, "count", 2))).toHaveLength(3)
})

test("prepareRename gives the identifier range; undefined off a symbol", () => {
  const { doc, project } = setup(FB)
  expect(prepareRename(doc, project, at(FB, "count", 2))).toBeDefined()
  expect(prepareRename(doc, project, at(FB, "END_VAR", 1))).toBeUndefined() // a keyword, not a symbol
})

const CHAIN = `FUNCTION_BLOCK FB_A
VAR
	n : INT;
END_VAR
END_FUNCTION_BLOCK
FUNCTION_BLOCK F
VAR
	inst : FB_A;
END_VAR
inst.n := 1;
END_FUNCTION_BLOCK`

test("member-chain definition + type-definition", () => {
  const { doc, project } = setup(CHAIN)
  // definition on `inst.n` → n's declaration inside FB_A (offset on the `n` member)
  const nDef = definition(doc, project, CHAIN.indexOf("inst.n") + "inst.".length)
  expect(nDef?.range.start).toEqual({ line: 2, character: 1 }) // `\tn : INT` in FB_A
  // type-definition on `inst` → FB_A's declaration
  const tDef = typeDefinition(doc, project, at(CHAIN, "inst : FB_A", 1))
  expect(tDef?.range.start).toEqual({ line: 0, character: 15 }) // `FUNCTION_BLOCK FB_A`
})

// A rename edits TEXT: a use in a conditional branch the vendor does not compile today — not taken, or under a condition
// the LSP cannot decide (`defined (IsSimulationMode)`, a device fact) — compiles again when the condition flips, so a
// rename that skipped it would leave a stale name and break the project (frontend-conformance 2.7 review).
const CONDITIONAL = `FUNCTION_BLOCK F
VAR
	count : INT;
END_VAR
{define HERE}
{IF defined (HERE)}
count := 1;
{ELSE}
count := 2;
{END_IF}
END_FUNCTION_BLOCK
METHOD Sim
{IF defined (IsSimulationMode)}
count := 3;
{END_IF}
count := count + 4;
END_METHOD`

test("references, rename and highlight reach a use in an untaken branch and in a body whose condition is undecided", () => {
  const { doc, project } = setup(CONDITIONAL)
  const uses = [2, 3, 4, 5, 6] // `count := 1` (taken), `count := 2` (untaken), `count := 3` (undecided), `count := count + 4`
  const lines = (refs: readonly { range: { start: { line: number } } }[] | undefined) => (refs ?? []).map((r) => r.range.start.line).sort((a, b) => a - b)
  expect(lines(references([doc], project, doc, at(CONDITIONAL, "count", 2)))).toEqual([2, 6, 8, 13, 15, 15])
  expect(Object.values(rename([doc], project, doc, at(CONDITIONAL, "count", 2), "total")!.changes!)[0]).toHaveLength(uses.length + 1)
  expect(documentHighlights(doc, project, at(CONDITIONAL, "count", 3))).toHaveLength(uses.length + 1)
  // and the cursor features answer inside the branch the analysis tree leaves out
  expect(definition(doc, project, at(CONDITIONAL, "count", 3))?.range.start).toEqual({ line: 2, character: 1 })
  expect(definition(doc, project, at(CONDITIONAL, "count", 4))?.range.start).toEqual({ line: 2, character: 1 })
})

// A branch the vendor does not compile is parsed IN SILENCE (`prag_untaken_branch_syntax_error` builds on both vendors):
// a syntax error there must not void the rest of the body in the source walk, or a rename edits the declaration and
// leaves every other use in the body stale (frontend-conformance 2.7 review).
const BROKEN_BRANCH = `FUNCTION_BLOCK F
VAR
	count : INT;
END_VAR
count := 1;
{IF defined (VOLT_NEVER_DEFINED)}
count := ;
{END_IF}
count := count + 2;
END_FUNCTION_BLOCK
METHOD Sim
{IF defined (IsSimulationMode)}
count := ;
{END_IF}
count := 3;
END_METHOD`

test("references and rename reach every use of a body whose untaken or undecided branch holds a syntax error", () => {
  const { doc, project } = setup(BROKEN_BRANCH)
  const sorted = (ls: number[]) => ls.sort((a, b) => a - b)
  // every use outside the broken statements (`count := ;` is refused, its target read by no recovery)
  expect(sorted((references([doc], project, doc, at(BROKEN_BRANCH, "count", 1)) ?? []).map((r) => r.range.start.line))).toEqual([2, 4, 8, 8, 14])
  const edits = Object.values(rename([doc], project, doc, at(BROKEN_BRANCH, "count", 1), "total")!.changes!)[0]!
  expect(sorted(edits.map((e) => e.range.start.line))).toEqual([2, 4, 8, 8, 14])
})

// ─── rename edits only what Volt pushes (lsp-same-standard 3.1, finding R5) ───
// A library element is a READ-ONLY materialization under `Library Manager/` — the push never writes it, and its name
// is the library's. Renaming one edited that file and every use, so the project named an element no library has.

const LIB_URI = "file:///w/Library%20Manager/Util/FB_Lib.pou"
const LIB = `FUNCTION_BLOCK FB_Lib\nVAR_INPUT\n\tx : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`
const USER = `PROGRAM P\nVAR\n\tinst : FB_Lib;\nEND_VAR\n%LANGUAGE ST\ninst(x := 1);\nEND_PROGRAM`

function withLibrary() {
  const files = [
    { uri: LIB_URI, source: LIB },
    { uri: "file:///w/P.pou", source: USER },
  ].map((f) => ({ ...f, parseResult: parseSource(f.source, { networkText: true, unicodeIdentifiers: false }, "codesys") }))
  const project = build.buildSymbolTable(files, [], "codesys")
  const doc: Document = files[1]!
  return { docs: files as Document[], doc, project }
}

test("a library element is not renameable: prepare refuses it and rename edits nothing", () => {
  const { docs, doc, project } = withLibrary()
  const onType = at(USER, "FB_Lib") // the type name in `inst : FB_Lib`
  const onInput = at(USER, "x := 1") // the library FB's input
  for (const offset of [onType, onInput]) {
    expect(prepareRename(doc, project, offset)).toBeUndefined()
    expect(rename(docs, project, doc, offset, "Other")).toBeUndefined()
  }
  // the project's own instance still renames
  expect(prepareRename(doc, project, at(USER, "inst", 2))).toBeDefined()
})

// ─── a rename's new name must be one the dialect accepts (lsp-same-standard 3.1, finding R6) ───
// Any text was written over every occurrence: `IF`, `1x` or `a__b` left a project the compiler refuses at each use.

test("a new name the dialect refuses is refused by name; one it accepts is not", () => {
  const { project } = setup(FB)
  for (const bad of ["IF", "1x", "a b", "a__b", "INT", "", "x;"]) expect(renameRefusal(bad, project, false)).toMatch(/is no name/)
  expect(renameRefusal("total", project, false)).toBeUndefined()
  // the dialect decides, from its one fact: LDATE is a CODESYS type word and a plain name on TwinCAT
  expect(renameRefusal("LDATE", project, false)).toMatch(/is no name/)
  expect(renameRefusal("LDATE", build.buildSymbolTable([], [], "twincat"), false)).toBeUndefined()
})
