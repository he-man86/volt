/**
 * unknown-attribute — C0351, a 3-state configurable diagnostic (off/warning/error), default warning (CODESYS's
 * default). The central filter drops it when set to "off". Here toggled via `diagnostics: { "unknown-attribute" }`.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig, type Vendor } from "../../index.js"
import { uriFor } from "../../test-uri.js"

/** unknown-attribute diagnostics for one source, with the C0351 warning toggled. */
function attrs(src: string, enabled: boolean, vendor: Vendor = "codesys") {
  const parseResult = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], vendor)
  const config = resolveConfig({ vendor, diagnostics: { "unknown-attribute": enabled ? "warning" : "off" } })
  return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config }).filter(
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
})

test("alias spellings of a known attribute are recognized (not flagged)", () => {
  // Guards the alias-folding in the catalog — dropping one would false-positive on valid code.
  for (const a of ["no_init", "no-init"]) expect(attrs(withAttr(a), true)).toEqual([])
})

// A `Tc*` ATTRIBUTE IS TWINCAT'S, AND CODESYS SAYS SO. Both families sat in one flat set, so every `Tc*` name was
// "known" on both vendors and this file asserted that as correct. Sixteen `tc_*` fixtures recorded the opposite:
// CODESYS warns on each of them and TwinCAT is silent (recordings 2026-09-20).
test("a Tc* attribute is known to TwinCAT and unknown to CODESYS", () => {
  for (const a of ["TcRetain", "TcLinkToOSO", "tc_no_symbol"]) {
    expect(attrs(withAttr(a), true, "twincat")).toEqual([])
    expect(attrs(withAttr(a), true).map((d) => d.message)).toEqual([
      `The attribute ${a} is unknown and will be ignored by the  compiler.`,
    ])
  }
})

// This said a DUT is skipped ("verified live" on pro2193's enum). Every DUT kind warns, recorded with the pragma pushed
// (`prag_unknown_attribute_on_{struct,enum,alias,union}`, 2026-10-02 — the recorder had been dropping it).
test("an unknown attribute on a DUT is flagged as on a POU; a GVL file is not", () => {
  const dut = (a: string) => `{attribute '${a}'}\nTYPE E : (Idle, Running); END_TYPE`
  expect(attrs(dut("totally_bogus"), true)).toHaveLength(1)
  expect(attrs(withAttr("qualifid_only"), true)).toHaveLength(1)

  // …and a GVL file the same way. `{attribute 'Tc2GvlVarNames'}` above a `VAR_GLOBAL` is the ONE of the
  // seventeen `tc_*` fixtures CODESYS says nothing about, which is not about the name: the pass never runs here.
  const gvl = (a: string) => `{attribute '${a}'}
VAR_GLOBAL
gVal : INT;
END_VAR`
  expect(attrs(gvl("Tc2GvlVarNames"), true)).toEqual([])
  expect(attrs(gvl("totally_bogus"), true)).toEqual([])
})

// …the LIST's pragma. One on a VARIABLE of the list warns as anywhere else (`prag_rule_unknown_attribute_on_gvl_variable`,
// analysis-conformance 3.10, CODESYS; TwinCAT clean).
test("an unknown attribute on a GVL's variable is flagged", () => {
  expect(attrs(`VAR_GLOBAL
	{attribute 'volt_bogus'}
	v : INT := 1;
END_VAR`, true).map((d) => d.message)).toEqual([
    "The attribute volt_bogus is unknown and will be ignored by the  compiler.",
  ])
})

// Measured, analysis-conformance 3.10 (CODESYS; TwinCAT silent on both): an attribute written as a STATEMENT in a body
// attaches to nothing (`prag_rule_unknown_attribute_in_body`), and `{ATTRIBUTE '…'}` is no attribute — the word is
// case-sensitive like every other pragma word (`prag_rule_unknown_attribute_upper_case`).
test("an attribute in a body, and the ATTRIBUTE word in upper case, are not checked", () => {
  expect(attrs(`FUNCTION_BLOCK F
VAR
	out : INT;
END_VAR
{attribute 'volt_bogus'}
out := 1;
END_FUNCTION_BLOCK`, true)).toEqual([])
  expect(attrs(`FUNCTION_BLOCK F
VAR
	{ATTRIBUTE 'volt_bogus'}
	v : INT;
END_VAR
END_FUNCTION_BLOCK`, true)).toEqual([])
})

// `monitoring_encoding := 'utf-8'` builds clean (`prag_rule_monitoring_encoding_lower_case`, analysis-conformance 3.10):
// the published set is compared without case (`symbol`'s is the case-sensitive one, above).
test("a closed value set is compared without case", () => {
  const enc = (v: string) => `FUNCTION_BLOCK F
VAR
	{attribute 'monitoring_encoding' := '${v}'}
	s : STRING;
END_VAR
END_FUNCTION_BLOCK`
  expect(attrs(enc("utf-8"), true)).toEqual([])
  expect(attrs(enc("UnicodeCharacter"), true)).toEqual([])
  expect(attrs(enc("UTF8"), true)).toHaveLength(1)
})

test("the C0351 warning can be turned OFF (toggle) — then a typo is not flagged", () => {
  expect(attrs(withAttr("qualifid_only"), false)).toEqual([])
})

test("the warning is CODESYS-only — TwinCAT compiles unknown attributes clean (confirmed live)", () => {
  const parseResult = parseSource(withAttr("qualifid_only"), { networkText: true }, "twincat")
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: withAttr("qualifid_only") }], [], "twincat")
  const config = resolveConfig({ vendor: "twincat", diagnostics: { "unknown-attribute": "warning" } })
  const d = computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: withAttr("qualifid_only"), project, config }).filter(
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

// This said "case-insensitively" and accepted `'None'` / `'ReadWrite'`, unrecorded: CODESYS warns about `'READ'`
// (`prag_rule_symbol_value_upper_case`, analysis-conformance 3.10 — TwinCAT builds it clean). The set is lower case.
test("every legal 'symbol' value is accepted (zero-FP), in lower case only", () => {
  for (const v of ["none", "read", "write", "readwrite"]) expect(attrs(prog(v), true)).toEqual([])
  expect(attrs(prog("READ"), true).map((d) => d.message)).toEqual([
    "SymbolConfig: Invalid value 'READ' for attribute 'symbol'. Should be one of: none, read, write, readwrite",
  ])
})

test("the invalid-value warning rides the SAME C0351 toggle (off ⇒ silent) and is CODESYS-only", () => {
  expect(attrs(prog("noe"), false)).toEqual([]) // toggled off with the unknown-attribute (C0351) control
  const src = prog("noe")
  const parseResult = parseSource(src, { networkText: true }, "twincat")
  const project = build.buildSymbolTable([{ uri: "P.pou", parseResult, source: src }], [], "twincat")
  const tc = computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "twincat" }) })
    .filter((d) => d.code === "unknown-attribute")
  expect(tc).toEqual([]) // CODESYS-gated, like the unknown-name case
})

test("an attribute other than 'symbol' with an odd value is NOT value-checked (only 'symbol' has a closed set)", () => {
  // `monitoring` is a known attribute; we don't police its value — no published closed set, so zero-FP.
  expect(attrs(`{attribute 'monitoring' := 'whatever'}\nFUNCTION_BLOCK F\nEND_FUNCTION_BLOCK`, true)).toEqual([])
})

// ─── conditional-compile balance ({IF}/{ELSIF}/{ELSE}/{END_IF}) — wording confirmed against live CODESYS + TwinCAT ───

function condDiags(src: string, vendor: "codesys" | "twincat" = "codesys") {
  const parseResult = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], vendor)
  return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor }) }).filter(
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
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], "codesys")
  return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) }).filter(
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
    const parseResult = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], "codesys")
    return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
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
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], "codesys")
  const msgs = computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
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
  const parseResult = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], vendor)
  return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor }) })
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
// This said "silent — measured, not assumed": it was measured WITHOUT the attribute — the recorder dropped every pragma
// above a top-level unit (frontend-conformance 2.7.2). With it pushed, CODESYS warns on the FB as well
// (`cc6_abstract_attribute_on_fb`, `cc4_not_instantiable` two warnings, 2026-10-02).
test("the same attribute on a FUNCTION_BLOCK warns too, and not on TwinCAT", () => {
  expect(abstractWarnings("{attribute 'abstract'}\n" + FB)).toEqual(["The ABSTRACT keyword is missing"])
  expect(abstractWarnings("{attribute 'abstract'}\n" + FB, "twincat")).toEqual([])
})

// …and on a PROPERTY and a FUNCTION (`prag_rule_abstract_attribute_on_property`, `_on_function`, analysis-conformance 3.10;
// TwinCAT clean): a FUNCTION takes no ABSTRACT keyword, and CODESYS still says it is missing.
test("the same attribute on a PROPERTY and on a FUNCTION warns, and not on TwinCAT", () => {
  const property = FB + "\n{attribute 'abstract'}\nPROPERTY P : INT\nGET\nP := 1;\nEND_GET\nEND_PROPERTY\n"
  const fn = "{attribute 'abstract'}\nFUNCTION G : INT\nG := 1;\nEND_FUNCTION\n"
  for (const src of [property, fn]) {
    expect(abstractWarnings(src)).toEqual(["The ABSTRACT keyword is missing"])
    expect(abstractWarnings(src, "twincat")).toEqual([])
  }
})

test("a method carrying the KEYWORD as well is silent", () => {
  expect(
    abstractWarnings(FB + "\n{attribute 'abstract'}\nMETHOD ABSTRACT Shape : INT\nEND_METHOD\n"),
  ).toEqual([])
})

test("a method with neither the attribute nor the keyword is silent", () => {
  expect(abstractWarnings(FB + "\nMETHOD Shape : INT\nShape := 1;\nEND_METHOD\n")).toEqual([])
})

// The message words are CASE-SENSITIVE on both vendors, as every other pragma word is: `{WARNING 'x'}`, `{Warning 'x'}`
// and `{ERROR 'x'}` build CLEAN, in a body or above a declaration (`prag_warning_upper_case`, `prag_warning_mixed_case`,
// `prag_error_upper_case`, `prag_warning_upper_case_in_declaration`, CODESYS and TwinCAT 2026-10-02). The analysis read
// them case-insensitively, "unmeasured", and said a warning and an error no build says.
test("a message pragma's word in upper or mixed case is no message pragma, in a body or out of one (prag_*_upper_case)", () => {
  const said = (src: string, vendor: Vendor) => {
    const parseResult = parseSource(src, { networkText: true }, vendor)
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], vendor)
    return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor }) })
      .filter((d) => d.code.startsWith("message-pragma"))
      .map((d) => `${d.severity}:${d.message}`)
  }
  for (const vendor of ["codesys", "twincat"] as const) {
    expect(said("FUNCTION_BLOCK F\nVAR\n\tout : INT;\nEND_VAR\n{WARNING 'upper'}\n{Warning 'mixed'}\n{ERROR 'error'}\nout := 1;\nEND_FUNCTION_BLOCK", vendor)).toEqual([])
    expect(said("FUNCTION_BLOCK F\nVAR\n{WARNING 'upper in a declaration'}\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK", vendor)).toEqual([])
    // the lower-case word is the message pragma
    expect(said("FUNCTION_BLOCK F\nVAR\n{warning 'decl'}\n\tout : INT;\nEND_VAR\n{warning 'body'}\nout := 1;\nEND_FUNCTION_BLOCK", vendor)).toEqual([
      "warning:decl",
      "warning:body",
    ])
  }
})

// The 3.10 gate review asked the kinds the rule had not been put to: a PROGRAM warns, and so does a METHOD of an INTERFACE
// (`prag_rule_abstract_attribute_on_program`, `_on_interface_method`, CODESYS; TwinCAT clean) — the warning does not
// depend on the POU kind. (An ACTION cannot carry the attribute: the push refuses a pragma above `ACTION`.)
test("the same attribute on a PROGRAM and on an INTERFACE's METHOD warns, and not on TwinCAT", () => {
  const program = "{attribute 'abstract'}\nPROGRAM P\nVAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_PROGRAM\n"
  const itfMethod = "INTERFACE I\n{attribute 'abstract'}\nMETHOD M : INT\nEND_METHOD\nEND_INTERFACE\n"
  for (const src of [program, itfMethod]) {
    expect(abstractWarnings(src)).toEqual(["The ABSTRACT keyword is missing"])
    expect(abstractWarnings(src, "twincat")).toEqual([])
  }
})

// `{ATTRIBUTE 'hide'}` (the word in upper case) does not silence the value check: CODESYS still warns about 'UTF8' beside
// it (`prag_rule_hide_upper_case`, the 3.10 gate review; TwinCAT clean) — the upper-case word is no attribute at all.
test("`{ATTRIBUTE 'hide'}` does not silence monitoring_encoding's value check", () => {
  const src = "FUNCTION_BLOCK F\nVAR\n\t{ATTRIBUTE 'hide'}\n\t{attribute 'monitoring_encoding' := 'UTF8'}\n\ts : STRING;\nEND_VAR\nEND_FUNCTION_BLOCK"
  expect(attrs(src, true)).toHaveLength(1)
  expect(attrs(src, true, "twincat")).toEqual([])
})
