/**
 * unknown-attribute lint (opt-in). CODESYS warns on an `{attribute '<name>'}` it doesn't recognize; the
 * check mirrors that when enabled. Off by default (catalog-completeness makes it FP-prone).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

/** unknown-attribute diagnostics for one source, with the lint toggled. */
function attrs(src: string, enabled: boolean) {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  const config = resolveConfig({ vendor: "codesys", lints: { unknownAttribute: enabled } })
  return computeSemanticDiagnostics({ parseResult, source: src, project, config }).filter(
    (d) => d.code === "unknown-attribute",
  )
}

const withAttr = (a: string) => `{attribute '${a}'}\nFUNCTION_BLOCK F\nEND_FUNCTION_BLOCK`

test("a typo'd attribute is flagged (byte-identical to CODESYS) when the lint is on", () => {
  const d = attrs(withAttr("qualifid_only"), true) // note the typo
  expect(d).toHaveLength(1)
  expect(d[0]?.severity).toBe("warning")
  expect(d[0]?.message).toBe("The attribute qualifid_only is unknown and will be ignored by the  compiler.")
})

test("a known attribute is not flagged", () => {
  expect(attrs(withAttr("qualified_only"), true)).toEqual([])
  expect(attrs(withAttr("no_explicit_call"), true)).toEqual([]) // corpus-found catalog gap, now covered
  expect(attrs(withAttr("TcRetain"), true)).toEqual([]) // TwinCAT family, case-insensitive
})

test("the lint is OFF by default (nothing flagged even on a typo)", () => {
  expect(attrs(withAttr("qualifid_only"), false)).toEqual([])
})

test("an attribute with a value payload resolves its name", () => {
  expect(attrs(`{attribute 'pack_mode' := '1'}\nTYPE T : STRUCT x : INT; END_STRUCT END_TYPE`, true)).toEqual([])
})
