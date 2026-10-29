/**
 * The scope of a plain-ST network body (`network-scope.ts`): the body's wires declared over its unit's scope, each with
 * its definition, marked as a network's — one symbol per wire for every walk.
 */
import { expect, test } from "bun:test"
import { parseSource } from "../syntax/index.js"
import { bodies, build, lookupLocal, sourceBodies } from "./index.js"

const SRC = `PROGRAM P
VAR
\ta, b, x, y : BOOL;
\tt1 : TON;
END_VAR
%LANGUAGE LD
%NETWORK
VAR_TEMP w1 : ANY; w2 : ANY; END_VAR
w1 := a AND b;
x := w1;
y := w1;
t1(IN := w1, Q => w2);
x := w2;
END_PROGRAM
`

const scopeOf = () => {
  const parseResult = parseSource(SRC, { networkText: true }, "codesys")
  const project = build.buildSymbolTable([{ uri: "P.pou", parseResult, source: SRC }], [], "codesys")
  return { parseResult, project }
}

test("a network body's scope holds its wires over the unit's, each with its definition", () => {
  const { parseResult, project } = scopeOf()
  const [b] = [...bodies(parseResult.units, project)]
  expect(b!.scope.network).toBe(true)
  const w1 = lookupLocal(b!.scope, "w1")[0]!
  const w2 = lookupLocal(b!.scope, "W2")[0]!
  expect([w1.kind, w1.varSection, w1.wire?.kind]).toEqual(["var", "VAR_TEMP", "value"])
  expect(w2.wire?.kind === "output" ? w2.wire.param : undefined).toBe("Q")
  expect(lookupLocal(b!.scope, "a")).toEqual([])
  expect(b!.scope.parent?.name).toBe("P")
})

test("one wire is one symbol for every walk of the same parse", () => {
  const { parseResult, project } = scopeOf()
  const first = [...bodies(parseResult.units, project)][0]!.scope
  const again = [...sourceBodies(parseResult.units, project)][0]!.scope
  expect(lookupLocal(first, "w1")[0]).toBe(lookupLocal(again, "w1")[0])
})
