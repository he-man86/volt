/**
 * unresolved-identifier check — targeted cases. Policy: the corpus FP gate only DISCOVERS gaps; each gap
 * (and its fix) is pinned here as an explicit test so a regression is caught at the unit, not the corpus.
 *
 * Corpus-discovered gaps pinned below: `THIS`/`SUPER` (OOP self/base pointers), `TRUNC`/`TRUNC_INT`
 * (standard functions absent from the catalog), plus the whole skip surface (conversion calls, `__`-system
 * operators, bare enum members, referenced-library namespaces, device instances, conditional-compile bodies).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig, type WorkspaceRefs } from "../../index.js"

/** Diagnostics for one FB source, optionally with workspace reference-file names injected. */
function diag(src: string, references?: WorkspaceRefs) {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }), references })
}

/** unresolved-identifier messages only (ignore other checks that may fire on the same snippet). */
const unresolved = (src: string, references?: WorkspaceRefs): string[] =>
  diag(src, references)
    .filter((d) => d.code === "unresolved-identifier")
    .map((d) => d.message)

const fb = (varsAndBody: string) => `FUNCTION_BLOCK F\n${varsAndBody}\nEND_FUNCTION_BLOCK`

test("a genuinely-undefined identifier IS flagged, byte-identical to the compiler", () => {
  expect(unresolved(fb(`VAR a : INT; END_VAR\na := nope;`))).toEqual(["Identifier 'nope' not defined"])
})

test("an in-scope variable is not flagged", () => {
  expect(unresolved(fb(`VAR a : INT; b : INT; END_VAR\na := b;`))).toEqual([])
})

// Gap found via corpus: THIS/SUPER are OOP implicit pointers, not scope symbols → must not flag.
test("THIS and SUPER (OOP self/base pointers) are not flagged", () => {
  expect(unresolved(fb(`VAR a : INT; END_VAR\nTHIS^.a := 1;\nSUPER^.a := 2;`))).toEqual([])
})

// Gap found via corpus: TRUNC / TRUNC_INT are standard functions the catalog was missing.
test("TRUNC and TRUNC_INT (standard functions) are not flagged", () => {
  expect(unresolved(fb(`VAR r : REAL; i : INT; END_VAR\ni := TRUNC(r);\ni := TRUNC_INT(r);`))).toEqual([])
})

test("a conversion call (INT_TO_REAL) is not flagged", () => {
  expect(unresolved(fb(`VAR r : REAL; i : INT; END_VAR\nr := INT_TO_REAL(i);`))).toEqual([])
})

test("a __-prefixed system operator is not flagged", () => {
  expect(unresolved(fb(`VAR p : POINTER TO INT; END_VAR\nIF __ISVALIDREF(p) THEN ; END_IF`))).toEqual([])
})

test("a built-in operator (SEL) is not flagged", () => {
  expect(unresolved(fb(`VAR a : INT; b : INT; c : BOOL; END_VAR\na := SEL(c, a, b);`))).toEqual([])
})

test("a bare-accessible enum member (non-qualified_only) is not flagged", () => {
  const src = `TYPE E : (Idle, Running); END_TYPE\nFUNCTION_BLOCK F\nVAR s : E; END_VAR\ns := Running;\nEND_FUNCTION_BLOCK`
  expect(unresolved(src)).toEqual([])
})

// Gap: a referenced-library namespace resolves outside the symbol table → skip when known.
test("a referenced-library namespace is not flagged when supplied", () => {
  const refs: WorkspaceRefs = { libraryNamespaces: new Set(["pack_ml"]), deviceInstances: new Set() }
  const src = fb(`VAR a : INT; END_VAR\na := PACK_ML.gConstant;`)
  expect(unresolved(src)).toEqual(["Identifier 'PACK_ML' not defined"]) // unknown → flagged
  expect(unresolved(src, refs)).toEqual([]) // known library namespace → skipped
})

// Gap: a device-tree instance is an implicit global mirrored as a `.device` file → skip when known.
test("a device-tree instance is not flagged when supplied", () => {
  const refs: WorkspaceRefs = { libraryNamespaces: new Set(), deviceInstances: new Set(["ethercat_master"]) }
  const src = fb(`VAR a : INT; END_VAR\na := EtherCAT_Master.wState;`)
  expect(unresolved(src, refs)).toEqual([])
})

// A conditional-compile pragma disables the whole body (no preprocessor → would false-positive on dead branches).
test("a body with a conditional-compile pragma is skipped entirely", () => {
  const src = fb(`VAR a : INT; END_VAR\n{IF defined(FOO)}\na := onlyInThatBranch;\n{END_IF}`)
  expect(unresolved(src)).toEqual([])
})
