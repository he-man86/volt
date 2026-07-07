/**
 * NAMESPACE — parser + binder. Was 0% covered (namespace.ts) / `ingestNamespace` untested. Pins the parse
 * shape, the namespace scope tree, the project-level symbol, and qualified `NS.Element` navigation.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../index.js"
import { buildSymbolTable, findChildScope, findScopeByName, lookupLocal } from "../../symbols/index.js"

const NS = `NAMESPACE NS
FUNCTION_BLOCK Foo
VAR x : INT; END_VAR
END_FUNCTION_BLOCK
TYPE E : (A, B); END_TYPE
END_NAMESPACE`

test("a NAMESPACE parses with zero errors, holding its inner units", () => {
  const pr = parseSource(NS)
  expect(pr.errors).toEqual([])
  expect(pr.units).toHaveLength(1)
  const ns = pr.units[0]
  expect(ns.kind).toBe("namespace")
  if (ns.kind === "namespace") {
    expect(ns.name.text).toBe("NS")
    expect(ns.units.map((u) => u.kind)).toEqual(["function_block", "type_decl"])
  }
})

test("the binder makes a namespace scope + a project-level namespace symbol; qualified nav resolves", () => {
  const project = buildSymbolTable([{ uri: "NS.fb", parseResult: parseSource(NS), source: NS }])
  expect(lookupLocal(project, "NS").map((s) => s.kind)).toEqual(["namespace"])
  const ns = findScopeByName(project, "NS")
  expect(ns?.kind).toBe("namespace")
  expect(ns?.children.map((c) => `${c.kind}:${c.name}`).sort()).toEqual(["enum:E", "pou:Foo"])
  expect(findChildScope(ns!, "Foo")?.name).toBe("Foo") // NS.Foo navigates
})

test("nested namespaces bind their full scope chain", () => {
  const src = `NAMESPACE Outer\nNAMESPACE Inner\nFUNCTION_BLOCK Deep\nEND_FUNCTION_BLOCK\nEND_NAMESPACE\nEND_NAMESPACE`
  const project = buildSymbolTable([{ uri: "X.fb", parseResult: parseSource(src), source: src }])
  const outer = findScopeByName(project, "Outer")
  const inner = outer && findChildScope(outer, "Inner")
  expect(inner?.kind).toBe("namespace")
  expect(inner && findChildScope(inner, "Deep")?.name).toBe("Deep")
})
