/**
 * property-access (C0143): reading a set-only property is flagged; writing it, or reading a
 * property that has a getter, is not.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const pa = (body: string): string[] => {
  const src = `FUNCTION_BLOCK FB
VAR v:INT; END_VAR
END_FUNCTION_BLOCK
PROPERTY SetOnly : INT
SET
SetOnly := 0;
END_SET
END_PROPERTY
PROPERTY GetOnly : INT
GET
GetOnly := 1;
END_GET
END_PROPERTY
PROGRAM PLC_PRG
VAR f : FB; y : INT; END_VAR
${body}
END_PROGRAM`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "property-lacks-getter")
    .map((d) => d.message)
}

test("reading a set-only property is flagged", () => {
  expect(pa(`y := f.SetOnly;`)).toEqual([
    "The property 'SetOnly' cannot be used in this context because it lacks the get accessor",
  ])
})

test("writing a set-only property is not flagged; reading a get-only property is not", () => {
  expect(pa(`f.SetOnly := 5;`)).toEqual([])
  expect(pa(`y := f.GetOnly;`)).toEqual([])
})

test("the owning FB's own body names its property BARE — but the accessor's own value is not a read", () => {
  const run = (src: string) => {
    const parseResult = parseSource(src)
    const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
    return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "property-lacks-getter")
      .map((d) => d.message)
  }
  const setOnly = `FUNCTION_BLOCK F\nVAR\nstored : INT;\nreadBack : INT;\nEND_VAR\nLevel := 4;\nreadBack := Level;\nEND_FUNCTION_BLOCK\n\nPROPERTY Level : INT\nSET\nstored := Level;\nEND_SET\nEND_PROPERTY`
  // the bare read in the FB body is flagged; the bare name inside SET is the incoming value, not a read
  expect(run(setOnly)).toEqual(["The property 'Level' cannot be used in this context because it lacks the get accessor"])
})
