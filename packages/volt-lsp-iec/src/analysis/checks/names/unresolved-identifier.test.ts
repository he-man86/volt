/**
 * unresolved-identifier check — targeted cases. Policy: the corpus FP gate only DISCOVERS gaps; each gap
 * (and its fix) is pinned here as an explicit test so a regression is caught at the unit, not the corpus.
 *
 * Corpus-discovered gaps pinned below: `THIS`/`SUPER` (OOP self/base pointers), `TRUNC`/`TRUNC_INT`
 * (standard functions absent from the catalog), plus the whole skip surface (conversion calls, `__`-system
 * operators, bare enum members, referenced-library namespaces, device instances, conditional-compile bodies).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { LibraryManifest } from "../../../frontend/library/index.js"
import type { DeviceInstance } from "../../../frontend/symbols/index.js"

/** What a workspace binds beside its sources: library manifests and device-tree instances. */
interface Workspace {
  manifests?: readonly LibraryManifest[]
  devices?: readonly DeviceInstance[]
}

/** Diagnostics for one FB source, in a project optionally binding a workspace's manifests and devices. */
function diag(src: string, workspace: Workspace = {}) {
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], workspace.manifests ?? [], "codesys", undefined, workspace.devices ?? [])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
}

/** unresolved-identifier messages only (ignore other checks that may fire on the same snippet). */
const unresolved = (src: string, workspace?: Workspace): string[] =>
  diag(src, workspace)
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
  expect(unresolved(fb(`VAR rv : REAL; i : INT; END_VAR\ni := TRUNC(rv);\ni := TRUNC_INT(rv);`))).toEqual([])
})

test("a conversion call (INT_TO_REAL) is not flagged", () => {
  expect(unresolved(fb(`VAR rv : REAL; i : INT; END_VAR\nrv := INT_TO_REAL(i);`))).toEqual([])
})

test("a __-prefixed system operator is not flagged", () => {
  expect(unresolved(fb(`VAR p : POINTER TO INT; END_VAR\nIF __ISVALIDREF(p) THEN ; END_IF`))).toEqual([])
})

test("a built-in operator (SEL) is not flagged", () => {
  expect(unresolved(fb(`VAR a : INT; b : INT; c : BOOL; END_VAR\na := SEL(c, a, b);`))).toEqual([])
})

test("a bare-accessible enum member (non-qualified_only) is not flagged", () => {
  const src = `TYPE E : (Idle, Running); END_TYPE\nFUNCTION_BLOCK F\nVAR sv : E; END_VAR\nsv := Running;\nEND_FUNCTION_BLOCK`
  expect(unresolved(src)).toEqual([])
})

// ─── enum type-attribute semantics ({attribute 'qualified_only'} / {attribute 'strict'}) ───
// Faithful to real projects: the enum is its OWN `.dut` (a file-level pragma), consumed from another file.
// Pins how each attribute changes member resolution — the difference WITH vs WITHOUT it.

/** unresolved-identifier messages in `consumer`, with `enumDut` supplied as a second workspace file. */
const enumUse = (enumDut: string, consumer: string): string[] => {
  const files = [
    { uri: "E.dut", parseResult: parseSource(enumDut, { networkText: true }), source: enumDut },
    { uri: "F.pou", parseResult: parseSource(consumer, { networkText: true }), source: consumer },
  ]
  const project = build.buildSymbolTable(files, [], "codesys")
  return computeSemanticDiagnostics({ parseResult: files[1].parseResult, source: consumer, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "unresolved-identifier")
    .map((d) => d.message)
}
const bare = fb(`VAR sv : E; END_VAR\nsv := Running;`)
const qual = fb(`VAR sv : E; END_VAR\nsv := E.Running;`)

test("qualified_only enum: BARE member access is flagged, but QUALIFIED resolves", () => {
  const dut = `{attribute 'qualified_only'}\nTYPE E : (Idle, Running); END_TYPE`
  expect(enumUse(dut, bare)).toEqual(["Identifier 'Running' not defined"]) // bare is an error under qualified_only
  expect(enumUse(dut, qual)).toEqual([]) // E.Running is the only legal form
})

test("WITHOUT qualified_only: both bare and qualified member access resolve", () => {
  const dut = `TYPE E : (Idle, Running); END_TYPE`
  expect(enumUse(dut, bare)).toEqual([])
  expect(enumUse(dut, qual)).toEqual([])
})

// `strict` is orthogonal to `qualified_only`: it tightens int↔enum type-safety, NOT access form. So it must
// NOT block bare access, and (zero-FP policy) we don't enforce strict type-checking — both forms resolve clean.
test("strict enum (no qualified_only): both bare and qualified member access resolve", () => {
  const dut = `{attribute 'strict'}\nTYPE E : (Idle, Running); END_TYPE`
  expect(enumUse(dut, bare)).toEqual([])
  expect(enumUse(dut, qual)).toEqual([])
})

test("strict + qualified_only together: strict is inert for access; qualified_only still governs it", () => {
  const dut = `{attribute 'strict'}\n{attribute 'qualified_only'}\nTYPE E : (Idle, Running); END_TYPE`
  expect(enumUse(dut, bare)).toEqual(["Identifier 'Running' not defined"])
  expect(enumUse(dut, qual)).toEqual([])
})

// Real-project shape (enumErrorSeverity/enumErrorReaction): explicit base type `) USINT;` + members
// initialized via conversion calls, under strict+qualified_only. The typed base must not break member binding.
test("typed-base enum (`) USINT;`) still resolves its qualified members", () => {
  const dut = `{attribute 'qualified_only'}\n{attribute 'strict'}\nTYPE E : (Idle := TO_USINT(1), Running := TO_USINT(2)) USINT; END_TYPE`
  expect(enumUse(dut, qual)).toEqual([])
})

// A referenced library's namespace is bound from its manifest — one whose library materialized nothing too.
test("a referenced library's namespace resolves when its manifest is bound", () => {
  const src = fb(`VAR a : INT; END_VAR\na := PACK_ML.gConstant;`)
  const packMl: LibraryManifest = {
    uri: "App/Library Manager/PackML/PackML.library",
    folder: "PackML",
    namespace: "PACK_ML",
    library: "PackML",
    dependencies: [],
    materialization: 4,
  }
  expect(unresolved(src)).toEqual(["Identifier 'PACK_ML' not defined"]) // unknown → flagged
  expect(unresolved(src, { manifests: [packMl] })).toEqual([]) // its library's namespace → resolves
})

// A device-tree instance is bound from its `.device` descriptor (rule Y24) and resolves bare.
test("a device-tree instance resolves when its descriptor is bound", () => {
  const src = fb(`VAR a : INT; END_VAR\na := EtherCAT_Master.wState;`)
  expect(unresolved(src)).toEqual(["Identifier 'EtherCAT_Master' not defined"])
  expect(unresolved(src, { devices: [{ kind: "device", name: "EtherCAT_Master", uri: "Device/EtherCAT_Master.device" }] })).toEqual([])
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
    parseResult: parseSource(src, { networkText: true }, "twincat"),
    source: src,
    project: build.buildSymbolTable([{ uri: "F.pou", parseResult: parseSource(src, { networkText: true }, "twincat"), source: src }], [], "twincat"),
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
  const libPr = parseSource(libSrc, { networkText: true })
  const usePr = parseSource(useSrc, { networkText: true })
  const project = build.buildSymbolTable([
    { uri: "Device/Plc Logic/Application/Library Manager/MyLib/Pt.dut", parseResult: libPr, source: libSrc },
    { uri: "F.pou", parseResult: usePr, source: useSrc },
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

test("a name that does not resolve and is CALLED is two errors", () => {
  // CODESYS has no `TIME_OF_DAY_TO_UDINT` — only `TOD_TO_UDINT` — and says both that the name is undefined and that
  // it is not something you can call (conformance `cc_conv_spelled_source_ok` and its three siblings).
  const src = `FUNCTION_BLOCK F\nVAR\nt : TOD;\nu : UDINT;\nEND_VAR\nu := TIME_OF_DAY_TO_UDINT(t);\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], "codesys")
  const msgs = computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "unresolved-identifier" || d.code === "invalid-call-target")
    .map((d) => d.message)
  expect(msgs).toEqual([
    "Identifier 'TIME_OF_DAY_TO_UDINT' not defined",
    "Program name, function or function block instance expected instead of 'TIME_OF_DAY_TO_UDINT'",
  ])
})

// THE GLOBAL-NAMESPACE OPERATOR (rule E33; `expr_global_namespace_*`, both vendors 2026-10-02): `.g` looks in the global
// namespace only — a local of the same name is passed over, and a name only a local declares is "There is no global
// definition for 'loc'", as is one nothing declares, beside the conversion of the hole it leaves.
test("`.g` resolves the GLOBAL past a local, and names no global as the vendors do (expr_global_namespace_*, E33)", () => {
  const withGlobal = (body: string, vars = "") =>
    `VAR_GLOBAL\n\tgv : INT := 7;\nEND_VAR\n\nFUNCTION_BLOCK F\nVAR\n${vars}\tout : INT;\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK`
  const messages = (src: string): string[] => diag(src).filter((d) => d.severity === "error").map((d) => d.message)
  expect(messages(withGlobal("out := .gv;"))).toEqual([])
  expect(messages(withGlobal("out := .gv;", "\tgv : INT := 3;\n"))).toEqual([])
  expect(messages(withGlobal(".gv := 5;"))).toEqual([])
  expect(messages(withGlobal("out := .nope;")).sort()).toEqual(
    ["Cannot convert type 'Unknown type: '.nope'' to type 'INT'", "There is no global definition for 'nope'"])
  expect(messages(withGlobal("out := .loc;", "\tloc : INT := 3;\n")).sort()).toEqual(
    ["Cannot convert type 'Unknown type: '.loc'' to type 'INT'", "There is no global definition for 'loc'"])
})

// …and a name TWO global lists declare is no global definition through the dot either: `.gAmb` is "There is no global
// definition for 'gAmb'" and the conversion of the hole, where the bare `gAmb` is "Ambiguous use of name"
// (`expr_global_namespace_ambiguous`, `_bare`, both vendors 2026-10-02). The dot took the first list's.
test("`.g` declared by two global lists names no global (expr_global_namespace_ambiguous, E33)", () => {
  const files = [
    { uri: "file:///GVL_A.gvl", source: "VAR_GLOBAL\n\tgAmb : INT;\nEND_VAR\n" },
    { uri: "file:///GVL_B.gvl", source: "VAR_GLOBAL\n\tgAmb : INT;\nEND_VAR\n" },
    { uri: "file:///F.pou", source: "FUNCTION_BLOCK F\nVAR\n\tout : INT;\nEND_VAR\nout := .gAmb;\nEND_FUNCTION_BLOCK\n" },
  ].map((f) => ({ ...f, parseResult: parseSource(f.source, { networkText: true }) }))
  const project = build.buildSymbolTable(files)
  const fb = files[2]!
  const messages = computeSemanticDiagnostics({ parseResult: fb.parseResult, source: fb.source, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.severity === "error")
    .map((d) => d.message)
    .sort()
  expect(messages).toEqual(["Cannot convert type 'Unknown type: '.gAmb'' to type 'INT'", "There is no global definition for 'gAmb'"])
})

// frontend-conformance 3.1.3 (rule Y9): `GVL.v` names a variable of THAT list, and one it does not declare is "'nope' is no
// component of 'GVL_X'", the access then a hole ("Cannot convert type 'Unknown type: 'GVL_X.nope'' to type 'INT'") — both
// vendors, TwinCAT with the list's name in capitals (`sym_gvl_unknown_member`, `decl_non_retain_in_gvl`, 2026-10-02)
test("a member a global variable list does not declare is no component of the list, and the access has no type", () => {
  const gvl = "VAR_GLOBAL\n g_known : INT;\nEND_VAR"
  const src = fb("VAR a : INT; END_VAR\na := GVL_X.nope;\na := GVL_X.g_known;")
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable(
    [{ uri: "F.pou", parseResult, source: src }, { uri: "GVL_X.gvl", parseResult: parseSource(gvl, { networkText: true }), source: gvl }],
    [],
    "codesys",
  )
  const ds = computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
  expect(ds.filter((d) => d.severity === "error").map((d) => d.message).sort()).toEqual([
    "'nope' is no component of 'GVL_X'",
    "Cannot convert type 'Unknown type: 'GVL_X.nope'' to type 'INT'",
  ])
})

// ── frontend-conformance 3.5 (rules M1, M3): an unknown member off every base a member is read from ─────────────
/** Every error message over one source, sorted. */
const errors = (src: string, vendor: "codesys" | "twincat" = "codesys"): string[] => {
  const parseResult = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], vendor)
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.severity === "error")
    .map((d) => d.message)
    .sort()
}
const SUB = "FUNCTION_BLOCK FB_Sub\nVAR\n\tk : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nMETHOD M : INT\nM := k;\nEND_METHOD\n\n"

// `rf.nope` through a REFERENCE TO the FB is no component of the FB, as `sb.nope` is (`mem_unknown_member_through_reference`,
// both vendors 2026-10-02): the check asked the reference for members
test("M1/M3: an unknown member through a REFERENCE TO an FB is no component of the FB", () => {
  const src = `${SUB}FUNCTION_BLOCK F\nVAR\n\tsb : FB_Sub;\n\trf : REFERENCE TO FB_Sub;\n\tout : INT;\nEND_VAR\nrf REF= sb;\nout := rf.nope;\nEND_FUNCTION_BLOCK`
  expect(errors(src)).toEqual(["'nope' is no component of 'FB_Sub'", "Cannot convert type 'Unknown type: 'rf.nope'' to type 'INT'"])
})

// a CALLED unknown member is also no call target, named as written (`mem_unknown_method_of_fb_instance`, both vendors)
test("M1: an unknown METHOD called is no component, no call target, and its result a hole", () => {
  const src = `${SUB}FUNCTION_BLOCK F\nVAR\n\tsb : FB_Sub;\n\tout : INT;\nEND_VAR\nout := sb.Nope();\nEND_FUNCTION_BLOCK`
  expect(errors(src)).toEqual([
    "'Nope' is no component of 'FB_Sub'",
    "Cannot convert type 'Unknown type: 'sb.Nope()'' to type 'INT'",
    "Program name, function or function block instance expected instead of 'sb.Nope'",
  ])
})

// an INTERFACE's members are no component of `<ITF>__Union`, the vendor's name for the interface's member set
// (`mem_unknown_method_of_interface`: CODESYS keeps the case, TwinCAT upper-cases it, 2026-10-02)
test("M1: an unknown METHOD of an INTERFACE is no component of '<interface>__Union'", () => {
  const src = "INTERFACE I_T\nMETHOD M : INT\nEND_METHOD\nEND_INTERFACE\n\nFUNCTION_BLOCK F\nVAR\n\ti : I_T;\n\tout : INT;\nEND_VAR\nout := i.Nope();\nEND_FUNCTION_BLOCK"
  const expected = (u: string) => [
    `'Nope' is no component of '${u}'`,
    "Cannot convert type 'Unknown type: 'i.Nope()'' to type 'INT'",
    "Program name, function or function block instance expected instead of 'i.Nope'",
  ]
  expect(errors(src)).toEqual(expected("I_T__Union"))
  expect(errors(src, "twincat")).toEqual(expected("I_T__UNION"))
})

// a POINTER read without its `^` has no members (`mem_pointer_member_without_deref`, both vendors 2026-10-02)
test("M3: a member read off a POINTER without `^` — the pointer is no structured variable", () => {
  const src = `${SUB}FUNCTION_BLOCK F\nVAR\n\tsb : FB_Sub;\n\tp : POINTER TO FB_Sub;\n\tout : INT;\nEND_VAR\np := ADR(sb);\nout := p.k;\nout := p^.k;\nEND_FUNCTION_BLOCK`
  expect(errors(src)).toEqual(["'p' is no structured variable", "Cannot convert type 'Unknown type: 'p.k'' to type 'INT'"])
})

// a pointer that is itself a MEMBER (`h.p.x`) is said once, as the bare `p.k` is — `unknown-source`'s sentence for a
// non-name base that is a hole is the same words on the same span (step 3 review, 2026-10-03)
test("M3: a member read off a POINTER that is a member — the pointer is said to be no structured variable ONCE", () => {
  const src = "TYPE S :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n\nTYPE H :\nSTRUCT\n\tp : POINTER TO S;\nEND_STRUCT\nEND_TYPE\n\nPROGRAM P\nVAR\n\th : H;\n\tout : INT;\nEND_VAR\nout := h.p.x;\nEND_PROGRAM"
  expect(errors(src).filter((m) => m === "'h.p' is no structured variable")).toHaveLength(1)
})

// a VAR written from outside through a REFERENCE TO the FB is no input of it, as `sb.k := 5` is
// (`mem_reference_to_fb_member_write`, both vendors 2026-10-02); its VAR_INPUT is written (`mem_reference_to_fb_input_write`)
test("M3: a VAR written through a REFERENCE TO an FB is no input of the FB; a VAR_INPUT is written", () => {
  const sub = "FUNCTION_BLOCK FB_Sub\nVAR_INPUT\n\tkin : INT;\nEND_VAR\nVAR\n\tk : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n"
  const src = `${sub}FUNCTION_BLOCK F\nVAR\n\tsb : FB_Sub;\n\trf : REFERENCE TO FB_Sub;\nEND_VAR\nrf REF= sb;\nrf.k := 5;\nrf.kin := 5;\nEND_FUNCTION_BLOCK`
  expect(errors(src)).toEqual(["'k' is no input of 'FB_Sub'"])
})

// The called-member C0035 answers only the recorded bases — an FB instance and an interface named as a variable
// (`mem_unknown_method_of_fb_instance`, `mem_unknown_method_of_interface`). A global list's unknown member called and a
// dereferenced pointer's are unasked: no recording says the vendor adds the call-target sentence there (step 3 review,
// 2026-10-03), so the LSP does not.
test("M1: a called unknown member of a GLOBAL LIST or through a dereferenced POINTER gets no call-target sentence", () => {
  const gvl = "VAR_GLOBAL\n g : INT;\nEND_VAR"
  const src = `${SUB}FUNCTION_BLOCK F\nVAR\n\tsb : FB_Sub;\n\tp : POINTER TO FB_Sub;\n\tout : INT;\nEND_VAR\np := ADR(sb);\nout := GVL_X.nope();\nout := p^.Nope();\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable(
    [{ uri: "F.pou", parseResult, source: src }, { uri: "GVL_X.gvl", parseResult: parseSource(gvl, { networkText: true }), source: gvl }],
    [],
    "codesys",
  )
  const ds = computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
  expect(ds.map((d) => d.message).filter((m) => m.startsWith("Program name, function or function block instance expected"))).toEqual([])
})

test("an unknown member of an ANY / ANY_* input is unmeasured and stays silent — the vendor's struct is __SYSTEM.AnyType, whose name in that sentence nothing has recorded (step 4a review)", () => {
  const src = "FUNCTION F : DINT\nVAR_INPUT\n\tx : ANY_NUM;\nEND_VAR\nVAR\n\ti : INT;\nEND_VAR\ni := x.nope;\nF := x.diSize;\nEND_FUNCTION"
  expect(diag(src).map((d) => `${d.code}: ${d.message}`)).toEqual([])
})

// A member a declaration's NAME does not have (a STRUCT type, an INTERFACE, a PROGRAM; THIS^'s FB): the base became a
// `StaticType` / an upper-cased POU in rule DT8 (task 4.7.4), and the review found the member check silent for the first
// two and naming the last two upper-cased. Only the "Cannot convert" store was measured upper-cased (`dt_this_type`,
// `dt_static_base_*`); a member-not-found message keeps the declared case, as before DT8.
test("a member a type's, a program's or THIS^'s name does not declare is no component, named as declared", () => {
  const src = `TYPE Dut_s :\nSTRUCT\nx : INT;\nEND_STRUCT\nEND_TYPE
INTERFACE I_x\nMETHOD M : INT\nEND_METHOD\nEND_INTERFACE
PROGRAM Prg_x\nVAR\nx : INT;\nEND_VAR\nEND_PROGRAM
FUNCTION_BLOCK Fb_a\nVAR\nn : INT;\nEND_VAR\nn := Dut_s.nope;\nn := I_x.nope;\nn := Prg_x.nope;\nn := THIS^.nope;\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
  const ds = computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
  expect(ds.filter((d) => d.code === "unknown-member").map((d) => d.message)).toEqual([
    "'nope' is no component of 'Dut_s'",
    "'nope' is no component of 'I_x'",
    "'nope' is no component of 'Prg_x'",
    "'nope' is no component of 'Fb_a'",
  ])
  expect(ds.filter((d) => d.code === "unknown-source").map((d) => d.message)).toEqual([
    "Cannot convert type 'Unknown type: 'Dut_s.nope'' to type 'INT'",
    "Cannot convert type 'Unknown type: 'I_x.nope'' to type 'INT'",
    "Cannot convert type 'Unknown type: 'Prg_x.nope'' to type 'INT'",
    "Cannot convert type 'Unknown type: 'THIS^.nope'' to type 'INT'",
  ])
})
