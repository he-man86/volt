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
%LANGUAGE LD
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
  expect(splitTypes("split6 := MOVE 1 => i ENO EN a;\nx := split6;")).toEqual({ split6: "BOOL" })
})

test("network text: the left rail feeds a BOOL split in LD", () => {
  expect(splitTypes("split7 := ;\nx := split7 AND a;")).toEqual({ split7: "BOOL" })
})

// 2R.5 (awkward-sweep #17): a call head is any variable reference — an ELEMENT of an array of FBs is an instance of the
// element type (the box the IDE stores with `Instance 'fbs[1]'`, `BoxType 'CTU'`), as the bridge's scope reads it, so the
// type its call names is held to the element's. A subscript of something that is no array of FBs, or one with fewer or
// more indices than the array has dimensions (`m[0]` of a 2-D array is a row; `NetworkScopeTests`), is an instance the
// declarations do not name: the call's type is the build's to judge.
test("network text: an element of an array of FBs heads its FB's call", () => {
  const read = (decl: string, head = "fbs[1]", type = "FB_C"): string[] => {
    const src = `FUNCTION_BLOCK F
VAR ${decl} go : BOOL; n : WORD; END_VAR
%LANGUAGE LD
NETWORK
  \`${head}\` : ${type}(CU := go, PV := 10, CV => n);
END_NETWORK
END_FUNCTION_BLOCK
FUNCTION_BLOCK FB_C
VAR_INPUT CU : BOOL; PV : INT; END_VAR
VAR_OUTPUT CV : WORD; END_VAR
END_FUNCTION_BLOCK`
    const d = doc(src)
    return analyzeNetworkText(parseSource(src, { networkText: true }, "codesys").units[0]!, vgBody(src), project(d), d.uri).vg.diagnostics.map(
      (x) => x.message,
    )
  }
  expect(read("fbs : ARRAY [1..2] OF FB_C;")).toEqual([])
  expect(read("fbs : ARRAY [1..2] OF FB_C;", "fbs[1]", "TON")[0]).toContain("is declared a 'FB_C'")
  expect(read("fbs : ARRAY [1..2] OF INT;", "fbs[1]", "TON")).toEqual([])
  expect(read("m : ARRAY [0..1, 0..3] OF FB_C;", "m[0, 1]")).toEqual([])
  expect(read("m : ARRAY [0..1, 0..3] OF FB_C;", "m[0, 1]", "TON")[0]).toContain("is declared a 'FB_C'")
  expect(read("m : ARRAY [0..1, 0..3] OF FB_C;", "m[0]", "TON")).toEqual([])
  expect(read("fbs : ARRAY [1..2] OF FB_C;", "fbs[1, 2]", "TON")).toEqual([])
})
