/**
 * `analyzeNetworkText`: each network's scope, its wires declared over the POU's.
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

test("network text: analyzeNetworkText types a wire from its VAR_TEMP declaration", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; b : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
VAR_TEMP g1 : BOOL; END_VAR
g1 := (a AND b);
END_NETWORK
END_FUNCTION_BLOCK`
  const d = doc(src)
  const analysis = analyzeNetworkText(parseSource(src, { networkText: true }, "codesys").units[0]!, vgBody(src), project(d), d.uri)
  const scope = [...analysis.networkScopes.values()][0]!
  const wire = scope.symbols.get("g1")?.[0]
  expect(wire?.typeExpr?.kind).toBe("named_type")
  if (wire?.typeExpr?.kind === "named_type") expect(wire.typeExpr.name.text).toBe("BOOL")
})
