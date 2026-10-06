/**
 * obsolete-usage — C0357, a 3-state configurable diagnostic (off/warning/error), default warning:
 * `POU '<name>' has been marked as obsolete: <msg>`, once per USE, on both vendors (frontend-conformance 2.7.2,
 * recorded 2026-10-02): a variable's type, each call of the instance, each call of a FUNCTION or a METHOD
 * (`cp_obsolete_pou`, `prag_attribute_obsolete_fb_declared`, `_fb_called_twice`, `_function`, `_on_method`,
 * `_method_called_twice`). The attribute is read from the AST (`syntax/pragmas/attributes`) — it used to be scanned out
 * of raw workspace text, so the conformance replay could never see the check.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { DiagnosticState } from "../../config.js"
import { uriFor } from "../../test-uri.js"

const OLD = `{attribute 'obsolete' := 'use NewFB instead'}
FUNCTION_BLOCK OldFB
VAR
  n : INT;
END_VAR
END_FUNCTION_BLOCK

{attribute 'obsolete' := 'gone in v2'}
FUNCTION OldFn : INT
END_FUNCTION
`

function obs(src: string, state: DiagnosticState = "warning") {
  const parseResult = parseSource(src, { networkText: true })
  const old = parseSource(OLD, { networkText: true })
  const project = build.buildSymbolTable([
    { uri: "F.pou", parseResult, source: src },
    { uri: "Old.pou", parseResult: old, source: OLD },
  ])
  const config = resolveConfig({ vendor: "codesys", diagnostics: { "obsolete-usage": state } })
  return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config }).filter((d) => d.code === "obsolete-usage")
}

test("a variable typed with an obsolete FB is flagged, byte-identical to CODESYS", () => {
  const d = obs(`FUNCTION_BLOCK Use\nVAR\n  inst : OldFB;\nEND_VAR\nEND_FUNCTION_BLOCK`)
  expect(d).toHaveLength(1)
  expect(d[0]?.severity).toBe("warning")
  expect(d[0]?.message).toBe("POU 'OldFB' has been marked as obsolete: use NewFB instead")
})

test("each call of an obsolete FB's instance is a use of its own (prag_attribute_obsolete_fb_called_twice)", () => {
  expect(obs(`FUNCTION_BLOCK Use\nVAR\n  inst : OldFB;\nEND_VAR\ninst();\ninst();\nEND_FUNCTION_BLOCK`)).toHaveLength(3)
})

test("a direct call to an obsolete FUNCTION is flagged", () => {
  const d = obs(`FUNCTION_BLOCK Use\nVAR\n  rv : INT;\nEND_VAR\nrv := OldFn();\nEND_FUNCTION_BLOCK`)
  expect(d).toHaveLength(1)
  expect(d[0]?.message).toBe("POU 'OldFn' has been marked as obsolete: gone in v2")
})

test("each call of an obsolete METHOD is flagged with the method's name (prag_attribute_on_method)", () => {
  const src = `FUNCTION_BLOCK Use\nVAR\n  rv : INT;\nEND_VAR\nRun();\nRun();\nEND_FUNCTION_BLOCK\n\n{attribute 'obsolete' := 'volt method text'}\nMETHOD Run\nrv := 1;\nEND_METHOD\n`
  const d = obs(src)
  expect(d.map((x) => x.message)).toEqual(["POU 'Run' has been marked as obsolete: volt method text", "POU 'Run' has been marked as obsolete: volt method text"])
})

test("a PROPERTY marked obsolete and read says nothing (prag_attribute_on_property)", () => {
  const src = `FUNCTION_BLOCK Use\nVAR\n  rv : INT;\nEND_VAR\nrv := Value;\nEND_FUNCTION_BLOCK\n\n{attribute 'obsolete' := 'p'}\nPROPERTY Value : INT\nGET\nValue := 1;\nEND_GET\nEND_PROPERTY\n`
  expect(obs(src)).toEqual([])
})

test("a commented-out attribute marks nothing (prag_attribute_commented_out)", () => {
  const src = `FUNCTION_BLOCK Use\nVAR\n  rv : INT;\nEND_VAR\nRun();\nEND_FUNCTION_BLOCK\n\n// {attribute 'obsolete' := 'x'}\nMETHOD Run\nrv := 1;\nEND_METHOD\n`
  expect(obs(src)).toEqual([])
})

test("a non-obsolete type/call is not flagged; identifiers match case-insensitively", () => {
  expect(obs(`FUNCTION_BLOCK Use\nVAR\n  rv : INT;\nEND_VAR\nrv := 1;\nEND_FUNCTION_BLOCK`)).toEqual([])
  expect(obs(`FUNCTION_BLOCK Use\nVAR\n  inst : oldfb;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toHaveLength(1)
})

test("state 'off' drops it; 'error' forces error severity", () => {
  const src = `FUNCTION_BLOCK Use\nVAR\n  inst : OldFB;\nEND_VAR\nEND_FUNCTION_BLOCK`
  expect(obs(src, "off")).toEqual([])
  expect(obs(src, "error")[0]?.severity).toBe("error")
})

test("an obsolete STRUCT used as a type, and an obsolete FB EXTENDED, are uses (obs_struct_as_type, obs_fb_extended)", () => {
  const src =
    `{attribute 'obsolete' := 'use another'}\nTYPE OldS : STRUCT x : INT; END_STRUCT END_TYPE\n` +
    `FUNCTION_BLOCK Use\nVAR\n  s1 : OldS;\nEND_VAR\nEND_FUNCTION_BLOCK\n` +
    `FUNCTION_BLOCK Derived EXTENDS OldFB\nEND_FUNCTION_BLOCK`
  expect(obs(src).map((d) => d.message)).toEqual([
    "POU 'OldS' has been marked as obsolete: use another",
    "POU 'OldFB' has been marked as obsolete: use NewFB instead",
  ])
})
