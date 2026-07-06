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
  const open = build({ uri: "Color.enum", src: `TYPE Color : (Red, Green, Blue); END_TYPE` })
  expect(resolveBareEnumMember(open, "Green")?.kind).toBe("enum_value")

  const qualified = build({
    uri: "Mode.enum",
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

test("implicit enumeration introduces bare value constants into the enclosing scope", () => {
  const project = build({
    uri: "F.fb",
    src: `FUNCTION_BLOCK F\nVAR\n state : (Idle, Running, Halted);\nEND_VAR\nEND_FUNCTION_BLOCK`,
  })
  const fb = findChildScope(project, "F")!
  expect(lookupLocal(fb, "state")[0]?.kind).toBe("var")
  expect(lookup(fb, "Running")?.symbol.kind).toBe("enum_value")
})
