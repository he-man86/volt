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

test("alias spellings of a known attribute are recognized (not flagged)", () => {
  // Guards the alias-folding in the catalog — dropping one would false-positive on valid code.
  for (const a of ["no_init", "no-init", "TcLinkToOSO", "tc_no_symbol"]) expect(attrs(withAttr(a), true)).toEqual([])
})

test("the lint is OFF by default (nothing flagged even on a typo)", () => {
  expect(attrs(withAttr("qualifid_only"), false)).toEqual([])
})

test("an attribute with a value payload resolves its name", () => {
  expect(attrs(`{attribute 'pack_mode' := '1'}\nTYPE T : STRUCT x : INT; END_STRUCT END_TYPE`, true)).toEqual([])
})

// ─── conditional-compile balance ({IF}/{ELSIF}/{ELSE}/{END_IF}) — wording confirmed against live CODESYS + TwinCAT ───

function condDiags(src: string, vendor: "codesys" | "twincat" = "codesys") {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) }).filter(
    (d) => d.code === "unterminated-conditional-pragma" || d.code === "orphan-conditional-pragma",
  )
}

const withBody = (body: string) => `FUNCTION_BLOCK F\nVAR x : INT; END_VAR\n${body}\nEND_FUNCTION_BLOCK`

test("an unterminated {IF} is flagged, byte-identical to the compiler", () => {
  const d = condDiags(withBody(`{IF defined(FOO)}\nx := 1;`))
  expect(d).toHaveLength(1)
  expect(d[0]?.code).toBe("unterminated-conditional-pragma")
  expect(d[0]?.severity).toBe("error")
  expect(d[0]?.message).toBe("Unexpected End-of-file found: 'ELSIF', 'ELSE' or 'END_IF' expected")
})

test("the unterminated-{IF} message is identical on both vendors (confirmed live)", () => {
  const cs = condDiags(withBody(`{IF defined(FOO)}\nx := 1;`), "codesys")
  const tc = condDiags(withBody(`{IF defined(FOO)}\nx := 1;`), "twincat")
  expect(tc[0]?.message).toBe(cs[0]?.message)
})

test("a balanced {IF}…{END_IF} (incl. {ELSE}) is not flagged", () => {
  expect(condDiags(withBody(`{IF defined(FOO)}\nx := 1;\n{ELSE}\nx := 2;\n{END_IF}`))).toEqual([])
})

test("nested {IF} blocks balance correctly", () => {
  const src = withBody(`{IF defined(A)}\n{IF defined(B)}\nx := 1;\n{END_IF}\n{END_IF}`)
  expect(condDiags(src)).toEqual([])
})

test("each unclosed {IF} in a nest is flagged; an orphan {END_IF} is separate", () => {
  expect(condDiags(withBody(`{IF defined(A)}\n{IF defined(B)}\nx := 1;\n{END_IF}`))).toHaveLength(1) // outer IF unclosed
  const orphan = condDiags(withBody(`x := 1;\n{END_IF}`))
  expect(orphan).toHaveLength(1)
  expect(orphan[0]?.code).toBe("orphan-conditional-pragma")
})
