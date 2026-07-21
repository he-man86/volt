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

// ── member access (`a.b`) ────────────────────────────────────────────────────
const members = (src: string): string[] =>
  diag(src)
    .filter((d) => d.code === "unknown-member")
    .map((d) => d.message)

test("an unknown field of a project STRUCT is flagged", () => {
  const src = `TYPE Pt : STRUCT x : INT; y : INT; END_STRUCT END_TYPE
FUNCTION_BLOCK F
VAR p : Pt; i : INT; END_VAR
i := p.z;
END_FUNCTION_BLOCK`
  expect(members(src)).toEqual(["'z' is no component of 'Pt'"]) // CODESYS wording (confirmed live)
})

test("unknown-member wording is per-vendor: TwinCAT uppercases the type name (confirmed live)", () => {
  const src = `TYPE Pt : STRUCT x : INT; END_STRUCT END_TYPE
FUNCTION_BLOCK F
VAR p : Pt; i : INT; END_VAR
i := p.z;
END_FUNCTION_BLOCK`
  const tc = computeSemanticDiagnostics({
    parseResult: parseSource(src),
    source: src,
    project: buildSymbolTable([{ uri: "F.fb", parseResult: parseSource(src), source: src }]),
    config: resolveConfig({ vendor: "twincat" }),
  })
    .filter((d) => d.code === "unknown-member")
    .map((d) => d.message)
  expect(tc).toEqual(["'z' is no component of 'PT'"]) // TwinCAT uppercases the type
})

test("a declared field of a project STRUCT is not flagged", () => {
  const src = `TYPE Pt : STRUCT x : INT; y : INT; END_STRUCT END_TYPE
FUNCTION_BLOCK F
VAR p : Pt; i : INT; END_VAR
i := p.x;
END_FUNCTION_BLOCK`
  expect(members(src)).toEqual([])
})

test("an inherited member (via EXTENDS) is not flagged", () => {
  const src = `FUNCTION_BLOCK Base
VAR_INPUT enable : BOOL; END_VAR
END_FUNCTION_BLOCK
FUNCTION_BLOCK Derived EXTENDS Base
END_FUNCTION_BLOCK
FUNCTION_BLOCK F
VAR d : Derived; b : BOOL; END_VAR
d.enable := b;
END_FUNCTION_BLOCK`
  expect(members(src)).toEqual([])
})

// Gap found via conformance (DUT_LANG_struct_extends): a CODESYS DUT struct inherits its base's fields.
test("an inherited field of an EXTENDS struct is not flagged", () => {
  const src = `TYPE Base : STRUCT id : INT; END_STRUCT END_TYPE
TYPE Derived EXTENDS Base : STRUCT extra : INT; END_STRUCT END_TYPE
FUNCTION_BLOCK F
VAR d : Derived; i : INT; END_VAR
i := d.id;
END_FUNCTION_BLOCK`
  expect(members(src)).toEqual([])
})

test("a member on an unresolved-base FB is skipped (could be inherited)", () => {
  // Base is a library/undeclared FB → the member set is incomplete → never flag.
  const src = `FUNCTION_BLOCK Derived EXTENDS SomeLibraryFB
END_FUNCTION_BLOCK
FUNCTION_BLOCK F
VAR d : Derived; b : BOOL; END_VAR
d.whatever := b;
END_FUNCTION_BLOCK`
  expect(members(src)).toEqual([])
})

test("a namespace-qualified ref (base is not a value) is not flagged", () => {
  const src = fb(`VAR i : INT; END_VAR\ni := CAA.HANDLE;`)
  expect(members(src)).toEqual([]) // CAA infers to UNKNOWN → member skipped
})

test("member access on a LIBRARY-typed base is not flagged (signatures may be lossy)", () => {
  // The struct type lives under a `Library Manager/` uri → isLibrarySymbol → the member check must skip it.
  const libSrc = "TYPE Pt : STRUCT x : INT; END_STRUCT END_TYPE"
  const useSrc = `FUNCTION_BLOCK F\nVAR p : Pt; i : INT; END_VAR\ni := p.z;\nEND_FUNCTION_BLOCK`
  const libPr = parseSource(libSrc)
  const usePr = parseSource(useSrc)
  const project = buildSymbolTable([
    { uri: "Device/Plc Logic/Application/Library Manager/MyLib/Pt.dut", parseResult: libPr, source: libSrc },
    { uri: "F.fb", parseResult: usePr, source: useSrc },
  ])
  const diags = computeSemanticDiagnostics({ parseResult: usePr, source: useSrc, project, config: resolveConfig({ vendor: "codesys" }) })
  expect(diags.filter((d) => d.code === "unknown-member")).toEqual([]) // Pt is library-defined → skipped
})

test("member resolution works through nested chains, array elements, and derefs", () => {
  const nested = `TYPE Inner : STRUCT val : INT; END_STRUCT END_TYPE
TYPE Outer : STRUCT inner : Inner; END_STRUCT END_TYPE
FUNCTION_BLOCK F
VAR o : Outer; i : INT; END_VAR
i := o.inner.val;
END_FUNCTION_BLOCK`
  expect(members(nested)).toEqual([]) // whole chain valid — no FP
  expect(members(nested.replace("o.inner.val", "o.inner.nope"))).toEqual(["'nope' is no component of 'Inner'"])

  const arr = `TYPE Pt : STRUCT x : INT; END_STRUCT END_TYPE
FUNCTION_BLOCK F
VAR a : ARRAY[0..3] OF Pt; p : POINTER TO Pt; i : INT; END_VAR
i := a[0].z;
i := p^.z;
END_FUNCTION_BLOCK`
  expect(members(arr)).toEqual([
    "'z' is no component of 'Pt'", // through the array-element type
    "'z' is no component of 'Pt'", // through the pointer target type
  ])
})
