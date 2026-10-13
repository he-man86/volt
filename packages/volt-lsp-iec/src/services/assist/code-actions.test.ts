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
 * The AFTERs whose fix does not exist yet — each an expected failure until the step that builds it removes it here.
 * Empty since tasks.md 2.2: every recorded pair's fix exists (2.1 moved the wrap onto the fix model; 2.2 built F1–F10).
 * A pair added for a fix not built yet goes here, red first.
 */
const RED: ReadonlySet<string> = new Set<string>([])

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

/** The actions for `diag` asked alone — the document holding no other finding of its code, so no fix-all beside them. */
function alone(doc: Document, diag: ReturnType<typeof toLspDiagnostic>): CodeAction[] {
  return codeActions(doc, [diag], () => [diag])
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
    return codeActions(doc, [bare], () => [bare]).map((a) => a.title)
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
        const actions = alone(doc, toLspDiagnostic(finding))
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
        found.flatMap((f) => alone(doc, toLspDiagnostic(f)).map((a) => a.title)))
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
  return { doc, actions: found.flatMap((f) => alone(doc, toLspDiagnostic(f))) }
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
  expect(codeActions(doc, published.map(toLspDiagnostic), () => published.map(toLspDiagnostic)).map((a) => a.title)).toEqual(["Wrap in TO_REAL(…)"])
  expect(codeActions(edited, published.map(toLspDiagnostic), () => published.map(toLspDiagnostic))).toEqual([])
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

// ─── step 2.2: the edges of F2–F10 that no recorded pair shows (each offers NOTHING — no guess) ─────────────────────

/** Every action on every finding of `code` in a CODESYS FB whose whole source is `source`. */
function offeredIn(source: string, code: string): { doc: Document; actions: CodeAction[] } {
  const parseResult = parseSource(source, { networkText: true }, "codesys")
  const project = build.buildSymbolTable([{ uri: "FB.pou", parseResult, source }], [], "codesys")
  const doc: Document = { uri: uriFor(parseResult), source, parseResult }
  const found = computeDiagnostics({ uri: doc.uri, parseResult, source, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => wireCode(d.code) === code)
  expect(found.length).toBeGreaterThan(0)
  return { doc, actions: found.flatMap((f) => alone(doc, toLspDiagnostic(f))) }
}

// `IF a b THEN` is "'THEN' expected instead of 'b'" — a stray token BEFORE a later THEN, which another THEN does not cure
test("code-actions: no 'Insert THEN' where a THEN stands further on", () => {
  const { actions } = offeredIn("FUNCTION_BLOCK FB\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\to : INT;\nEND_VAR\nIMPLEMENTATION ST\nIF a b THEN\n\to := 1;\nEND_IF\nEND_FUNCTION_BLOCK\n", "C0002")
  expect(actions.map((x) => x.title).filter((t) => t.includes("THEN"))).toEqual([])
})

// a REPEAT that never reached its UNTIL lacks more than its closer: END_REPEAT alone is no repair
test("code-actions: no 'Insert END_REPEAT' on a REPEAT left before its UNTIL", () => {
  const { actions } = offeredIn("FUNCTION_BLOCK FB\nVAR\n\to : INT;\nEND_VAR\nIMPLEMENTATION ST\nREPEAT\n\to := o + 1;\nEND_FUNCTION_BLOCK\n", "C0002")
  expect(actions.map((x) => x.title)).not.toContain("Insert 'END_REPEAT'")
})

// a near-miss name: a LOCAL beats a name of the same distance further out, and the name itself is never offered
test("code-actions: C0046's near misses — the local first, the declare beside them", () => {
  const { actions } = offeredIn("FUNCTION_BLOCK FB\nVAR\n\tcounter : INT;\nEND_VAR\nIMPLEMENTATION ST\ncountr := counter + 1;\nEND_FUNCTION_BLOCK\n", "C0046")
  expect(actions.map((x) => x.title)).toEqual(["Change to 'counter'", "Declare 'countr' : INT"])
})

// C0142 between declarations of SEVERAL names (`a, level : INT`): removing the declaration would take the other name too
test("code-actions: no C0142 remove where a declaration declares other names besides", () => {
  const { actions } = offeredIn("FUNCTION_BLOCK FB\nVAR\n\tlevel : INT;\n\tother, level : INT;\nEND_VAR\nIMPLEMENTATION ST\nlevel := other;\nEND_FUNCTION_BLOCK\n", "C0142")
  expect(actions.map((x) => x.title)).toEqual([])
})

// C0119 where FB_Init's inputs are not a prefix of the required pair (`x : INT` first): the fix would have to move an input
test("code-actions: no C0119 input added where FB_Init holds an input of its own", () => {
  const src = "FUNCTION_BLOCK FB\nVAR\n\tc : INT;\nEND_VAR\nIMPLEMENTATION ST\nc := 1;\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\nVAR_INPUT\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nc := 0;\nEND_METHOD\n"
  expect(offeredIn(src, "C0119").actions.map((x) => x.title)).toEqual([])
})

// ─── step 2.3: fix all in the file — F1's preferred wraps only (design.md §5) ─────────────────────────────────────

/** The document's findings as the server hands them to `codeActions`, and the actions for the first one / for `only`. */
function fixAllIn(source: string, only?: string[]) {
  const parseResult = parseSource(source, { networkText: true }, "codesys")
  const project = build.buildSymbolTable([{ uri: "FB.pou", parseResult, source }], [], "codesys")
  const doc: Document = { uri: uriFor(parseResult), source, parseResult }
  const all = computeDiagnostics({ uri: doc.uri, parseResult, source, project, config: resolveConfig({ vendor: "codesys" }) }).map(toLspDiagnostic)
  return { doc, all, actions: (at: readonly typeof all[number][]) => codeActions(doc, at, () => all, only) }
}
const TWO_NARROWINGS = "FUNCTION_BLOCK FB\nVAR\n\twide : LREAL;\n\tn1 : REAL;\n\tn2 : REAL;\nEND_VAR\nIMPLEMENTATION ST\nn1 := wide;\nn2 := wide * 2.0;\nEND_FUNCTION_BLOCK\n"

test("code-actions: beside a preferred wrap, 'Fix all' wraps every one of its kind in the file", () => {
  const { doc, all, actions } = fixAllIn(TWO_NARROWINGS)
  const first = all.filter((d) => d.code === "C0197")[0]!
  const offered = actions([first])
  expect(offered.map((a) => a.title)).toEqual(["Wrap in TO_REAL(…)", "Fix all 'C0197' in the file"])
  expect(offered[1]!.diagnostics).toHaveLength(2)
  expect(applyEdits(doc.source, editsOn(offered[1]!, doc.uri))).toContain("n1 := TO_REAL(wide);\nn2 := TO_REAL(wide * 2.0);")
})

test("code-actions: source.fixAll.volt applies every fix-all fix of the file, asked by kind only", () => {
  const { doc, actions } = fixAllIn(TWO_NARROWINGS, ["source.fixAll"])
  const [action, ...rest] = actions([])
  expect(rest).toEqual([])
  expect(action!.kind).toBe("source.fixAll.volt")
  expect(applyEdits(doc.source, editsOn(action!, doc.uri))).toContain("n1 := TO_REAL(wide);\nn2 := TO_REAL(wide * 2.0);")
  // …and a request for quick fixes alone does not compute it
  expect(fixAllIn(TWO_NARROWINGS, ["quickfix"]).actions([]).map((a) => a.kind)).toEqual([])
})

test("code-actions: no fix-all for one finding, nor for a fix that is not safe beside the others (C0032's wrap)", () => {
  const one = fixAllIn("FUNCTION_BLOCK FB\nVAR\n\twide : LREAL;\n\tn1 : REAL;\nEND_VAR\nIMPLEMENTATION ST\nn1 := wide;\nEND_FUNCTION_BLOCK\n")
  expect(one.actions(one.all.filter((d) => d.code === "C0197")).map((a) => a.title)).toEqual(["Wrap in TO_REAL(…)"])
  const errors = fixAllIn("FUNCTION_BLOCK FB\nVAR\n\tf : BOOL;\n\ta : INT;\n\tb : INT;\nEND_VAR\nIMPLEMENTATION ST\na := f;\nb := f;\nEND_FUNCTION_BLOCK\n")
  expect(errors.actions(errors.all.filter((d) => d.code === "C0032").slice(0, 1)).map((a) => a.title)).toEqual(["Wrap in TO_INT(…)"])
})

// ─── gate of steps 2.2+2.4: what the review found offered where its AFTER does not build (§3) ─────────────────────────

/** The source's errors after the action titled `title` among `actions` is applied — what its AFTER still reports. */
function errorsAfter(doc: Document, actions: readonly CodeAction[], title: string): string[] {
  const action = actions.find((a) => a.title === title)
  if (action === undefined) throw new Error(`no action '${title}' among ${actions.map((a) => a.title).join(", ")}`)
  const source = applyEdits(doc.source, editsOn(action, doc.uri))
  const parseResult = parseSource(source, { networkText: true }, "codesys")
  const project = build.buildSymbolTable([{ uri: "FB.pou", parseResult, source }], [], "codesys")
  return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.severity === "error")
    .map((d) => `${d.code}: ${d.message}`)
}
const titles = (o: { actions: readonly CodeAction[] }): string[] => o.actions.map((a) => a.title)

// F4: the OUTER block of one left open is not missing its own closer — inserting a second one adds errors
test("code-actions: an inner block left open names ITS closer; the outer block, which only leaves with it, names none", () => {
  const src = (inner: string) =>
    `FUNCTION_BLOCK FB\nVAR\n\tx : INT;\n\ta : BOOL;\nEND_VAR\nIMPLEMENTATION ST\nFOR x := 1 TO 2 DO\n${inner}END_FOR\nEND_FUNCTION_BLOCK\n`
  const whileOpen = offeredIn(src("\tWHILE a DO\n\t\ta := FALSE;\n"), "C0002")
  expect(titles(whileOpen)).toEqual(["Insert 'END_WHILE'"])
  expect(errorsAfter(whileOpen.doc, whileOpen.actions, "Insert 'END_WHILE'")).toEqual([])
  expect(titles(offeredIn(src("\tIF a THEN\n\t\ta := FALSE;\n"), "C0002"))).toEqual([])
})

// F4: `IF a END_IF` with a THEN is an empty branch — an error of its own
test("code-actions: no 'Insert THEN' before an empty branch", () => {
  const { actions } = offeredIn("FUNCTION_BLOCK FB\nVAR\n\ta : BOOL;\nEND_VAR\nIMPLEMENTATION ST\nIF a\nEND_IF\nEND_FUNCTION_BLOCK\n", "C0002")
  expect(actions.map((x) => x.title)).not.toContain("Insert 'THEN'")
})

// F1: a value holding an error of its own on the SAME span (the operand's) keeps it inside the wrap
test("code-actions: a wrap whose value holds another error on the same span is withdrawn — argument and initial value", () => {
  const F_R = "FUNCTION F_R : REAL\nVAR_INPUT\n\tv : REAL;\nEND_VAR\nIMPLEMENTATION ST\nF_R := v;\nEND_FUNCTION\n"
  const arg = offeredOn("\tlr : LREAL;\n\tb : BOOL;\n\toutv : REAL;", "outv := F_R(v := lr + b);", "C0197", F_R)
  expect(titles(arg)).toEqual([])
  const init = offeredOn("\tlr : LREAL;\n\tb : BOOL;\n\toutv : REAL := lr + b;", "outv := outv;", "C0197")
  expect(titles(init)).toEqual([])
})

// F3: a near miss must be able to stand where the name is written — its kind fits the use
test("code-actions: C0046/C0004 near misses fit the use — no FUNCTION or PROGRAM read, no variable called, no METHOD read, no output written", () => {
  const units =
    "FUNCTION Counter : INT\nVAR_INPUT\nEND_VAR\nIMPLEMENTATION ST\nCounter := 1;\nEND_FUNCTION\n" +
    "PROGRAM PRG_Main\nVAR\n\tz : INT;\nEND_VAR\nIMPLEMENTATION ST\nz := 1;\nEND_PROGRAM\n" +
    "FUNCTION_BLOCK FB_Inner\nVAR_OUTPUT\n\toutp : INT;\nEND_VAR\nIMPLEMENTATION ST\noutp := 1;\nEND_FUNCTION_BLOCK\n" +
    "METHOD Execute : INT\nIMPLEMENTATION ST\nExecute := 1;\nEND_METHOD\n"
  const vars = "\ttotal : INT;\n\tcounter : INT;\n\tf : FB_Inner;\n\tv : INT;"
  const changes = (body: string, code: string) => titles(offeredOn(vars, body, code, units)).filter((t) => t.startsWith("Change"))
  expect(changes("total := Countr;", "C0046")).not.toContain("Change to 'Counter'")
  expect(changes("total := PRG_Mainn;", "C0046")).toEqual([])
  expect(changes("countr();", "C0046")).not.toContain("Change to 'counter'")
  expect(changes("v := f.Exeute;", "C0004")).toEqual([])
  expect(changes("f.otp := 1;", "C0004")).toEqual([])
  // …and where the kind fits, it is offered: a read of an output, a call of a method
  expect(changes("v := f.otp;", "C0004")).toEqual(["Change to 'outp'"])
  expect(changes("f.Exeute();", "C0004")).toEqual(["Change to 'Execute'"])
})

// F9: the rename is recorded on an FB; a FUNCTION stores its result under its own name, which a header rename orphans
test("code-actions: no 'Rename to' on a FUNCTION whose object is named otherwise", () => {
  const source = "FUNCTION F : INT\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nF := x;\nEND_FUNCTION\n"
  const parseResult = parseSource(source, { networkText: true }, "codesys")
  const uri = "file:///proj/FB.pou"
  const project = build.buildSymbolTable([{ uri, parseResult, source }], [], "codesys")
  const found = computeDiagnostics({ uri, parseResult, source, project, config: resolveConfig({ vendor: "codesys" }) }).filter((d) => d.code === "signature-name-mismatch")
  expect(found.length).toBe(1)
  expect(found[0]!.fixes).toBeUndefined()
})

// F1: an ERROR's argument may be the wrong variable — its wrap is offered, never preferred, never fix-all (as C0032's)
test("code-actions: the wrap of a call-argument-type is neither preferred nor fix-all", () => {
  const F_Half = "FUNCTION F_Half : INT\nVAR_INPUT\n\tv : INT;\nEND_VAR\nIMPLEMENTATION ST\nF_Half := v;\nEND_FUNCTION\n"
  const { actions } = offeredOn("\tname : STRING;\n\toutv : INT;", "outv := F_Half(v := name);", "call-argument-type", F_Half)
  expect(actions.map((a) => [a.title, a.isPreferred === true])).toEqual([["Wrap in TO_INT(…)", false]])
  const all = fixAllIn(`FUNCTION_BLOCK FB\nVAR\n\tname : STRING;\n\toutv : INT;\nEND_VAR\nIMPLEMENTATION ST\noutv := F_Half(v := name);\noutv := F_Half(v := name);\nEND_FUNCTION_BLOCK\n${F_Half}`, ["source.fixAll"])
  expect(all.actions([])).toEqual([])
})

// F3: a BIT local is refused outside an FB and a struct (C0203) — no "Declare … : BIT"
test("code-actions: no 'Declare' of a BIT", () => {
  const src = "TYPE ST_Bits :\nSTRUCT\n\tb0 : BIT;\nEND_STRUCT\nEND_TYPE\nPROGRAM P\nVAR\n\tbits : ST_Bits;\nEND_VAR\nIMPLEMENTATION ST\nbits.b0 := flg;\nEND_PROGRAM\n"
  expect(titles(offeredIn(src, "C0046")).filter((t) => t.startsWith("Declare"))).toEqual([])
})

// F10: a removal that changes an input into a local, or a constant into a variable, is a choice — not preferred
test("code-actions: C0142/C0097's remove is preferred only between sections of one kind and qualifiers", () => {
  const preferred = (o: { actions: readonly CodeAction[] }) => o.actions.filter((a) => a.isPreferred === true).map((a) => a.title)
  const fb = (sections: string, body: string, after = "") => `FUNCTION_BLOCK FB\n${sections}IMPLEMENTATION ST\n${body}\nEND_FUNCTION_BLOCK\n${after}`
  expect(preferred(offeredIn(fb("VAR_INPUT\n\tx : INT;\nEND_VAR\nVAR\n\tx : INT;\nEND_VAR\n", "x := 1;"), "C0142"))).toEqual([])
  expect(preferred(offeredIn(fb("VAR CONSTANT\n\tx : INT := 1;\nEND_VAR\nVAR\n\tx : INT := 1;\nEND_VAR\n", ";"), "C0142"))).toEqual([])
  expect(preferred(offeredIn(fb("VAR\n\tx : INT;\nEND_VAR\nVAR\n\tx : INT;\nEND_VAR\n", "x := 1;"), "C0142"))).toEqual(["Remove the second declaration of 'x'"])
  const base = "FUNCTION_BLOCK FB_Base\nVAR_INPUT\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\nEND_FUNCTION_BLOCK\n"
  const derived = `FUNCTION_BLOCK FB EXTENDS FB_Base\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\nEND_FUNCTION_BLOCK\n${base}`
  const c0097 = offeredIn(derived, "C0097")
  expect(titles(c0097).length).toBe(1)
  expect(preferred(c0097)).toEqual([])
})

// F8/F9: a keyword named in a COMMENT is not the keyword; ABSTRACT beside FINAL is abstract-and-final
test("code-actions: 'Remove RETAIN' removes the keyword, not the word in a comment; no 'Add ABSTRACT' on a FINAL FB", () => {
  const retain = offeredIn("FUNCTION F : INT\nVAR RETAIN (* keep RETAIN here *)\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nF := x;\nEND_FUNCTION\n", "C0175")
  const remove = retain.actions.find((a) => a.title.includes("RETAIN"))
  expect(remove).toBeDefined()
  expect(applyEdits(retain.doc.source, editsOn(remove!, retain.doc.uri))).toContain("VAR (* keep RETAIN here *)")
  const abstract = offeredIn("{attribute 'abstract'}\nFUNCTION_BLOCK FINAL FB\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\nEND_FUNCTION_BLOCK\n", "abstract-keyword-missing")
  expect(titles(abstract)).toEqual([])
})
