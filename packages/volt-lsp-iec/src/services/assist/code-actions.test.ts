/**
 * Code actions (`code-actions.ts`), held to the COMPILER (openspec lsp-quick-fixes design.md §3, §7): every quick fix is a
 * pair of conformance fixtures — a BEFORE that reports the finding and an AFTER, the BEFORE's text with exactly that
 * action's edits applied, written out and recorded. For each AFTER (`fixOf`) and each vendor whose BEFORE the LSP reports
 * the code on, this binds the BEFORE as the replay does, takes its finding through `toLspDiagnostic` (what a client sends
 * back), asks `codeActions`, applies the action of that title and expects the AFTER's source byte for byte — the BEFORE's
 * fixture name replaced by the AFTER's, the one difference the pairs allow (`fixtures/quick-fixes/shared.ts`). It holds
 * the recordings too: the BEFORE's build reports the finding, the AFTER's builds clean of errors and of the finding. Each
 * `fixAbsent` fixture asserts the action it must NOT offer.
 *
 * RED FIRST: a pair whose fix does not exist yet runs as an expected failure (`RED`), so the step that builds the fix
 * fails the suite until it takes the pair off the list.
 */
import { expect, test } from "bun:test"
import type { CodeAction, TextEdit } from "vscode-languageserver-protocol"
import { CODESYS_CODE_MAP, computeDiagnostics, resolveConfig, type DiagnosticItem, type Vendor } from "../../analysis/index.js"
import { toLspDiagnostic } from "../../server/document-diagnostics.js"
import { offsetFromPosition, type Document } from "../shared/index.js"
import { codeActions } from "./code-actions.js"
import { CODESYS_ONLY_TYPES, ELEMENTARY_TYPES } from "../../frontend/types/index.js"
import { parseSource } from "../../frontend/syntax/index.js"
import { build } from "../../frontend/symbols/index.js"
import { uriFor } from "../../../test/support/test-uri.js"
import { ALL_TESTS } from "../../../test/conformance/fixtures/index.js"
import { BUILDS } from "../../../test/conformance/support/fixture-suite.js"
import { withReplayFixture } from "../../../test/conformance/support/replay.js"
import { comparable } from "../../../test/conformance/support/compare-message.js"
import type { LanguageTest } from "../../../test/conformance/types.js"

const VENDORS: readonly Vendor[] = ["codesys", "twincat"]
const INDEX = new Map(ALL_TESTS.map((t, i) => [t.name, i]))
const fixture = (name: string): LanguageTest => {
  const t = ALL_TESTS[INDEX.get(name) ?? -1]
  if (t === undefined) throw new Error(`no fixture named ${name}`)
  return t
}
const wireCode = (code: string): string => CODESYS_CODE_MAP[code]?.[0] ?? code

/**
 * The AFTERs whose fix does not exist yet — each an expected failure until the step that builds it removes it here
 * (tasks.md 2.2). Off it since 2.1, the fix model: the wrap at an assignment, which the conversion checks now produce
 * as data — C0032's `qf_c0032_wrap`, C0197's `qf_c0197_wrap_assign` and `_return` (a function's result is assigned),
 * and C0195's `qf_c0195_wrap`, the same store warned for its sign.
 */
const RED: ReadonlySet<string> = new Set([
  "qf_c0197_wrap_init", "qf_c0197_wrap_argument", "qf_c0032_ref", "qf_callarg_wrap",
  "qf_convsrc_generic",
  "qf_c0139_remove", "qf_c0139_remove_instance", "qf_c0139_call_instance",
  "qf_c0046_change", "qf_c0046_declare_target", "qf_c0046_declare_value", "qf_c0046_declare_argument", "qf_c0046_declare_condition",
  "qf_c0077_change", "qf_c0004_change", "qf_structfield_change", "qf_c0090_change", "qf_c0086_change", "qf_c0037_change",
  "qf_c0038_change", "qf_c0117_change", "qf_c0237_change", "qf_c0351_change", "qf_c0351_remove",
  "qf_c0002_semicolon_end", "qf_c0002_semicolon_block", "qf_c0002_end_block", "qf_c0002_end_file", "qf_c0002_then", "qf_pragma_end_if",
  "qf_c0198_widen_assign", "qf_c0198_shorten_assign", "qf_c0198_widen_init", "qf_c0198_shorten_init",
  "qf_c0136_qualify_a", "qf_c0136_qualify_b", "qf_c0228_initialize", "qf_c0228_initialize_alias", "qf_c0228_initialize_subrange",
  "qf_c0094_match_base", "qf_c0089_match_interface", "qf_c0087_stub_method", "qf_c0087_stub_property", "qf_c0087_stub_method_sections", "qf_c0087_stub_property_set",
  "qf_c0119_init", "qf_c0119_exit", "qf_c0119_init_both", "qf_c0119_init_retains",
  "qf_abstract_keyword", "qf_abstract_final_keep_final", "qf_abstract_final_keep_abstract",
  "qf_c0013_insert", "qf_c0130_call", "qf_fnparens_call", "qf_c0051_quote", "qf_c0238_remove", "qf_c0533_remove", "qf_indexof_adr",
  "qf_c0206_bool", "qf_c0204_bool", "qf_border_swap", "qf_caserange_swap", "qf_c0118_remove",
  "qf_c0175_remove", "qf_access_remove", "qf_c0182_remove", "qf_c0550_remove", "qf_c0421_extends", "qf_c0203_bool", "qf_sn_rename",
  "qf_c0142_remove_second_same", "qf_c0142_remove_first_same", "qf_c0142_remove_second_differ", "qf_c0142_remove_first_differ",
  "qf_c0097_remove_same", "qf_c0097_remove_differ",
])

/** The LSP's findings of `code` on fixture `name`'s own document for `vendor`, and what `ask` makes of them there. */
function withFindings<T>(name: string, vendor: Vendor, code: string, ask: (found: DiagnosticItem[], doc: Document) => T): T {
  return withReplayFixture(INDEX.get(name)!, vendor, (files, project) => {
    const { own } = files
    const found = computeDiagnostics({ uri: own.uri, parseResult: own.parseResult, source: own.source, project, config: resolveConfig({ vendor }) })
      .filter((d) => wireCode(d.code) === code)
    return ask(found, { uri: own.uri, source: own.source, parseResult: own.parseResult })
  })
}

/** The ONE target the action has: every finding of the code on one span (an FB's initializer is reported twice there). */
function target(found: readonly DiagnosticItem[], name: string): DiagnosticItem {
  const first = found[0]!
  if (found.some((d) => d.span.start !== first.span.start || d.span.end !== first.span.end))
    throw new Error(`${name}: ${found.length} findings of ${first.code} on different spans — a BEFORE names one target`)
  return first
}

function applyEdits(source: string, edits: readonly TextEdit[]): string {
  const located = edits.map((e) => ({ start: offsetFromPosition(source, e.range.start), end: offsetFromPosition(source, e.range.end), text: e.newText }))
  let out = source
  for (const e of [...located].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return out
}

/** The edits of `action` on `uri` — and nothing on any other document (a quick fix stays in the reporting file, §1). */
function editsOn(action: CodeAction, uri: string): readonly TextEdit[] {
  const changes = action.edit?.changes ?? {}
  const others = Object.keys(changes).filter((u) => u !== uri)
  if (others.length > 0) throw new Error(`'${action.title}' edits ${others.join(", ")} besides the reporting document`)
  return changes[uri] ?? []
}

/** The vendors the pair is asked on: those whose BEFORE the LSP reports the code on. */
function vendorsOf(before: string, code: string): Vendor[] {
  return VENDORS.filter((v) => BUILDS[v].tests[before] !== undefined && withFindings(before, v, code, (found) => found.length > 0))
}

const AFTERS = ALL_TESTS.filter((t) => t.fixOf !== undefined)
const ABSENT = ALL_TESTS.filter((t) => t.fixAbsent !== undefined)

/**
 * A BEFORE the LSP reports the code on for FEWER vendors than its recordings do — so `vendorsOf` drops that vendor from
 * the pair, and the test below names each one with its reason. A pair leaves this list the day the LSP reports it there.
 */
const VENDOR_GAPS: Readonly<Record<string, { vendor: Vendor; why: string }>> = {
  qf_c0077_before: {
    vendor: "twincat",
    why: "`unknownTypeName` judges a bare type on CODESYS only until TwinCAT's `References/` library rule exists (task 0.1, filed for 2.4)",
  },
}

/** Each BEFORE once, with the code its fix answers: the `fixOf` BEFOREs and the `fixAbsent` fixtures. */
const BEFORES = new Map<string, string>([...AFTERS.map((a) => [a.fixOf!.before, a.fixOf!.code] as const), ...ABSENT.map((t) => [t.name, t.fixAbsent!.code] as const)])

for (const [before, code] of BEFORES) {
  test(`code-actions: ${before} reports ${code} on the vendors its recordings do`, () => {
    // the finding's words, as the LSP gives them on any vendor (a vendor it is silent on is matched by another's words)
    const words = new Set(VENDORS.flatMap((v) => (BUILDS[v].tests[before] === undefined ? [] : withFindings(before, v, code, (found) => found.map((d) => comparable(d.message))))))
    const gaps: Vendor[] = []
    for (const vendor of VENDORS) {
      const recording = BUILDS[vendor].tests[before]
      if (recording === undefined) continue
      const recorded = recording.diagnostics.some((d) => words.has(comparable(d.message)))
      const reported = withFindings(before, vendor, code, (found) => found.length > 0)
      if (recorded && !reported) gaps.push(vendor)
      else expect({ vendor, reported }).toEqual({ vendor, reported: recorded })
    }
    const gap = VENDOR_GAPS[before]
    expect(gaps).toEqual(gap === undefined ? [] : [gap.vendor])
  })
}

test("code-actions: a diagnostic without fixes in its data gets no action — nothing is re-derived", () => {
  // `qf_c0032_before_wrap`'s finding, as a client that dropped `data` would send it back
  const offered = withFindings("qf_c0032_before_wrap", "codesys", "C0032", (found, doc) => {
    const { data: _dropped, ...bare } = toLspDiagnostic(target(found, "qf_c0032_before_wrap"))
    expect(_dropped).toBeDefined()
    return codeActions(doc, [bare]).map((a) => a.title)
  })
  expect(offered).toEqual([])
})

test("code-actions: every RED pair names an AFTER", () => {
  expect([...RED].filter((n) => !AFTERS.some((a) => a.name === n))).toEqual([])
})

for (const after of AFTERS) {
  const { before, code, title, preferred } = after.fixOf!
  const run = RED.has(after.name) ? test.failing : test
  run(`code-actions: ${before} → ${after.name} ('${title}')`, () => {
    const vendors = vendorsOf(before, code)
    expect(vendors.length).toBeGreaterThan(0) // the BEFORE reports the code on some vendor
    for (const vendor of vendors) {
      const beforeRecording = BUILDS[vendor].tests[before]!
      const { message, edited } = withFindings(before, vendor, code, (found, doc) => {
        const finding = target(found, before)
        const actions = codeActions(doc, [toLspDiagnostic(finding)])
        const action = actions.find((a) => a.title === title)
        if (action === undefined) throw new Error(`${vendor}: no action '${title}' — offered: ${actions.map((a) => `'${a.title}'`).join(", ") || "none"}`)
        expect(action.isPreferred === true).toBe(preferred === true)
        return { message: finding.message, edited: applyEdits(doc.source, editsOn(action, doc.uri)) }
      })
      // the BEFORE's build reports the finding
      expect(beforeRecording.diagnostics.map((d) => comparable(d.message))).toContain(comparable(message))
      // the action makes exactly the AFTER
      expect(edited.replaceAll(fixture(before).name, after.name)).toBe(after.source)
      // the AFTER builds clean of errors and of the finding, and the LSP says so too
      const afterRecording = BUILDS[vendor].tests[after.name]
      expect(afterRecording?.buildSuccess).toBe(true)
      expect(afterRecording!.diagnostics.filter((d) => d.severity === "error").map((d) => d.message)).toEqual([])
      expect(afterRecording!.diagnostics.map((d) => comparable(d.message))).not.toContain(comparable(message))
      expect(withFindings(after.name, vendor, code, (found) => found.map((d) => d.message))).toEqual([])
    }
  })
}

for (const t of ABSENT) {
  const { code, title, why } = t.fixAbsent!
  test(`code-actions: ${t.name} offers ${title === undefined ? "no action" : `no '${title}…'`} — ${why}`, () => {
    const vendors = vendorsOf(t.name, code)
    expect(vendors.length).toBeGreaterThan(0)
    for (const vendor of vendors) {
      const offered = withFindings(t.name, vendor, code, (found, doc) =>
        found.flatMap((f) => codeActions(doc, [toLspDiagnostic(f)]).map((a) => a.title)))
      expect(offered.filter((a) => title === undefined || a.startsWith(title))).toEqual([])
    }
  })
}

// ─── what the wrap must NOT offer, on sources no recording shows building (review of step 2.1) ─────────────────────

/** The actions on every finding of `code` in a CODESYS document: an FB `body` over `vars`, then the units `after`. */
function offeredOn(vars: string, body: string, code: string, after = ""): { doc: Document; actions: CodeAction[] } {
  const source = `FUNCTION_BLOCK FB\nVAR\n${vars}\nEND_VAR\nIMPLEMENTATION ST\n${body}\nEND_FUNCTION_BLOCK\n${after}`
  const parseResult = parseSource(source, { networkText: true }, "codesys")
  const project = build.buildSymbolTable([{ uri: "FB.pou", parseResult, source }], [], "codesys")
  const doc: Document = { uri: uriFor(parseResult), source, parseResult }
  const found = computeDiagnostics({ uri: doc.uri, parseResult, source, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => wireCode(d.code) === code)
  expect(found.length).toBeGreaterThan(0) // the case reports the code at all
  return { doc, actions: found.flatMap((f) => codeActions(doc, [toLspDiagnostic(f)])) }
}

// `a := b := c` stores c into b and b into a: wrapping the OUTER link's value (`b`, a target) gives `a := TO_X(b) := c`,
// which does not parse, and wrapping `c` changes what is stored into `b` — the outer link has no single wrap
test("code-actions: the OUTER link of a chained assignment gets no wrap — C0197 and C0032", () => {
  expect(offeredOn("\toutR : REAL;\n\tmidL : LREAL;\n\tsrcL : LREAL;", "outR := midL := srcL;", "C0197").actions.map((a) => a.title)).toEqual([])
  expect(offeredOn("\toutI : INT;\n\tmidT : TIME;\n\tsrcT : TIME;", "outI := midT := srcT;", "C0032").actions.map((a) => a.title)).toEqual([])
})

test("code-actions: the INNER link of a chained assignment wraps the final value", () => {
  const { doc, actions } = offeredOn("\toutL : LREAL;\n\tmidR : REAL;\n\tsrcL : LREAL;", "outL := midR := srcL;", "C0197")
  expect(actions.map((a) => a.title)).toEqual(["Wrap in TO_REAL(…)"])
  expect(applyEdits(doc.source, editsOn(actions[0]!, doc.uri))).toContain("outL := midR := TO_REAL(srcL);")
})

// TO_<T> is an ELEMENTARY conversion: the explicit-pair recordings (`xp_*`, `conversion.ts`) show it building between
// elementary types only; an ARRAY, a STRUCT, an FB instance, a pointer, a reference or an enum into an elementary target
// has no recording of TO_<T> building
test("code-actions: a C0032 whose SOURCE is not elementary gets no wrap — array, struct, FB instance, pointer", () => {
  for (const [vars, body, after] of [
    ["\tnum : INT;\n\tarr : ARRAY[0..1] OF INT;", "num := arr;", ""],
    ["\tstr : STRING;\n\tv : VERSION;", "str := v;", ""],
    ["\tnum : INT;\n\tinst : FB_Other;", "num := inst;", "FUNCTION_BLOCK FB_Other\nEND_FUNCTION_BLOCK\n"],
    ["\tw : WORD;\n\tx : INT;\n\tp : POINTER TO INT;", "p := ADR(x);\nw := p;", ""],
  ] as const)
    expect({ body, offered: offeredOn(vars, body, "C0032", after).actions.map((a) => a.title) }).toEqual({ body, offered: [] })
})

// `preferred` is what auto-apply picks: it is set only on the shapes the qf_ AFTERs record — a variable's value (an
// LREAL into a REAL, an INT into a UINT). An untyped literal the target cannot hold may be the wrong literal, not a
// missing conversion: the wrap builds (`xp_*`) but is offered unmarked
test("code-actions: the wrap of an untyped LITERAL is offered, not preferred", () => {
  const { actions } = offeredOn("\tsi : SINT;", "si := 128;", "C0195")
  expect(actions.map((a) => [a.title, a.isPreferred === true])).toEqual([["Wrap in TO_SINT(…)", false]])
})

test("code-actions: the wrap keeps the value's own text — its comments, line breaks and spacing", () => {
  const { doc, actions } = offeredOn("\twide : LREAL;\n\tnarrow : REAL;", "narrow := wide (* scale *)\n   * 2.0;", "C0197")
  expect(actions.map((a) => a.title)).toEqual(["Wrap in TO_REAL(…)"])
  expect(applyEdits(doc.source, editsOn(actions[0]!, doc.uri))).toContain("narrow := TO_REAL(wide (* scale *)\n   * 2.0);")
})

// a client may send back a diagnostic published before the latest edit: its fix's spans name the OLD text, and applied
// to the new one they would overwrite whatever now sits there
test("code-actions: a fix whose span no longer holds the text it was made for is not offered", () => {
  const { doc } = offeredOn("\twide : LREAL;\n\tnarrow : REAL;\n\txwide : LREAL;", "narrow := wide;", "C0197")
  const source = doc.source.replace("narrow := wide;", "narrow := xwide;")
  const published = (() => {
    const parseResult = parseSource(doc.source, { networkText: true }, "codesys")
    const project = build.buildSymbolTable([{ uri: "FB.pou", parseResult, source: doc.source }], [], "codesys")
    return computeDiagnostics({ uri: doc.uri, parseResult, source: doc.source, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => wireCode(d.code) === "C0197")
  })()
  expect(published.length).toBe(1)
  const edited: Document = { uri: doc.uri, source, parseResult: parseSource(source, { networkText: true }, "codesys") }
  expect(codeActions(doc, published.map(toLspDiagnostic)).map((a) => a.title)).toEqual(["Wrap in TO_REAL(…)"])
  expect(codeActions(edited, published.map(toLspDiagnostic))).toEqual([])
})

// ─── the gate of step 2.1 ─────────────────────────────────────────────────────────────────────────────────────────

// THE GENERIC TO_<T> A WRAP NAMES IS ONE A RECORDING SHOWS BUILDING (§3). `xp_*` records `X_TO_Y`, not `TO_Y`; the generic
// form is recorded by the fixtures that write it — `qf_to_*` (one per elementary type no other fixture wrote: BOOL, LINT,
// ULINT, LWORD, LTIME, DATE, TOD, DT, LDATE, LTOD, LDT, BIT; all build, both vendors, the 64-bit dates CODESYS only) and
// every other fixture's own `TO_<T>(`. So the wrap may name any elementary target; a type added without a recording fails here.
const GENERIC = /(?<![A-Za-z0-9_])TO_([A-Z]+)\(/g
function genericBuilt(vendor: Vendor): Set<string> {
  const built = new Set<string>()
  for (const t of ALL_TESTS) {
    const r = BUILDS[vendor].tests[t.name]
    if (r?.buildSuccess !== true || r.diagnostics.some((d) => d.severity === "error")) continue
    for (const m of t.source.matchAll(GENERIC)) built.add(m[1]!)
  }
  return built
}

test("code-actions: the TO_<T> of every elementary type builds in a recording, on each vendor that has the type", () => {
  for (const vendor of VENDORS) {
    const built = genericBuilt(vendor)
    const types = [...ELEMENTARY_TYPES.keys()].filter((t) => vendor === "codesys" || !CODESYS_ONLY_TYPES.has(t))
    expect({ vendor, unrecorded: types.filter((t) => !built.has(t)) }).toEqual({ vendor, unrecorded: [] })
  }
})

test("code-actions: a BIT target is wrapped in TO_BIT — recorded building (`qf_to_bit`)", () => {
  const { doc, actions } = offeredOn("\trec : ST_B;\n\ti : INT;", "rec.b := i;", "C0032", "TYPE ST_B :\nSTRUCT\n\tb : BIT;\nEND_STRUCT\nEND_TYPE\n")
  expect(actions.map((a) => a.title)).toEqual(["Wrap in TO_BIT(…)"])
  expect(applyEdits(doc.source, editsOn(actions[0]!, doc.uri))).toContain("rec.b := TO_BIT(i);")
})

// A WRAP WHOSE VALUE CARRIES AN ERROR OF ITS OWN CANNOT REACH A CLEAN BUILD: `out := -b` is refused twice (INT→BOOL for
// the store, BOOL→INT for the operand — `unary_minus_on_bool`), and `out := TO_BOOL(-b)` keeps the operand's (§3).
test("code-actions: a store whose VALUE holds another error gets no wrap", () => {
  expect(offeredOn("\tb : BOOL := TRUE;\n\tout : BOOL;", "out := -b;", "C0032").actions.map((a) => a.title)).toEqual([])
})

// A CHAIN IS CHECKED LINK BY LINK (`qf_c0032_chain_*`, recorded both vendors): each link stores the next one's value,
// and the message names the link's own pair — `viaWide := wide := narrowFrom` is refused DINT→SINT, not INT→SINT.
test("code-actions: a chained C0032 is reported per link, and only the innermost link's is wrapped", () => {
  const messages = (vars: string, body: string) => offeredOn(vars, body, "C0032")
  const outer = messages("\tviaWide : SINT;\n\twide : DINT;\n\tnarrowFrom : INT;", "viaWide := wide := narrowFrom;")
  expect(outer.actions.map((a) => a.title)).toEqual([])
  const inner = messages("\ta : INT;\n\tb : INT;\n\tc : TIME;", "a := b := c;")
  expect(inner.actions.map((a) => a.title)).toEqual(["Wrap in TO_INT(…)"])
  expect(applyEdits(inner.doc.source, editsOn(inner.actions[0]!, inner.doc.uri))).toContain("a := b := TO_INT(c);")
})

test("code-actions: a chain's C0032 names each link's own pair", () => {
  const found = (vars: string, body: string) => {
    const source = `FUNCTION_BLOCK FB\nVAR\n${vars}\nEND_VAR\nIMPLEMENTATION ST\n${body}\nEND_FUNCTION_BLOCK\n`
    const parseResult = parseSource(source, { networkText: true }, "codesys")
    const project = build.buildSymbolTable([{ uri: "FB.pou", parseResult, source }], [], "codesys")
    return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => wireCode(d.code) === "C0032")
      .map((d) => d.message)
  }
  expect(found("\tviaWide : SINT;\n\twide : DINT;\n\tnarrowFrom : INT;", "viaWide := wide := narrowFrom;")).toEqual(["Cannot convert type 'DINT' to type 'SINT'"])
  expect(found("\ta : INT;\n\tb : TIME;\n\tc : INT;", "a := b := c;").sort()).toEqual(["Cannot convert type 'INT' to type 'TIME'", "Cannot convert type 'TIME' to type 'INT'"])
  expect(found("\ta : INT;\n\tb : INT;\n\tc : TIME;", "a := b := c;")).toEqual(["Cannot convert type 'TIME' to type 'INT'"])
})
