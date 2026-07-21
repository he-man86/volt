import { test, expect } from "bun:test"
import { parseSource } from "../syntax/index.js"
import { buildSymbolTable, type SymbolTableInput } from "./binder.js"
import { findChildScope, lookup, lookupMember, resolveBareEnumMember } from "./scope-nav.js"
import { lookupLocal, type Scope } from "./symbol.js"

function build(...files: { uri: string; src: string }[]): Scope {
  return buildSymbolTable(
    files.map((f) => ({ uri: f.uri, parseResult: parseSource(f.src), source: f.src }) satisfies SymbolTableInput),
  )
}

test("binder builds the scope tree: POU symbol + child scope + members", () => {
  const project = build({
    uri: "FB_X.fb",
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
    uri: "P.prg",
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
    { uri: "Base.fb", src: `FUNCTION_BLOCK Base\nVAR\n baseVar : INT;\nEND_VAR\nEND_FUNCTION_BLOCK` },
    { uri: "Derived.fb", src: `FUNCTION_BLOCK Derived EXTENDS Base\nVAR\n own : INT;\nEND_VAR\nEND_FUNCTION_BLOCK` },
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
  expect(resolveBareEnumMember(open, "Green")?.kind).toBe("enum_value")

  const qualified = build({
    uri: "Mode.dut",
    src: `{attribute 'qualified_only'}\nTYPE Mode : (Auto, Manual); END_TYPE`,
  })
  expect(findChildScope(qualified, "Mode")?.qualifiedOnly).toBe(true)
  expect(resolveBareEnumMember(qualified, "Auto")).toBeUndefined() // only Mode.Auto resolves
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
    uri: "F.fb",
    src: `FUNCTION_BLOCK F\nVAR\n state : (Idle, Running, Halted);\nEND_VAR\nEND_FUNCTION_BLOCK`,
  })
  const fb = findChildScope(project, "F")!
  expect(lookupLocal(fb, "state")[0]?.kind).toBe("var")
  expect(lookup(fb, "Running")?.symbol.kind).toBe("enum_value")
})
