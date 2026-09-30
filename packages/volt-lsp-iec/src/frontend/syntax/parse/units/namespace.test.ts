/**
 * NAMESPACE — the parse shape. The binder's half (the namespace scope tree, the project-level symbol, qualified
 * `NS.Element` navigation) is `symbols/binder.test.ts`.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../index.js"

const NS = `NAMESPACE NS
FUNCTION_BLOCK Foo
VAR x : INT; END_VAR
END_FUNCTION_BLOCK
TYPE E : (A, B); END_TYPE
END_NAMESPACE`

test("a NAMESPACE parses with zero errors, holding its inner units", () => {
  const pr = parseSource(NS, { networkText: true })
  expect(pr.errors).toEqual([])
  expect(pr.units).toHaveLength(1)
  const ns = pr.units[0]
  expect(ns.kind).toBe("namespace")
  if (ns.kind === "namespace") {
    expect(ns.name.text).toBe("NS")
    expect(ns.units.map((u) => u.kind)).toEqual(["function_block", "type_decl"])
  }
})
