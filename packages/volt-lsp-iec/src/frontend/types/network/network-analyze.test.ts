/**
 * `analyzeNetworkText`: each network's scope, its splits declared over the POU's and typed by their feeder (B6).
 */
import { test, expect } from "bun:test"
import { type BodySpan, isGraphicalBody, parseSource, unitBodies } from "../../syntax/index.js"
import { build, type Scope } from "../../symbols/index.js"
import { analyzeNetworkText } from "./network-analyze.js"

/** Parse a full POU source and return its (single) graphical body. */
function vgBody(src: string): BodySpan {
  const { units } = parseSource(src, { networkText: true }, "codesys")
  const body = unitBodies(units[0]!).find(isGraphicalBody)
  if (body === undefined) throw new Error("no graphical body")
  return body
}

const doc = (src: string) => ({ uri: "file:///FB.pou", source: src, parseResult: parseSource(src, { networkText: true }, "codesys") })

const project = (d: ReturnType<typeof doc>): Scope => build.buildSymbolTable([d], [], "codesys")

/** The type each split of the body's first network is typed by, as the scope declares it. */
function splitTypes(statements: string): Record<string, string | undefined> {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; b : BOOL; i : INT; j : INT; END_VAR
IMPLEMENTATION LD
NETWORK
${statements}
END_NETWORK
END_FUNCTION_BLOCK`
  const d = doc(src)
  const analysis = analyzeNetworkText(parseSource(src, { networkText: true }, "codesys").units[0]!, vgBody(src), project(d), d.uri)
  expect(analysis.vg.diagnostics).toEqual([])
  const scope = [...analysis.networkScopes.values()][0]!
  const out: Record<string, string | undefined> = {}
  for (const [, syms] of scope.symbols)
    for (const s of syms) out[s.name] = s.typeExpr?.kind === "named_type" ? s.typeExpr.name.text : undefined
  return out
}

test("network text: a split's uses are typed by its feeder — a bit box, an ENO, a comparison, a leaf, another split", () => {
  expect(splitTypes("split1 := a AND b;\nx := split1;")).toEqual({ split1: "BOOL" })
  expect(splitTypes("split2 := i GT j;\nx := split2;")).toEqual({ split2: "BOOL" })
  expect(splitTypes("split3 := i;\nsplit4 := split3;\nx := split4;")).toEqual({ split3: "INT", split4: "INT" })
  expect(splitTypes("split5 := i ADD j;\nx := split5;")).toEqual({ split5: "INT" })
  expect(splitTypes("MOVE 1 => i EN a\nsplit6 := ENO;\nx := split6;")).toEqual({ split6: "BOOL" })
})

test("network text: the left rail feeds a BOOL split in LD", () => {
  expect(splitTypes("split7 := ;\nx := split7 AND a;")).toEqual({ split7: "BOOL" })
})
