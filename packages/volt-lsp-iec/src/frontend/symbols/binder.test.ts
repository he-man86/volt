/**
 * THE BINDER — the AST as a scope tree: POU symbols and member scopes, lookup and EXTENDS, enums and GVLs under
 * `qualified_only`, and NAMESPACE (the namespace scope tree, the project-level namespace symbol and qualified
 * `NS.Element` navigation — `ingestNamespace`; its parse shape is `syntax/parse/units/namespace.test.ts`).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../syntax/index.js"
import type { SymbolTableInput } from "./binder.js"
import type { Scope } from "./model.js"
import { bareEnumMember, findChildScope, findScopeByName, lookup, lookupMember, resolveBareEnumMember } from "./scope-nav.js"
import { isLibrarySymbol, lookupLocal } from "./scope.js"
import { buildSymbolTable } from "./incremental.js"

function build(...files: { uri: string; src: string }[]): Scope {
  return buildSymbolTable(
    files.map((f) => ({ uri: f.uri, parseResult: parseSource(f.src, { networkText: true }), source: f.src }) satisfies SymbolTableInput),
  )
}

test("binder builds the scope tree: POU symbol + child scope + members", () => {
  const project = build({
    uri: "FB_X.pou",
    src: `FUNCTION_BLOCK FB_X
VAR
  count : INT;
END_VAR
END_FUNCTION_BLOCK
METHOD Step : BOOL
VAR_INPUT
  arg : INT;
END_VAR
END_METHOD`,
  })
  expect(lookupLocal(project, "FB_X")[0]?.kind).toBe("function_block")
  const fb = findChildScope(project, "FB_X")!
  expect(fb.kind).toBe("pou")
  expect(lookupLocal(fb, "count")[0]?.kind).toBe("var")
  // The standalone METHOD after END_FUNCTION_BLOCK parents to the FB.
  expect(lookupLocal(fb, "Step")[0]?.kind).toBe("method")
  const method = findChildScope(fb, "Step")!
  expect(lookupLocal(method, "arg")[0]?.kind).toBe("method_param")
})

test("lookup: innermost shadow wins, then walks outward", () => {
  const project = build({
    uri: "P.pou",
    src: `PROGRAM P
VAR
  x : INT;
END_VAR
END_PROGRAM`,
  })
  const p = findChildScope(project, "P")!
  expect(lookup(p, "x")?.symbol.kind).toBe("var")
  expect(lookup(p, "P")?.symbol.kind).toBe("program") // resolved by walking out to project
  expect(lookup(p, "nope")).toBeUndefined()
})

test("linkExtends: inherited members resolve through the base chain", () => {
  const project = build(
    { uri: "Base.pou", src: `FUNCTION_BLOCK Base\nVAR\n baseVar : INT;\nEND_VAR\nEND_FUNCTION_BLOCK` },
    { uri: "Derived.pou", src: `FUNCTION_BLOCK Derived EXTENDS Base\nVAR\n own : INT;\nEND_VAR\nEND_FUNCTION_BLOCK` },
  )
  const derived = findChildScope(project, "Derived")!
  expect(derived.baseScope?.name).toBe("Base")
  // baseVar is not local to Derived — only reachable through EXTENDS.
  expect(lookupLocal(derived, "baseVar")).toHaveLength(0)
  expect(lookupMember(derived, "baseVar")?.kind).toBe("var")
  expect(lookup(derived, "baseVar")?.symbol.kind).toBe("var")
})

test("enum members: bare-accessible unless qualified_only", () => {
  const open = build({ uri: "Color.dut", src: `TYPE Color : (Red, Green, Blue); END_TYPE` })
  expect(bareEnumMember(open, "Green")?.kind).toBe("enum_value")

  const qualified = build({
    uri: "Mode.dut",
    src: `{attribute 'qualified_only'}\nTYPE Mode : (Auto, Manual); END_TYPE`,
  })
  expect(findChildScope(qualified, "Mode")?.qualifiedOnly).toBe(true)
  expect(resolveBareEnumMember(qualified, "Auto")).toBeUndefined() // only Mode.Auto resolves
})

// Rule EN3 (frontend-conformance 3.3, `enum_same_member_two_enums`): two open enums declaring a member make it ambiguous
test("enum members: one two open enums declare is ambiguous — no member is picked", () => {
  const two = build({ uri: "E.dut", src: `TYPE E_A : (Red, Green); END_TYPE
TYPE E_B : (Red, Blue); END_TYPE` })
  const red = resolveBareEnumMember(two, "red")
  expect(red?.kind === "ambiguous" ? red.candidates.map((c) => c.owner.name) : red?.kind).toEqual(["E_A", "E_B"])
  expect(bareEnumMember(two, "red")).toBeUndefined()
  expect(resolveBareEnumMember(two, "Blue")?.kind).toBe("member")
})

test("GVL vars are gvl_var symbols on the project; qualified_only is flagged", () => {
  const project = build({
    uri: "GVL_Const.gvl",
    src: `{attribute 'qualified_only'}\nVAR_GLOBAL CONSTANT\n MaxItems : INT := 10;\nEND_VAR`,
  })
  expect(lookupLocal(project, "GVL_Const")[0]?.kind).toBe("gvl_block")
  const v = lookupLocal(project, "MaxItems")[0]
  expect(v?.kind).toBe("gvl_var")
  expect(v?.qualifiedOnly).toBe(true)
})

test("qualified_only GVL members are not bare-accessible and never shadow a same-named GVL block", () => {
  // The lenze `Mach1` collision: a qualified_only GVL `HMI` has a member `Mach1 : sUDT`, and a GVL block
  // is also named `Mach1`. Bare `Mach1` must resolve to the block (so `Mach1.Field` works), never to the
  // qualified-only member (which is reachable ONLY as `HMI.Mach1`) — else 197 spurious unknown-member FPs.
  const project = build(
    { uri: "Mach1.gvl", src: `{attribute 'qualified_only'}\nVAR_GLOBAL\n Flags : BOOL;\nEND_VAR` },
    { uri: "HMI.gvl", src: `{attribute 'qualified_only'}\nVAR_GLOBAL\n Mach1 : BOOL;\nEND_VAR` },
  )
  expect(lookup(project, "Mach1")?.symbol.kind).toBe("gvl_block") // bare → the block, not HMI's member
  // the qualified-only member is still present for `HMI.Mach1` resolution (just not bare-reachable)
  expect(lookupLocal(project, "Mach1").some((s) => s.kind === "gvl_var" && s.qualifiedOnly === true)).toBe(true)
})

test("a commented-out qualified_only attribute is ignored — members stay bare-accessible", () => {
  // lenze `LST_General.gvl` header is `//{attribute 'qualified_only'}` — commented, so bare `FF100ms` is valid.
  const project = build({
    uri: "LST_General.gvl",
    src: `//{attribute 'qualified_only'}\nVAR_GLOBAL\n FF100ms : BOOL;\nEND_VAR`,
  })
  expect(lookupLocal(project, "FF100ms")[0]?.qualifiedOnly).toBeUndefined() // NOT flagged qualified_only
  expect(lookup(project, "FF100ms")?.symbol.kind).toBe("gvl_var") // bare-reachable
})

test("implicit enumeration introduces bare value constants into the enclosing scope", () => {
  const project = build({
    uri: "F.pou",
    src: `FUNCTION_BLOCK F\nVAR\n state : (Idle, Running, Halted);\nEND_VAR\nEND_FUNCTION_BLOCK`,
  })
  const fb = findChildScope(project, "F")!
  expect(lookupLocal(fb, "state")[0]?.kind).toBe("var")
  expect(lookup(fb, "Running")?.symbol.kind).toBe("enum_value")
})

test("an ARRAY OF an implicit enumeration introduces its values too", () => {
  // `decl_implicit_enum_in_array` (`a : ARRAY[0..1] OF (ia_a, ia_b); a[1] := ia_b;`) builds and runs on both vendors
  const project = build({
    uri: "F.pou",
    src: `FUNCTION_BLOCK F
VAR
 a : ARRAY[0..1] OF ARRAY[0..1] OF (ia_a, ia_b);
END_VAR
END_FUNCTION_BLOCK`,
  })
  expect(lookup(findChildScope(project, "F")!, "ia_b")?.symbol.kind).toBe("enum_value")
})

const NS = `NAMESPACE NS
FUNCTION_BLOCK Foo
VAR x : INT; END_VAR
END_FUNCTION_BLOCK
TYPE E : (A, B); END_TYPE
END_NAMESPACE`

test("the binder makes a namespace scope + a project-level namespace symbol; qualified nav resolves", () => {
  const project = buildSymbolTable([{ uri: "NS.pou", parseResult: parseSource(NS, { networkText: true }), source: NS }])
  expect(lookupLocal(project, "NS").map((s) => s.kind)).toEqual(["namespace"])
  const ns = findScopeByName(project, "NS")
  expect(ns?.kind).toBe("namespace")
  expect(ns?.children.map((c) => `${c.kind}:${c.name}`).sort()).toEqual(["enum:E", "pou:Foo"])
  expect(findChildScope(ns!, "Foo")?.name).toBe("Foo") // NS.Foo navigates
})

test("nested namespaces bind their full scope chain", () => {
  const src = `NAMESPACE Outer\nNAMESPACE Inner\nFUNCTION_BLOCK Deep\nEND_FUNCTION_BLOCK\nEND_NAMESPACE\nEND_NAMESPACE`
  const project = buildSymbolTable([{ uri: "X.pou", parseResult: parseSource(src, { networkText: true }), source: src }])
  const outer = findScopeByName(project, "Outer")
  const inner = outer && findChildScope(outer, "Inner")
  expect(inner?.kind).toBe("namespace")
  expect(inner && findChildScope(inner, "Deep")?.name).toBe("Deep")
})

// Rule Y18 (frontend-conformance 3.1.2): a METHOD/ACTION/PROPERTY after an FB INSIDE a namespace block is that FB's, as
// one after an FB at file level is — the namespace ingest tracks the member host the same way `bindFile` does. No vendor
// holds a namespace block (the push refuses it, `sym_namespace_method_parents_to_fb`); this is the LSP's reading of a
// workspace text that has one.
test("a METHOD, ACTION and PROPERTY after an FB inside a NAMESPACE parent to that FB (Y18)", () => {
  const src = `NAMESPACE NS
FUNCTION_BLOCK Foo
VAR f : INT; END_VAR
END_FUNCTION_BLOCK
METHOD M : INT
M := f;
END_METHOD
ACTION A
f := 1;
END_ACTION
PROPERTY P : INT
GET
P := f;
END_GET
END_PROPERTY
FUNCTION Fn : INT
END_FUNCTION
METHOD Orphan
END_METHOD
END_NAMESPACE`
  const project = build({ uri: "NS.pou", src })
  const foo = findChildScope(findScopeByName(project, "NS")!, "Foo")!
  expect(["M", "A", "P"].map((n) => lookupLocal(foo, n)[0]?.kind)).toEqual(["method", "action", "property"])
  const m = findChildScope(foo, "M")!
  expect(m.parent).toBe(foo)
  expect(lookup(m, "f")?.foundIn).toBe(foo) // the method body reaches the FB's field
  // a FUNCTION ends the host, as at file level: a METHOD after it parents to nobody (the namespace)
  expect(lookupLocal(foo, "Orphan")).toEqual([])
})

// `isLibrarySymbol` is the path rule (`library/path.ts` `isLibraryUri`) asked of a symbol's uri — the guard that keeps
// every check off a referenced library's lossy signatures.
test("isLibrarySymbol is the library path rule asked of the symbol's uri", () => {
  expect(isLibrarySymbol({ uri: "file:///C:/proj/src/Application/Library%20Manager/Util/X.pou" })).toBe(true)
  expect(isLibrarySymbol({ uri: "file:///C:/proj/src/Main.pou" })).toBe(false)
})

test("an FB whose header the vendor refuses is declared nowhere; a bodiless TYPE is declared, with no members", () => {
  // `unit_fb_final_public_order`: an access modifier after FINAL leaves no FB on either vendor ("Unknown type" where it
  // is used); `unit_type_no_body`: a TYPE with a refused body is no unknown type where it is used
  const project = build(
    { uri: "A.pou", src: "FUNCTION_BLOCK FINAL PUBLIC FB_A\nVAR\n\tn : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n" },
    { uri: "T.dut", src: "TYPE T_X :\nEND_TYPE\n" },
  )
  expect(lookupLocal(project, "FB_A")).toEqual([])
  expect(lookupLocal(project, "T_X").map((s) => s.kind)).toEqual(["type"])
})

// ── rules H4/H5: interfaces (`fixtures/names/inheritance.ts`, both vendors 2026-10-02) ─────────────────────────────
test("H4: an INTERFACE's EXTENDS list is linked — each base's member reaches through the derived interface", () => {
  const p = build({
    uri: "I.itf",
    src: `INTERFACE I_A\nMETHOD Ma : INT\nEND_METHOD\nEND_INTERFACE\n\nINTERFACE I_B\nMETHOD Mb : INT\nEND_METHOD\nEND_INTERFACE\n\nINTERFACE I_D EXTENDS I_A, I_B\nEND_INTERFACE\n`,
  })
  const d = findChildScope(p, "I_D")!
  expect(d.interfaceBases?.map((b) => b.name)).toEqual(["I_A", "I_B"])
  expect(lookupMember(d, "Mb")?.kind).toBe("interface_method")
  expect(lookupMember(d, "Ma")?.owner.name).toBe("I_A")
})
test("H5: an interface METHOD's parameters are bound in a scope of the method", () => {
  const p = build({ uri: "I.itf", src: `INTERFACE I\nMETHOD M : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nEND_METHOD\nEND_INTERFACE\n` })
  const m = findChildScope(findChildScope(p, "I")!, "M")!
  expect(m.kind).toBe("method")
  expect(lookupLocal(m, "a")[0]?.kind).toBe("method_param")
})
