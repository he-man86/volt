/**
 * `findScopeByName` answers from a name index built once per project generation (it was a full tree walk per call —
 * 3.2 s of pro2193's diagnostic pass, ~130 ms of every keystroke). The index must give EXACTLY the walk's answer — the
 * first match in depth-first pre-order — and must not survive a change to the tree.
 */
import { expect, test } from "bun:test"
import { parseSource } from "../syntax/index.js"
import type { Scope } from "./model.js"
import { findScopeByName, scopeForUnit } from "./index.js"
import { bindFile, buildSymbolTable, relink, unbindFile } from "./incremental.js"

const file = (uri: string, source: string) => ({ uri, source, parseResult: parseSource(source, { networkText: true }) })

/** The pre-index implementation, kept here as the oracle. */
function walk(scope: Scope, name: string): Scope | undefined {
  for (const child of scope.children) {
    if (child.name.toLowerCase() === name.toLowerCase()) return child
    const inner = walk(child, name)
    if (inner !== undefined) return inner
  }
  return undefined
}

const FB_A = "FUNCTION_BLOCK FB_A\nVAR x : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Run\nx := 1;\nEND_METHOD"
const FB_B = "FUNCTION_BLOCK FB_B\nVAR y : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Run\ny := 1;\nEND_METHOD"
const RUN = "FUNCTION_BLOCK Run\nEND_FUNCTION_BLOCK"
const ITF = "INTERFACE I_Thing\nMETHOD Go : BOOL\nEND_METHOD\nEND_INTERFACE"

test("the index answers exactly what a depth-first walk answers, including a nested name that shadows a later top-level one", () => {
  const project = buildSymbolTable([file("a.fb", FB_A), file("b.fb", FB_B), file("run.fb", RUN), file("i.itf", ITF)])
  for (const name of ["FB_A", "fb_b", "RUN", "Run", "I_Thing", "Go", "nothing"]) expect(findScopeByName(project, name)).toBe(walk(project, name))
  // `Run` is FB_A's method before it is the top-level FB in pre-order — the index must not prefer the top level
  expect(findScopeByName(project, "Run")?.parent?.name).toBe("FB_A")
})

test("a bound file is found, and an unbound one is gone — the index never outlives the tree it was built from", () => {
  const project = buildSymbolTable([file("a.fb", FB_A)])
  expect(findScopeByName(project, "FB_B")).toBeUndefined()

  bindFile(project, file("b.fb", FB_B))
  relink(project)
  expect(findScopeByName(project, "FB_B")?.name).toBe("FB_B")

  unbindFile(project, "a.fb")
  relink(project)
  expect(findScopeByName(project, "FB_A")).toBeUndefined()
  expect(findScopeByName(project, "Run")?.parent?.name).toBe("FB_B")
})

test("a scope that is not a project root is still searched within its own subtree", () => {
  const project = buildSymbolTable([file("a.fb", FB_A), file("b.fb", FB_B)])
  const fbB = findScopeByName(project, "FB_B")!
  expect(findScopeByName(fbB, "Run")?.parent).toBe(fbB)
  expect(findScopeByName(fbB, "FB_A")).toBeUndefined()
})

// A GVL and an alias DUT own no scope (the binder defines their symbols on the project), so no span entry exists for
// them. `scopeForUnit` fell back to a NAME search for the alias and answered with whatever scope shared its name — here a
// method; a GVL carries no name, and must stay without a scope too.
test("a unit that owns no scope has none — a GVL or an alias is never answered with a same-named scope", () => {
  const gvl = file("Run.gvl", "VAR_GLOBAL\ng : INT;\nEND_VAR")
  const alias = file("Run.dut", "TYPE Run : INT; END_TYPE")
  const project = buildSymbolTable([file("a.fb", FB_A), gvl, alias])
  expect(findScopeByName(project, "Run")?.kind).toBe("method")
  const units = [...gvl.parseResult.units, ...alias.parseResult.units]
  expect(units.map((u) => u.kind)).toEqual(["global_var_list", "type_decl"])
  for (const unit of units) expect(scopeForUnit(project, unit)).toBeUndefined()
})
