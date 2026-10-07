/**
 * property-access (C0143): reading a set-only property is flagged; writing it, or reading a
 * property that has a getter, is not.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import { build } from "../../../frontend/symbols/index.js"
import { uriFor } from "../../test-uri.js"

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
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
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
    const parseResult = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
    return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "property-lacks-getter")
      .map((d) => d.message)
  }
  const setOnly = `FUNCTION_BLOCK F\nVAR\nstored : INT;\nreadBack : INT;\nEND_VAR\nLevel := 4;\nreadBack := Level;\nEND_FUNCTION_BLOCK\n\nPROPERTY Level : INT\nSET\nstored := Level;\nEND_SET\nEND_PROPERTY`
  // the bare read in the FB body is flagged; the bare name inside SET is the incoming value, not a read
  expect(run(setOnly)).toEqual(["The property 'Level' cannot be used in this context because it lacks the get accessor"])
})

// analysis-conformance 3.6 (both vendors, recorded 2026-10-06, `oopa_getonly_written`): a get-only property WRITTEN
// through its instance is "'f.GetOnly' is no valid assignment target"
test("writing a get-only property is no valid assignment target", () => {
  const all = (body: string): string[] => {
    const src = `FUNCTION_BLOCK FB\nVAR v:INT; END_VAR\nEND_FUNCTION_BLOCK\nPROPERTY GetOnly : INT\nGET\nGetOnly := 1;\nEND_GET\nEND_PROPERTY\nPROPERTY Both : INT\nGET\nBoth := v;\nEND_GET\nSET\nv := Both;\nEND_SET\nEND_PROPERTY\nPROGRAM PLC_PRG\nVAR f : FB; y : INT; END_VAR\n${body}\nEND_PROGRAM`
    const pr = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
    return computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) }).map((d) => d.message)
  }
  expect(all("f.GetOnly := 3;")).toEqual(["'f.GetOnly' is no valid assignment target"])
  expect(all("f.Both := 3;")).toEqual([])
})
