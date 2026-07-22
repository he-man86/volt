/**
 * Incremental-rebind scope integrity — the `scopeForUnit` span-index must be invalidated on every
 * `bindFile`/`unbindFile`, else a rebound file's fresh spans miss the cached index and `scopeForUnit`
 * name-walks into a SAME-NAMED sibling POU's member scope (cross-unit contamination).
 *
 * Live-found (awa-palletizer): dozens of hardware-unit FBs each `EXTENDS` a common base with identical
 * method names (`Cyclic`, `Reset`, …). On `didOpen` the opened FB's methods resolved against another unit's
 * scope, so every own member reported C0046 "not defined" + `.member` accesses cited the wrong unit's type.
 */
import { test, expect } from "bun:test"
import { parseSource, type FunctionBlock } from "../syntax/index.js"
import { buildSymbolTable, bindFile, unbindFile, linkExtends, scopeForUnit } from "./index.js"

// Two sibling FBs, each with a method named `Cyclic` touching its OWN member. Same shape, different members.
const A = `FUNCTION_BLOCK UnitA\nVAR aOwn : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Cyclic\naOwn := 1;\nEND_METHOD`
const B = `FUNCTION_BLOCK UnitB\nVAR bOwn : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Cyclic\nbOwn := 1;\nEND_METHOD`

/** The `Cyclic` method unit of a parsed file (the top-level unit after the FB). */
const cyclicUnit = (pr: ReturnType<typeof parseSource>) => pr.units.find((u) => u.kind === "method")!

test("a rebound file's method still resolves to its OWN FB, not a same-named sibling's", () => {
  const prA = parseSource(A)
  const project = buildSymbolTable([
    { uri: "A.fb", parseResult: prA, source: A },
    { uri: "B.fb", parseResult: parseSource(B), source: B },
  ])

  // Prime the span index (what any diagnostic pass does before the first edit).
  expect(scopeForUnit(project, cyclicUnit(prA))!.parent!.name).toBe("UnitA")

  // Simulate didOpen on A: unbind its disk contribution, bind a freshly-parsed buffer (new span objects).
  // The rebind appends A's scopes AFTER B's, so a stale-index name-walk would grab UnitB's `Cyclic`.
  const prA2 = parseSource(A)
  unbindFile(project, "A.fb")
  bindFile(project, { uri: "A.fb", parseResult: prA2, source: A })
  linkExtends(project)

  const scope = scopeForUnit(project, cyclicUnit(prA2))
  expect(scope!.parent!.name).toBe("UnitA") // NOT "UnitB" — the bug bound it to the sibling
})

test("sanity: the two FBs really do share the method name (so the guard is load-bearing)", () => {
  expect((parseSource(A).units[0] as FunctionBlock).name.text).toBe("UnitA")
  expect(cyclicUnit(parseSource(A)).kind).toBe("method")
  expect(cyclicUnit(parseSource(B)).kind).toBe("method")
})
