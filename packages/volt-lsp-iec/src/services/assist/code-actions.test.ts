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
import { ALL_TESTS } from "../../../test/conformance/fixtures/index.js"
import { BUILDS } from "../../../test/conformance/support/fixture-suite.js"
import { withReplayFixture, type ReplayFiles } from "../../../test/conformance/support/replay.js"
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
 * (tasks.md 2.1–2.2). The one pair the old `wrapConversionFix` already answers in full, C0032's `qf_c0032_wrap`, is not
 * on it; its C0197 assignment pair is — it offers the wrap, but not as `preferred`.
 */
const RED: ReadonlySet<string> = new Set([
  "qf_c0197_wrap_assign", "qf_c0197_wrap_init", "qf_c0197_wrap_argument", "qf_c0197_wrap_return", "qf_c0195_wrap", "qf_c0032_ref", "qf_callarg_wrap",
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
function withFindings<T>(name: string, vendor: Vendor, code: string, ask: (found: DiagnosticItem[], doc: Document, files: ReplayFiles, project: Parameters<typeof codeActions>[1]) => T): T {
  return withReplayFixture(INDEX.get(name)!, vendor, (files, project) => {
    const { own } = files
    const found = computeDiagnostics({ uri: own.uri, parseResult: own.parseResult, source: own.source, project, config: resolveConfig({ vendor }) })
      .filter((d) => wireCode(d.code) === code)
    return ask(found, { uri: own.uri, source: own.source, parseResult: own.parseResult }, files, project)
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
      const { message, edited } = withFindings(before, vendor, code, (found, doc, _files, project) => {
        const finding = target(found, before)
        const actions = codeActions(doc, project, [toLspDiagnostic(finding)])
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
      const offered = withFindings(t.name, vendor, code, (found, doc, _files, project) =>
        found.flatMap((f) => codeActions(doc, project, [toLspDiagnostic(f)]).map((a) => a.title)))
      expect(offered.filter((a) => title === undefined || a.startsWith(title))).toEqual([])
    }
  })
}
