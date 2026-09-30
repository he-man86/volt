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
import { scopeForUnit } from "./index.js"
import { bindFile, buildSymbolTable, relink, unbindFile } from "./incremental.js"

// Two sibling FBs, each with a method named `Cyclic` touching its OWN member. Same shape, different members.
const A = `FUNCTION_BLOCK UnitA\nVAR aOwn : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Cyclic\naOwn := 1;\nEND_METHOD`
const B = `FUNCTION_BLOCK UnitB\nVAR bOwn : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Cyclic\nbOwn := 1;\nEND_METHOD`

/** The `Cyclic` method unit of a parsed file (the top-level unit after the FB). */
const cyclicUnit = (pr: ReturnType<typeof parseSource>) => pr.units.find((u) => u.kind === "method")!

test("a rebound file's method still resolves to its OWN FB, not a same-named sibling's", () => {
  const prB = parseSource(B, { networkText: true })
  const project = buildSymbolTable([
    { uri: "A.fb", parseResult: parseSource(A, { networkText: true }), source: A },
    { uri: "B.fb", parseResult: prB, source: B },
  ])

  // Prime the span index (what any diagnostic pass does before the first edit).
  expect(scopeForUnit(project, cyclicUnit(prB))!.parent!.name).toBe("UnitB")

  // Simulate didOpen on B as the server does it: unbind its disk contribution, bind a freshly-parsed buffer (new span
  // objects), relink (canonicalize + linkExtends). B is rebound because canonical order puts A.fb FIRST: a stale-index
  // name-walk for the fresh `Cyclic` would grab UnitA's.
  const prB2 = parseSource(B, { networkText: true })
  unbindFile(project, "B.fb")
  bindFile(project, { uri: "B.fb", parseResult: prB2, source: B })
  relink(project)

  const scope = scopeForUnit(project, cyclicUnit(prB2))
  expect(scope!.parent!.name).toBe("UnitB") // NOT "UnitA" — the bug bound it to the sibling
})

test("sanity: the two FBs really do share the method name (so the guard is load-bearing)", () => {
  expect((parseSource(A, { networkText: true }).units[0] as FunctionBlock).name.text).toBe("UnitA")
  expect(cyclicUnit(parseSource(A, { networkText: true })).kind).toBe("method")
  expect(cyclicUnit(parseSource(B, { networkText: true })).kind).toBe("method")
})
