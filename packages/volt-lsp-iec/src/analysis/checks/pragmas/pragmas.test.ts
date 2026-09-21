/**
 * unknown-attribute — C0351, a 3-state configurable diagnostic (off/warning/error), default warning (CODESYS's
 * default). The central filter drops it when set to "off". Here toggled via `diagnostics: { "unknown-attribute" }`.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

/** unknown-attribute diagnostics for one source, with the C0351 warning toggled. */
function attrs(src: string, enabled: boolean) {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }], [], "codesys")
  const config = resolveConfig({ vendor: "codesys", diagnostics: { "unknown-attribute": enabled ? "warning" : "off" } })
  return computeSemanticDiagnostics({ parseResult, source: src, project, config }).filter(
    (d) => d.code === "unknown-attribute",
  )
}

const withAttr = (a: string) => `{attribute '${a}'}\nFUNCTION_BLOCK F\nEND_FUNCTION_BLOCK`

test("a typo'd attribute IS flagged by default (byte-identical to CODESYS)", () => {
  const d = attrs(withAttr("qualifid_only"), true) // note the typo
  expect(d).toHaveLength(1)
  expect(d[0]?.severity).toBe("warning")
  expect(d[0]?.message).toBe("The attribute qualifid_only is unknown and will be ignored by the  compiler.")
})

test("a known attribute is not flagged", () => {
  expect(attrs(withAttr("qualified_only"), true)).toEqual([])
  expect(attrs(withAttr("strict"), true)).toEqual([]) // enum type-safety attr — recognized, so not flagged
  expect(attrs(withAttr("no_explicit_call"), true)).toEqual([]) // corpus-found catalog gap, now covered
  expect(attrs(withAttr("TcRetain"), true)).toEqual([]) // TwinCAT family, case-insensitive
})

test("alias spellings of a known attribute are recognized (not flagged)", () => {
  // Guards the alias-folding in the catalog — dropping one would false-positive on valid code.
  for (const a of ["no_init", "no-init", "TcLinkToOSO", "tc_no_symbol"]) expect(attrs(withAttr(a), true)).toEqual([])
})

// CODESYS quirk (verified live: a bogus attribute on a built+referenced DUT emits nothing, unlike the same on a
// POU variable): the attribute-check pass does not run on a TYPE declaration. So an unknown attribute on a DUT is
// NOT flagged, even though the identical typo on a POU IS. (Corpus-found: `qualified_oly`/`strit` on an enum.)
test("an unknown attribute on a DUT (type_decl) is NOT flagged — POU still is", () => {
  const dut = (a: string) => `{attribute '${a}'}\nTYPE E : (Idle, Running); END_TYPE`
  expect(attrs(dut("qualifid_only"), true)).toEqual([]) // DUT → skipped (matches CODESYS)
  expect(attrs(dut("totally_bogus"), true)).toEqual([]) // any unknown attr on a DUT → skipped
  expect(attrs(withAttr("qualifid_only"), true)).toHaveLength(1) // same typo on a POU → still flagged
})

test("the C0351 warning can be turned OFF (toggle) — then a typo is not flagged", () => {
  expect(attrs(withAttr("qualifid_only"), false)).toEqual([])
})

test("the warning is CODESYS-only — TwinCAT compiles unknown attributes clean (confirmed live)", () => {
  const parseResult = parseSource(withAttr("qualifid_only"))
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: withAttr("qualifid_only") }], [], "twincat")
  const config = resolveConfig({ vendor: "twincat", diagnostics: { "unknown-attribute": "warning" } })
  const d = computeSemanticDiagnostics({ parseResult, source: withAttr("qualifid_only"), project, config }).filter(
    (x) => x.code === "unknown-attribute",
  )
  expect(d).toEqual([]) // TwinCAT emits nothing even with the lint on
})

test("an attribute with a value payload resolves its name", () => {
  expect(attrs(`{attribute 'pack_mode' := '1'}\nTYPE T : STRUCT x : INT; END_STRUCT END_TYPE`, true)).toEqual([])
})

// ─── C0351: an INVALID VALUE for the known `{attribute 'symbol'}` (symbol-export access mode) ───
// Live-found (pro2193): a `'noe'` typo for `'none'` — the root C0351 that cascades into downstream C0564
// init warnings. Same C0351 code + toggle as the unknown-NAME case, distinct SymbolConfig-prefixed wording.

const prog = (attr: string) => `{attribute 'symbol' := '${attr}'}\nPROGRAM P\nVAR_INPUT x : INT; END_VAR\nEND_PROGRAM`

test("a typo'd 'symbol' value ('noe') is flagged with the SymbolConfig wording", () => {
  const d = attrs(prog("noe"), true)
  expect(d).toHaveLength(1)
  expect(d[0]?.severity).toBe("warning")
  expect(d[0]?.message).toBe("SymbolConfig: Invalid value 'noe' for attribute 'symbol'. Should be one of: none, read, write, readwrite")
})

test("every legal 'symbol' value is accepted (zero-FP), case-insensitively", () => {
  for (const v of ["none", "read", "write", "readwrite", "None", "ReadWrite"]) expect(attrs(prog(v), true)).toEqual([])
})

test("the invalid-value warning rides the SAME C0351 toggle (off ⇒ silent) and is CODESYS-only", () => {
  expect(attrs(prog("noe"), false)).toEqual([]) // toggled off with the unknown-attribute (C0351) control
  const src = prog("noe")
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "P.prg", parseResult, source: src }], [], "twincat")
  const tc = computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "twincat" }) })
    .filter((d) => d.code === "unknown-attribute")
  expect(tc).toEqual([]) // CODESYS-gated, like the unknown-name case
})

test("an attribute other than 'symbol' with an odd value is NOT value-checked (only 'symbol' has a closed set)", () => {
  // `monitoring` is a known attribute; we don't police its value — no published closed set, so zero-FP.
  expect(attrs(`{attribute 'monitoring' := 'whatever'}\nFUNCTION_BLOCK F\nEND_FUNCTION_BLOCK`, true)).toEqual([])
})

// ─── conditional-compile balance ({IF}/{ELSIF}/{ELSE}/{END_IF}) — wording confirmed against live CODESYS + TwinCAT ───

function condDiags(src: string, vendor: "codesys" | "twincat" = "codesys") {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }], [], vendor)
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

// ─── C0051 — hasattribute() attribute operand must be a quoted string (verified live CODESYS 3.5.21) ───

function attrValue(src: string) {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.prg", parseResult, source: src }], [], "codesys")
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) }).filter(
    (d) => d.code === "attribute-value-string",
  )
}

test("an unquoted hasattribute() attribute is flagged, byte-identical to CODESYS", () => {
  const d = attrValue(`PROGRAM PLC_PRG\n{IF hasattribute(pou: MyPOU, MyAttribute)}\n{END_IF}\nEND_PROGRAM`)
  expect(d).toHaveLength(1)
  expect(d[0]?.message).toBe("Single byte string expected for an attribute value instead of 'MyAttribute'")
})

test("a quoted attribute value, and a non-hasattribute condition, are not flagged", () => {
  expect(attrValue(`PROGRAM PLC_PRG\n{IF hasattribute(pou: MyPOU, 'MyAttribute')}\n{END_IF}\nEND_PROGRAM`)).toEqual([])
  expect(attrValue(`PROGRAM PLC_PRG\n{IF defined(FOO)}\n{END_IF}\nEND_PROGRAM`)).toEqual([])
})

test("an attribute's value is checked against its published set — unless the declaration is hidden", () => {
  const fb = (decls: string) => `FUNCTION_BLOCK F\nVAR\n${decls}\nEND_VAR\nEND_FUNCTION_BLOCK`
  const attr = (src: string) => {
    const parseResult = parseSource(src)
    const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }], [], "codesys")
    return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "unknown-attribute")
      .map((d) => d.message)
  }
  expect(attr(fb(`{attribute 'monitoring_encoding' := 'UTF8'}\nsValue : STRING;`))).toEqual([
    "Invalid value 'UTF8' for attribute 'monitoring_encoding' should be one of: ['UTF-8', 'UnicodeCharacter']",
  ])
  expect(attr(fb(`{attribute 'monitoring_encoding' := 'UTF-8'}\nsValue : STRING;`))).toEqual([])
  // a HIDDEN variable is not monitored, so the compiler never validates how it would be displayed
  expect(attr(fb(`{attribute 'hide'}\n{attribute 'monitoring_encoding' := 'UTF8'}\nsValue : STRING;`))).toEqual([])
})

test("an UNQUOTED attribute value is no value at all — the compiler reads the empty string", () => {
  const src = `FUNCTION_BLOCK F\nVAR\n{attribute 'symbol' := readwrite}\nn : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }], [], "codesys")
  const msgs = computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "unknown-attribute")
    .map((d) => d.message)
  expect(msgs).toEqual(["SymbolConfig: Invalid value '' for attribute 'symbol'. Should be one of: none, read, write, readwrite"])
})

// NOT tested, because CODESYS does not do it: "The attribute 'pingroup' can only be added to variable
// declarations." The committed recording for `pragma_conflicting_pair` carried that warning, and the rule built
// on it was a false positive — the recording was STALE. Re-recorded 2026-09-17 against a recorder that no longer
// drops the pragmas written ABOVE a POU, with their arrival confirmed by reading the item back out of the IDE:
// the compiler says nothing at all.

/** `{attribute 'abstract'}` is the OLD spelling; SP21 wants the keyword and warns when it finds one without the
 *  other. It is a METHOD rule, and that took two fixtures to establish: the same attribute on a FUNCTION_BLOCK
 *  records nothing (`cc6_abstract_attribute_on_fb`), on a METHOD it warns (`cc6_abstract_attribute_on_method`).
 *  `cc4_not_instantiable` carries it on BOTH and records one warning, so it could never say which — which is why
 *  the halves were measured separately. */
function abstractWarnings(src: string, vendor: "codesys" | "twincat" = "codesys"): string[] {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }], [], vendor)
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "abstract-keyword-missing")
    .map((d) => d.message)
}

const FB = "FUNCTION_BLOCK F\nVAR\n\tn : INT;\nEND_VAR\nn := 1;\nEND_FUNCTION_BLOCK\n"

test("the abstract ATTRIBUTE on a method without the keyword warns", () => {
  expect(abstractWarnings(FB + "\n{attribute 'abstract'}\nMETHOD Shape : INT\nShape := 1;\nEND_METHOD\n")).toEqual([
    "The ABSTRACT keyword is missing",
  ])
})

// TwinCAT never deprecated the spelling and builds both fixtures clean (`cc4_not_instantiable`,
// `cc6_abstract_attribute_on_method`, recorded 2026-09-20), so on TwinCAT this is a false positive.
test("the warning is CODESYS-only", () => {
  const src = FB + "\n{attribute 'abstract'}\nMETHOD Shape : INT\nShape := 1;\nEND_METHOD\n"
  expect(abstractWarnings(src, "codesys")).toEqual(["The ABSTRACT keyword is missing"])
  expect(abstractWarnings(src, "twincat")).toEqual([])
})
test("the same attribute on a FUNCTION_BLOCK is silent — measured, not assumed", () => {
  expect(abstractWarnings("{attribute 'abstract'}\n" + FB)).toEqual([])
})

test("a method carrying the KEYWORD as well is silent", () => {
  expect(
    abstractWarnings(FB + "\n{attribute 'abstract'}\nMETHOD ABSTRACT Shape : INT\nEND_METHOD\n"),
  ).toEqual([])
})

test("a method with neither the attribute nor the keyword is silent", () => {
  expect(abstractWarnings(FB + "\nMETHOD Shape : INT\nShape := 1;\nEND_METHOD\n")).toEqual([])
})
